import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_REFERENCE_RETRY_POLICY,
  type ReferenceRetryPolicy,
} from '../../src/application/wagering/reference-retry-policy.js';
import { ResolvePendingReferencesUseCase } from '../../src/application/wagering/resolve-pending-references.use-case.js';
import { MikroOrmUnitOfWork } from '../../src/infra/database/mikro-orm-unit-of-work.js';
import { UuidV7IdGenerator } from '../../src/infra/system/uuid-v7-id-generator.js';
import { createTestApp, type TestApp } from '../support/test-app.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../support/test-database.js';
import {
  betFor,
  createWallet,
  submit,
  type TransactionBody,
  transactionFor,
  type WalletRef,
} from '../support/wagering-client.js';

const SECOND = 1_000;

describe('pending references', () => {
  let database: TestDatabase;
  let app: TestApp;

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp(database.name);
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  function worker(
    policy: ReferenceRetryPolicy = DEFAULT_REFERENCE_RETRY_POLICY,
  ) {
    const clock = { current: new Date(), now: () => clock.current };
    const useCase = new ResolvePendingReferencesUseCase(
      new MikroOrmUnitOfWork(database.orm.em, 5_000),
      new UuidV7IdGenerator(),
      clock,
      policy,
    );
    return {
      advance(milliseconds: number) {
        clock.current = new Date(clock.current.getTime() + milliseconds);
      },
      run: () => useCase.execute(50),
    };
  }

  function execute<T>(sql: string, params: unknown[] = []) {
    return database.orm.em.getConnection().execute<T[]>(sql, params);
  }

  async function stateOf(transaction: TransactionBody) {
    const [row] = await execute<{
      status: string;
      failure_code: string | null;
      reference_attempts: number;
      balance: string;
    }>(
      `select t.status, t.failure_code, t.reference_attempts, w.balance
         from wager_transactions t join wallets w on w.id = t.wallet_id
        where t.provider_id = ? and t.external_transaction_id = ?`,
      [transaction.providerId, transaction.externalTransactionId],
    );
    return row;
  }

  async function eventTypesOf(wallet: WalletRef) {
    const rows = await execute<{ event_type: string }>(
      'select event_type from outbox_messages where aggregate_id = ? order by occurred_at, event_type',
      [wallet.id],
    );
    return rows.map((row) => row.event_type);
  }

  async function refundBeforeItsBet(wallet: WalletRef, amount = '25.00') {
    const betId = randomUUID();
    const refund = transactionFor(wallet, 'REFUND', amount, {
      referenceExternalTransactionId: betId,
    });
    const response = await submit(app.url, refund);
    expect(response.status).toBe(202);
    return { refund, bet: betFor(wallet, '25.00', betId) };
  }

  it('processes a REFUND once its BET arrives', async () => {
    const wallet = await createWallet(app.url, '100.00');
    const { refund, bet } = await refundBeforeItsBet(wallet);
    await submit(app.url, bet);
    const resolver = worker();
    resolver.advance(2 * SECOND);

    const result = await resolver.run();

    expect(result.failures).toEqual([]);
    expect(await stateOf(refund)).toMatchObject({
      status: 'PROCESSED',
      balance: '100.00',
    });
    expect(await eventTypesOf(wallet)).toEqual([
      'WagerTransactionProcessed',
      'WalletBalanceChanged',
      'WagerTransactionPendingReference',
      'WagerTransactionProcessed',
      'WalletBalanceChanged',
      'WagerTransactionProcessed',
      'WalletBalanceChanged',
    ]);

    const replay = await submit(app.url, refund);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      status: 'PROCESSED',
      idempotentReplay: true,
      balance: { amount: '100.00', currency: 'BRL' },
    });
  });

  it('leaves a transaction alone before its next attempt', async () => {
    const wallet = await createWallet(app.url, '100.00');
    const { refund } = await refundBeforeItsBet(wallet);

    await worker().run();

    expect(await stateOf(refund)).toMatchObject({
      status: 'PENDING_REFERENCE',
      reference_attempts: 0,
    });
  });

  it('reschedules with a longer delay while the reference is missing, without new events', async () => {
    const wallet = await createWallet(app.url, '100.00');
    const { refund } = await refundBeforeItsBet(wallet);
    const resolver = worker();
    resolver.advance(2 * SECOND);

    await resolver.run();

    expect(await stateOf(refund)).toMatchObject({
      status: 'PENDING_REFERENCE',
      reference_attempts: 1,
    });
    await resolver.run();
    expect((await stateOf(refund)).reference_attempts).toBe(1);
    resolver.advance(2 * SECOND);
    await resolver.run();
    expect((await stateOf(refund)).reference_attempts).toBe(2);
    expect(await eventTypesOf(wallet)).toEqual([
      'WagerTransactionProcessed',
      'WalletBalanceChanged',
      'WagerTransactionPendingReference',
    ]);
  });

  it('gives up with REFERENCE_NOT_FOUND after the last attempt', async () => {
    const wallet = await createWallet(app.url, '100.00');
    const { refund } = await refundBeforeItsBet(wallet);
    const resolver = worker({
      ...DEFAULT_REFERENCE_RETRY_POLICY,
      maxAttempts: 3,
    });

    for (let attempt = 0; attempt < 3; attempt++) {
      resolver.advance(60 * SECOND);
      await resolver.run();
    }

    expect(await stateOf(refund)).toMatchObject({
      status: 'REJECTED',
      failure_code: 'REFERENCE_NOT_FOUND',
      balance: '100.00',
    });
    expect((await eventTypesOf(wallet)).at(-1)).toBe(
      'WagerTransactionRejected',
    );
    const replay = await submit(app.url, refund);
    expect(replay.status).toBe(422);
  });

  it('rejects the transaction when the reference arrives but does not match', async () => {
    const wallet = await createWallet(app.url, '100.00');
    const { refund, bet } = await refundBeforeItsBet(wallet, '10.00');
    await submit(app.url, bet);
    const resolver = worker();
    resolver.advance(2 * SECOND);

    await resolver.run();

    expect(await stateOf(refund)).toMatchObject({
      status: 'REJECTED',
      failure_code: 'AMOUNT_MISMATCH',
      balance: '75.00',
    });
  });

  it('resolves each transaction once with two workers running together', async () => {
    const wallets = await Promise.all(
      Array.from({ length: 5 }, () => createWallet(app.url, '100.00')),
    );
    for (const wallet of wallets) {
      const { bet } = await refundBeforeItsBet(wallet);
      await submit(app.url, bet);
    }
    const first = worker();
    const second = worker();
    first.advance(2 * SECOND);
    second.advance(2 * SECOND);

    const results = await Promise.all([first.run(), second.run()]);

    expect(results.flatMap((result) => result.failures)).toEqual([]);
    const balances = await execute<{ balance: string; credits: string }>(
      `select w.balance,
              (select count(*) from wallet_ledger_entries e
                where e.wallet_id = w.id and e.direction = 'CREDIT') as credits
         from wallets w where w.id in (?, ?, ?, ?, ?)`,
      wallets.map((wallet) => wallet.id),
    );
    expect(balances).toEqual(
      wallets.map(() => ({ balance: '100.00', credits: '2' })),
    );
  });

  it('is resolved by the scheduled worker without any manual call', async () => {
    const scheduled = await createTestApp(database.name, {
      referenceRetryPolicy: {
        maxAttempts: 10,
        baseDelayMs: 10,
        maxDelayMs: 50,
      },
      pendingReferenceWorker: { enabled: true, intervalMs: 20, batchSize: 50 },
    });
    try {
      const wallet = await createWallet(scheduled.url, '100.00');
      const betId = randomUUID();
      const refund = transactionFor(wallet, 'REFUND', '25.00', {
        referenceExternalTransactionId: betId,
      });
      await submit(scheduled.url, refund);
      await submit(scheduled.url, betFor(wallet, '25.00', betId));

      const deadline = Date.now() + 3 * SECOND;
      while (
        (await stateOf(refund)).status !== 'PROCESSED' &&
        Date.now() < deadline
      ) {
        await Bun.sleep(25);
      }

      expect(await stateOf(refund)).toMatchObject({
        status: 'PROCESSED',
        balance: '100.00',
      });
    } finally {
      await scheduled.close();
    }
  });
});
