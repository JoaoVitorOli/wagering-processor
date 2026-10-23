import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { OutboxMessage } from '../../src/application/outbox/outbox-message.js';
import { PublishOutboxUseCase } from '../../src/application/outbox/publish-outbox.use-case.js';
import type { EventPublisher } from '../../src/application/ports/event-publisher.js';
import type { UnitOfWork } from '../../src/application/ports/unit-of-work.js';
import { MikroOrmUnitOfWork } from '../../src/infra/database/mikro-orm-unit-of-work.js';
import { createSqsClient } from '../../src/infra/messaging/sqs-client.js';
import { SqsEventPublisher } from '../../src/infra/messaging/sqs-event-publisher.js';
import { createTestApp, type TestApp } from '../support/test-app.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../support/test-database.js';
import {
  createTestQueues,
  eventually,
  receiveAll,
} from '../support/test-queues.js';
import { createWallet, type WalletRef } from '../support/wagering-client.js';

class RecordingPublisher implements EventPublisher {
  readonly published: OutboxMessage[] = [];

  constructor(
    private readonly options: {
      delayMs?: number;
      fail?: (message: OutboxMessage) => boolean;
    } = {},
  ) {}

  async publish(message: OutboxMessage): Promise<void> {
    if (this.options.delayMs) {
      await Bun.sleep(this.options.delayMs);
    }
    if (this.options.fail?.(message)) {
      throw new Error(`broker refused ${message.id}`);
    }
    this.published.push(message);
  }

  idsFor(wallet: WalletRef) {
    return this.published
      .filter((message) => message.aggregateId === wallet.id)
      .map((message) => message.id);
  }
}

