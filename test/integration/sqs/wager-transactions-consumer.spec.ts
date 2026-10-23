import { DeleteMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createSqsClient } from '../../../src/infra/messaging/sqs-client.js';
import type { SqsConsumerConfig } from '../../../src/interfaces/sqs/wager-transactions.consumer.js';
import { createTestApp, type TestApp } from '../../support/test-app.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../support/test-database.js';
import {
  createTestQueues,
  eventually,
  queueDepth,
  receiveAll,
  sendMessage,
  type TestQueues,
} from '../../support/test-queues.js';
import { createWallet, type WalletRef } from '../../support/wagering-client.js';

describe('wager transactions consumer', () => {
  const sqs = createSqsClient();
  let database: TestDatabase;
  let api: TestApp;

  beforeAll(async () => {
    database = await createTestDatabase();
    api = await createTestApp(database.name);
  });

  afterAll(async () => {
    await api.close();
    await database.drop();
    sqs.destroy();
  });

  function consumerConfig(queues: TestQueues): SqsConsumerConfig {
    return {
      enabled: true,
      queueUrl: queues.queueUrl,
      deadLetterQueueUrl: queues.deadLetterQueueUrl,
      waitTimeSeconds: 1,
      maxMessages: 10,
      retryBaseDelaySeconds: 1,
      retryMaxDelaySeconds: 1,
    };
  }

  async function withConsumer(
    options: {
      maxReceiveCount?: number;
      lockTimeoutMs?: number;
      sqsClient?: SQSClient;
    },
    run: (context: { queues: TestQueues; app: TestApp }) => Promise<void>,
  ) {
    const queues = await createTestQueues(sqs, {
      visibilityTimeoutSeconds: 2,
      maxReceiveCount: options.maxReceiveCount ?? 5,
    });
    const app = await createTestApp(database.name, {
      sqsConsumer: consumerConfig(queues),
      lockTimeoutMs: options.lockTimeoutMs,
      sqsClient: options.sqsClient,
    });
    try {
      await run({ queues, app });
    } finally {
      await app.close();
      await queues.delete();
    }
  }

  function message(
    wallet: WalletRef,
    overrides: Record<string, unknown> = {},
    messageId = randomUUID(),
  ) {
    const externalTransactionId = randomUUID();
    return {
      messageId,
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
        money: { amount: '10.00', currency: 'BRL' },
        ...overrides,
      },
    };
  }

  function execute<T>(sql: string, params: unknown[] = []) {
    return database.orm.em.getConnection().execute<T[]>(sql, params);
  }

  async function balanceOf(wallet: WalletRef) {
    const [row] = await execute<{ balance: string; debits: string }>(
      `select balance,
              (select count(*) from wallet_ledger_entries e
                where e.wallet_id = w.id and e.direction = 'DEBIT') as debits
         from wallets w where w.id = ?`,
      [wallet.id],
    );
    return row;
  }

  async function inboxOf(messageId: string) {
    return execute<{ processed: boolean }>(
      'select processed_at is not null as processed from inbox_messages where message_id = ?',
      [messageId],
    );
  }

  it('processes a message and acks it only after the commit', async () => {
    await withConsumer({}, async ({ queues }) => {
      const wallet = await createWallet(api.url, '100.00');
      const body = message(wallet);

      await sendMessage(sqs, queues.queueUrl, body, wallet.id);

      await eventually(async () => (await balanceOf(wallet)).debits === '1');
      expect(await balanceOf(wallet)).toEqual({
        balance: '90.00',
        debits: '1',
      });
      expect(await inboxOf(body.messageId)).toEqual([{ processed: true }]);
      await eventually(
        async () => (await queueDepth(sqs, queues.queueUrl)) === 0,
      );
    });
  });

  it('applies a message delivered twice only once', async () => {
    await withConsumer({}, async ({ queues }) => {
      const wallet = await createWallet(api.url, '100.00');
      const body = message(wallet);

      await sendMessage(sqs, queues.queueUrl, body, wallet.id);
      await sendMessage(sqs, queues.queueUrl, body, wallet.id);

      await eventually(
        async () => (await queueDepth(sqs, queues.queueUrl)) === 0,
      );
      expect(await balanceOf(wallet)).toEqual({
        balance: '90.00',
        debits: '1',
      });
      expect(await inboxOf(body.messageId)).toHaveLength(1);
    });
  });

  it('does not duplicate the debit when the ack is lost after the commit', async () => {
    const real = createSqsClient();
    let ackFailures = 0;
    const flaky = {
      send: (command: unknown, options?: unknown) => {
        if (command instanceof DeleteMessageCommand && ackFailures === 0) {
          ackFailures++;
          return Promise.reject(new Error('connection lost before the ack'));
        }
        return real.send(command as never, options as never);
      },
      destroy: () => real.destroy(),
    } as unknown as SQSClient;

    await withConsumer({ sqsClient: flaky }, async ({ queues }) => {
      const wallet = await createWallet(api.url, '100.00');
      const body = message(wallet);

      await sendMessage(sqs, queues.queueUrl, body, wallet.id);

      await eventually(
        async () => (await queueDepth(sqs, queues.queueUrl)) === 0,
      );
      expect(ackFailures).toBe(1);
      expect(await balanceOf(wallet)).toEqual({
        balance: '90.00',
        debits: '1',
      });
    });
  });

  it('acks a business rejection instead of retrying it', async () => {
    await withConsumer({}, async ({ queues }) => {
      const wallet = await createWallet(api.url, '5.00');

      await sendMessage(sqs, queues.queueUrl, message(wallet), wallet.id);

      await eventually(
        async () => (await queueDepth(sqs, queues.queueUrl)) === 0,
      );
      const [transaction] = await execute<{
        status: string;
        failure_code: string;
      }>(
        'select status, failure_code from wager_transactions where wallet_id = ? and kind = ?',
        [wallet.id, 'BET'],
      );
      expect(transaction).toEqual({
        status: 'REJECTED',
        failure_code: 'INSUFFICIENT_FUNDS',
      });
      expect(await receiveAll(sqs, queues.deadLetterQueueUrl)).toEqual([]);
    });
  });

  describe('dead letter queue', () => {
    it.each([
      ['a body that is not JSON', () => 'not json', 'INVALID_MESSAGE'],
      [
        'a message without the wallet',
        (wallet: WalletRef) => message(wallet, { walletId: undefined }),
        'INVALID_MESSAGE',
      ],
      [
        'a wallet that does not exist',
        (wallet: WalletRef) => message(wallet, { walletId: randomUUID() }),
        'WALLET_NOT_FOUND',
      ],
    ])('moves %s to the DLQ right away', async (_, build, code) => {
      await withConsumer({}, async ({ queues }) => {
        const wallet = await createWallet(api.url, '100.00');

        await sendMessage(sqs, queues.queueUrl, build(wallet), wallet.id);

        let dead: Awaited<ReturnType<typeof receiveAll>> = [];
        await eventually(async () => {
          dead = await receiveAll(sqs, queues.deadLetterQueueUrl);
          return dead.length === 1;
        });
        expect(dead[0].MessageAttributes?.errorCode?.StringValue).toBe(code);
        await eventually(
          async () => (await queueDepth(sqs, queues.queueUrl)) === 0,
        );
        expect((await balanceOf(wallet)).balance).toBe('100.00');
      });
    });

    it('moves a reused message id with another payload to the DLQ', async () => {
      await withConsumer({}, async ({ queues }) => {
        const wallet = await createWallet(api.url, '100.00');
        const first = message(wallet);
        const second = message(wallet, {}, first.messageId);

        await sendMessage(sqs, queues.queueUrl, first, wallet.id);
        await sendMessage(sqs, queues.queueUrl, second, wallet.id);

        let dead: Awaited<ReturnType<typeof receiveAll>> = [];
        await eventually(async () => {
          dead = await receiveAll(sqs, queues.deadLetterQueueUrl);
          return dead.length === 1;
        });
        expect(dead[0].MessageAttributes?.errorCode?.StringValue).toBe(
          'INBOX_MESSAGE_CONFLICT',
        );
        expect(await balanceOf(wallet)).toEqual({
          balance: '90.00',
          debits: '1',
        });
      });
    });
  });

  describe('transient failures', () => {
    async function holdLock(wallet: WalletRef) {
      const em = database.orm.em.fork();
      await em.begin();
      await em.execute('select id from wallets where id = ? for update', [
        wallet.id,
      ]);
      return () => em.rollback();
    }

    it('retries a message whose wallet stays locked and applies it once', async () => {
      await withConsumer({ lockTimeoutMs: 200 }, async ({ queues }) => {
        const wallet = await createWallet(api.url, '100.00');
        const release = await holdLock(wallet);

        await sendMessage(sqs, queues.queueUrl, message(wallet), wallet.id);
        await Bun.sleep(1_500);
        expect((await balanceOf(wallet)).debits).toBe('0');
        await release();

        await eventually(async () => (await balanceOf(wallet)).debits === '1');
        await eventually(
          async () => (await queueDepth(sqs, queues.queueUrl)) === 0,
        );
        expect(await balanceOf(wallet)).toEqual({
          balance: '90.00',
          debits: '1',
        });
      });
    });

    it('moves the message to the DLQ after the last attempt', async () => {
      await withConsumer(
        { lockTimeoutMs: 200, maxReceiveCount: 2 },
        async ({ queues }) => {
          const wallet = await createWallet(api.url, '100.00');
          const release = await holdLock(wallet);

          try {
            await sendMessage(sqs, queues.queueUrl, message(wallet), wallet.id);
            await eventually(
              async () =>
                (await queueDepth(sqs, queues.deadLetterQueueUrl)) === 1,
              15_000,
            );
          } finally {
            await release();
          }

          expect((await balanceOf(wallet)).debits).toBe('0');
        },
      );
    }, 20_000);
  });
});
