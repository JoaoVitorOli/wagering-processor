import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createSqsClient } from '../../../src/infra/messaging/sqs-client.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../support/test-database.js';
import { type AppProcess, spawnApp } from '../../support/test-process.js';
import {
  createTestQueues,
  eventually,
  queueDepth,
  sendMessage,
} from '../../support/test-queues.js';
import {
  betFor,
  createWallet,
  submit,
  type WalletRef,
} from '../../support/wagering-client.js';

describe('multiple processes', () => {
  const sqs = createSqsClient();
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
    sqs.destroy();
  });

  async function cluster() {
    const wagers = await createTestQueues(sqs, {
      visibilityTimeoutSeconds: 2,
      maxReceiveCount: 5,
    });
    const events = await createTestQueues(sqs, {
      visibilityTimeoutSeconds: 30,
      maxReceiveCount: 5,
    });
    const variables = {
      POSTGRES_DB: database.name,
      WAGER_TRANSACTIONS_QUEUE_URL: wagers.queueUrl,
      WAGER_TRANSACTIONS_DLQ_URL: wagers.deadLetterQueueUrl,
      WAGERING_EVENTS_QUEUE_URL: events.queueUrl,
    };
    const started: AppProcess[] = [];

    return {
      queueUrl: wagers.queueUrl,
      async start(extra: Record<string, string> = {}) {
        const app = await spawnApp({ ...variables, ...extra });
        started.push(app);
        return app;
      },
      async stop() {
        await Promise.all(started.map((app) => app.stop('SIGKILL')));
        await wagers.delete();
        await events.delete();
      },
    };
  }

  function wagerMessage(wallet: WalletRef, amount = '1.00') {
    const externalTransactionId = randomUUID();
    return {
      messageId: randomUUID(),
      type: 'WagerTransactionRequested',
      occurredAt: new Date().toISOString(),
      data: {
        providerId: 'provider-a',
        externalTransactionId,
        idempotencyKey: `provider-a:${externalTransactionId}`,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: 'round-1',
        gameId: 'fortune-chimp',
        kind: 'BET',
        money: { amount, currency: 'BRL' },
      },
    };
  }

  function execute<T>(sql: string, params: unknown[] = []) {
    return database.orm.em.getConnection().execute<T[]>(sql, params);
  }

  async function stateOf(wallet: WalletRef) {
    const [row] = await execute<{
      balance: string;
      debits: string;
      pending_events: string;
    }>(
      `select w.balance,
              (select count(*) from wallet_ledger_entries e
                where e.wallet_id = w.id and e.direction = 'DEBIT') as debits,
              (select count(*) from outbox_messages o
                where o.aggregate_id = w.id and o.published_at is null) as pending_events
         from wallets w where w.id = ?`,
      [wallet.id],
    );
    return row;
  }

  async function settled(queueUrl: string, wallets: WalletRef[]) {
    await eventually(
      async () => (await queueDepth(sqs, queueUrl)) === 0,
      45_000,
    );
    await eventually(async () => {
      const states = await Promise.all(wallets.map(stateOf));
      return states.every((state) => state.pending_events === '0');
    }, 30_000);
  }

  it('stays correct with three processes sharing the database and the queue', async () => {
    const processes = await cluster();
    try {
      const apps = await Promise.all([
        processes.start(),
        processes.start(),
        processes.start(),
      ]);
      const viaHttp = await createWallet(apps[0].url, '100.00');
      const viaQueue = await createWallet(apps[0].url, '100.00');
      const bets = Array.from({ length: 15 }, () => betFor(viaHttp, '10.00'));

      await Promise.all([
        ...bets.flatMap((bet) => apps.map((app) => submit(app.url, bet))),
        ...Array.from({ length: 15 }, () =>
          sendMessage(
            sqs,
            processes.queueUrl,
            wagerMessage(viaQueue, '10.00'),
            viaQueue.id,
          ),
        ),
      ]);
      await settled(processes.queueUrl, [viaHttp, viaQueue]);

      for (const wallet of [viaHttp, viaQueue]) {
        expect(await stateOf(wallet)).toEqual({
          balance: '0.00',
          debits: '10',
          pending_events: '0',
        });
      }
    } finally {
      await processes.stop();
    }
  }, 90_000);

  it('does not repeat the debit when a process is killed after the commit and before the ack', async () => {
    const processes = await cluster();
    try {
      const doomed = await processes.start({
        FAILPOINTS: 'sqs-consumer:after-commit',
      });
      const wallet = await createWallet(doomed.url, '100.00');
      const message = wagerMessage(wallet, '10.00');

      await sendMessage(sqs, processes.queueUrl, message, wallet.id);
      await doomed.exited;

      expect(doomed.process.signalCode).toBe('SIGKILL');
      expect((await stateOf(wallet)).debits).toBe('1');
      expect(await queueDepth(sqs, processes.queueUrl)).toBe(1);

      await processes.start();
      await settled(processes.queueUrl, [wallet]);

      expect(await stateOf(wallet)).toEqual({
        balance: '90.00',
        debits: '1',
        pending_events: '0',
      });
      const inbox = await execute<{ count: string }>(
        'select count(*) from inbox_messages where message_id = ? and processed_at is not null',
        [message.messageId],
      );
      expect(inbox).toEqual([{ count: '1' }]);
    } finally {
      await processes.stop();
    }
  }, 90_000);

  it('reaches a consistent state after a restart in the middle of the work', async () => {
    const processes = await cluster();
    try {
      const first = await processes.start();
      const wallets = await Promise.all(
        Array.from({ length: 5 }, () => createWallet(first.url, '100.00')),
      );
      const messages = wallets.flatMap((wallet) =>
        Array.from({ length: 6 }, () => ({
          wallet,
          body: wagerMessage(wallet),
        })),
      );
      for (const { wallet, body } of messages) {
        await sendMessage(sqs, processes.queueUrl, body, wallet.id);
        await sendMessage(sqs, processes.queueUrl, body, wallet.id);
      }
      await eventually(async () => {
        const [{ count }] = await execute<{ count: string }>(
          "select count(*) from wager_transactions where kind = 'BET'",
        );
        return Number(count) >= 5;
      }, 30_000);

      await first.stop('SIGKILL');
      await processes.start();
      await settled(processes.queueUrl, wallets);

      for (const wallet of wallets) {
        expect(await stateOf(wallet)).toEqual({
          balance: '94.00',
          debits: '6',
          pending_events: '0',
        });
      }
      const [{ count }] = await execute<{ count: string }>(
        `select count(*) from inbox_messages
          where processed_at is not null and message_id in (${messages
            .map(() => '?')
            .join(',')})`,
        messages.map(({ body }) => body.messageId),
      );
      expect(count).toBe('30');
    } finally {
      await processes.stop();
    }
  }, 120_000);
});