describe('outbox publisher', () => {
  const sqs = createSqsClient();
  let database: TestDatabase;
  let app: TestApp;

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp(database.name);
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
    sqs.destroy();
  });

  function clock() {
    const state = { current: new Date(Date.now() + 1_000) };
    return {
      now: () => state.current,
      advance(milliseconds: number) {
        state.current = new Date(state.current.getTime() + milliseconds);
      },
    };
  }

  async function drain(useCase: PublishOutboxUseCase) {
    while ((await useCase.execute(50)).published > 0) {}
  }

  function unitOfWork(): UnitOfWork {
    return new MikroOrmUnitOfWork(database.orm.em, 5_000);
  }

  async function outboxOf(wallet: WalletRef) {
    return database.orm.em
      .getConnection()
      .execute<{ id: string; attempts: number; published: boolean }[]>(
        `select id, attempts, published_at is not null as published
         from outbox_messages where aggregate_id = ? order by occurred_at, event_type`,
        [wallet.id],
      );
  }

  it('publishes pending events to SQS and marks them published', async () => {
    const queues = await createTestQueues(sqs, {
      visibilityTimeoutSeconds: 30,
      maxReceiveCount: 5,
    });
    try {
      const wallet = await createWallet(app.url, '100.00');
      const useCase = new PublishOutboxUseCase(
        unitOfWork(),
        new SqsEventPublisher(sqs, queues.queueUrl),
        clock(),
      );

      await drain(useCase);

      const rows = await outboxOf(wallet);
      expect(rows.map((row) => row.published)).toEqual([true, true]);
      const messages = (await receiveAll(sqs, queues.queueUrl)).filter(
        (message) => JSON.parse(message.Body ?? '{}').aggregateId === wallet.id,
      );
      expect(
        messages.map((message) => JSON.parse(message.Body ?? '{}')),
      ).toEqual(
        rows.map((row) =>
          expect.objectContaining({ eventId: row.id, aggregateId: wallet.id }),
        ),
      );
    } finally {
      await queues.delete();
    }
  });

  it('does not publish an event twice once it is marked published', async () => {
    const wallet = await createWallet(app.url, '100.00');
    const publisher = new RecordingPublisher();
    const useCase = new PublishOutboxUseCase(unitOfWork(), publisher, clock());

    await drain(useCase);
    await drain(useCase);

    expect(publisher.idsFor(wallet)).toHaveLength(2);
  });

  it('publishes again after the process dies between publishing and committing', async () => {
    const wallet = await createWallet(app.url, '100.00');
    const publisher = new RecordingPublisher();
    const dying: UnitOfWork = {
      run: (work) =>
        unitOfWork().run((repositories) =>
          work({
            ...repositories,
            outbox: {
              ...repositories.outbox,
              claimDue: repositories.outbox.claimDue.bind(repositories.outbox),
              update: (message) =>
                message.aggregateId === wallet.id
                  ? Promise.reject(new Error('process died'))
                  : repositories.outbox.update(message),
            },
          }),
        ),
    };

    await expect(
      drain(new PublishOutboxUseCase(dying, publisher, clock())),
    ).rejects.toThrow('process died');
    expect((await outboxOf(wallet)).every((row) => !row.published)).toBe(true);

    await drain(new PublishOutboxUseCase(unitOfWork(), publisher, clock()));

    const ids = publisher.idsFor(wallet);
    expect(ids.length).toBeGreaterThan(2);
    expect(new Set(ids).size).toBe(2);
    expect((await outboxOf(wallet)).every((row) => row.published)).toBe(true);
  });

  it('retries a failed event later, keeping the next events of the same wallet in order', async () => {
    const wallet = await createWallet(app.url, '100.00');
    const other = await createWallet(app.url, '100.00');
    const [firstOfWallet] = await outboxOf(wallet);
    let failing = true;
    const publisher = new RecordingPublisher({
      fail: (message) => failing && message.id === firstOfWallet.id,
    });
    const time = clock();
    const useCase = new PublishOutboxUseCase(unitOfWork(), publisher, time);

    await drain(useCase);

    expect(publisher.idsFor(wallet)).toEqual([]);
    expect(publisher.idsFor(other)).toHaveLength(2);
    expect((await outboxOf(wallet))[0]).toMatchObject({
      attempts: 1,
      published: false,
    });

    failing = false;
    await drain(useCase);
    expect(publisher.idsFor(wallet)).toEqual([]);

    time.advance(1_000);
    await drain(useCase);
    expect(publisher.idsFor(wallet)).toEqual(
      (await outboxOf(wallet)).map((row) => row.id),
    );
  });

  it('publishes each event once, in order per wallet, with three publishers running together', async () => {
    const wallets = await Promise.all(
      Array.from({ length: 5 }, () => createWallet(app.url, '100.00')),
    );
    const publisher = new RecordingPublisher({ delayMs: 20 });

    await Promise.all([
      new PublishOutboxUseCase(unitOfWork(), publisher, clock()).execute(4),
      new PublishOutboxUseCase(unitOfWork(), publisher, clock()).execute(4),
      new PublishOutboxUseCase(unitOfWork(), publisher, clock()).execute(4),
    ]);
    await new PublishOutboxUseCase(unitOfWork(), publisher, clock()).execute(
      50,
    );

    const ids = wallets.flatMap((wallet) => publisher.idsFor(wallet));
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
    for (const wallet of wallets) {
      expect(publisher.idsFor(wallet)).toEqual(
        (await outboxOf(wallet)).map((row) => row.id),
      );
    }
  });

  it('is published by the scheduled worker without any manual call', async () => {
    const queues = await createTestQueues(sqs, {
      visibilityTimeoutSeconds: 30,
      maxReceiveCount: 5,
    });
    const scheduled = await createTestApp(database.name, {
      outboxPublisher: {
        enabled: true,
        queueUrl: queues.queueUrl,
        intervalMs: 50,
        batchSize: 50,
      },
    });
    try {
      const wallet = await createWallet(scheduled.url, '100.00');

      await eventually(async () =>
        (await outboxOf(wallet)).every((row) => row.published),
      );
      const ids = (await receiveAll(sqs, queues.queueUrl)).map(
        (message) => JSON.parse(message.Body ?? '{}').eventId,
      );
      for (const row of await outboxOf(wallet)) {
        expect(ids).toContain(row.id);
      }
    } finally {
      await scheduled.close();
      await queues.delete();
    }
  });
});
