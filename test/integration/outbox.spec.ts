import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createTestApp, type TestApp } from '../support/test-app.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../support/test-database.js';
import {
  betFor,
  createWallet,
  submit,
  transactionFor,
  type WalletRef,
} from '../support/wagering-client.js';

describe('outbox', () => {
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

  function execute<T>(sql: string, params: unknown[] = []) {
    return database.orm.em.getConnection().execute<T[]>(sql, params);
  }

  async function eventsOf(wallet: WalletRef) {
    const rows = await execute<{
      event_type: string;
      payload: { data: Record<string, unknown> };
      attempts: number;
      published_at: Date | null;
    }>(
      `select event_type, payload, attempts, published_at
         from outbox_messages where aggregate_id = ? order by occurred_at, event_type`,
      [wallet.id],
    );
    return rows;
  }

  async function eventTypesOf(wallet: WalletRef) {
    return (await eventsOf(wallet)).map((row) => row.event_type);
  }

  it('records the opening of a funded wallet', async () => {
    const wallet = await createWallet(app.url, '100.00');

    expect(await eventTypesOf(wallet)).toEqual([
      'WagerTransactionProcessed',
      'WalletBalanceChanged',
    ]);
  });

  it('records nothing for a wallet opened with zero', async () => {
    const wallet = await createWallet(app.url, '0.00');

    expect(await eventTypesOf(wallet)).toEqual([]);
  });

  it('records processed and balance changed for a bet, as pending messages', async () => {
    const wallet = await createWallet(app.url, '0.00');
    await submit(app.url, transactionFor(wallet, 'WIN', '50.00'));

    const events = await eventsOf(wallet);

    expect(events.map((row) => row.event_type)).toEqual([
      'WagerTransactionProcessed',
      'WalletBalanceChanged',
    ]);
    expect(events[1].payload.data).toMatchObject({
      direction: 'CREDIT',
      balanceAfter: { amount: '50.00', currency: 'BRL' },
      walletVersion: 2,
    });
    expect(
      events.every((row) => row.attempts === 0 && row.published_at === null),
    ).toBe(true);
  });

  it('records only processed for a LOSS', async () => {
    const wallet = await createWallet(app.url, '0.00');

    await submit(app.url, transactionFor(wallet, 'LOSS', '0.00'));

    expect(await eventTypesOf(wallet)).toEqual(['WagerTransactionProcessed']);
  });

  it('records rejected for a bet without balance', async () => {
    const wallet = await createWallet(app.url, '0.00');

    await submit(app.url, betFor(wallet, '10.00'));

    expect(await eventTypesOf(wallet)).toEqual(['WagerTransactionRejected']);
  });

  it('records pending reference for a refund whose bet has not arrived', async () => {
    const wallet = await createWallet(app.url, '0.00');

    await submit(
      app.url,
      transactionFor(wallet, 'REFUND', '10.00', {
        referenceExternalTransactionId: randomUUID(),
      }),
    );

    expect(await eventTypesOf(wallet)).toEqual([
      'WagerTransactionPendingReference',
    ]);
  });

  it('records nothing new on a replay', async () => {
    const wallet = await createWallet(app.url, '0.00');
    const win = transactionFor(wallet, 'WIN', '10.00');
    await submit(app.url, win);

    await submit(app.url, win);

    expect(await eventTypesOf(wallet)).toHaveLength(2);
  });

  describe('atomicity', () => {
    beforeAll(async () => {
      await execute(`
        create function reject_outbox() returns trigger as $$
        begin raise exception 'outbox unavailable'; end;
        $$ language plpgsql`);
    });

    afterAll(async () => {
      await execute('drop function reject_outbox() cascade');
    });

    it('keeps the wallet, transaction and ledger unchanged when the event cannot be recorded', async () => {
      const wallet = await createWallet(app.url, '100.00');
      const bet = betFor(wallet, '30.00');
      await execute(
        'create trigger reject_outbox before insert on outbox_messages for each row execute function reject_outbox()',
      );

      let response: Response;
      try {
        response = await submit(app.url, bet);
      } finally {
        await execute('drop trigger reject_outbox on outbox_messages');
      }

      expect(response.status).toBe(500);
      const [state] = await execute<{
        balance: string;
        transactions: string;
        entries: string;
      }>(
        `select w.balance,
                (select count(*) from wager_transactions t where t.wallet_id = w.id) as transactions,
                (select count(*) from wallet_ledger_entries e where e.wallet_id = w.id) as entries
           from wallets w where w.id = ?`,
        [wallet.id],
      );
      expect(state).toEqual({
        balance: '100.00',
        transactions: '1',
        entries: '1',
      });

      const retry = await submit(app.url, bet);

      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({
        idempotentReplay: false,
        balance: { amount: '70.00', currency: 'BRL' },
      });
    });
  });
});
