import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createTestApp, type TestApp } from '../../support/test-app.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../support/test-database.js';
import {
  betFor,
  createWallet,
  submit,
  type WalletRef,
} from '../../support/wagering-client.js';

describe('BET concurrency', () => {
  let database: TestDatabase;
  let instances: TestApp[];
  let app: TestApp;

  beforeAll(async () => {
    database = await createTestDatabase();
    instances = await Promise.all(
      Array.from({ length: 3 }, () => createTestApp(database.name)),
    );
    app = instances[0];
  });

  afterAll(async () => {
    await Promise.all(instances.map((instance) => instance.close()));
    await database.drop();
  });

  function query<T>(sql: string, params: unknown[] = []) {
    return database.orm.em.getConnection().execute<T[]>(sql, params);
  }

  async function ledgerOf(wallet: WalletRef) {
    const [row] = await query<{
      balance: string;
      ledger_balance: string;
      debits: string;
    }>(
      `select w.balance,
              coalesce(sum(case e.direction when 'CREDIT' then e.amount else -e.amount end), 0) as ledger_balance,
              count(*) filter (where e.direction = 'DEBIT') as debits
         from wallets w
         left join wallet_ledger_entries e on e.wallet_id = w.id
        where w.id = ?
        group by w.id`,
      [wallet.id],
    );
    return row;
  }

  it('accepts exactly one of two concurrent 80.00 bets on a 100.00 wallet', async () => {
    const wallet = await createWallet(app.url, '100.00');

    const responses = await Promise.all([
      submit(app.url, betFor(wallet, '80.00')),
      submit(app.url, betFor(wallet, '80.00')),
    ]);
    const bodies = await Promise.all(responses.map((r) => r.json()));

    expect(bodies.map((body) => body.status).sort()).toEqual([
      'PROCESSED',
      'REJECTED',
    ]);
    expect(bodies.find((body) => body.status === 'REJECTED')).toMatchObject({
      failureCode: 'INSUFFICIENT_FUNDS',
    });
    expect(await ledgerOf(wallet)).toEqual({
      balance: '20.00',
      ledger_balance: '20.00',
      debits: '1',
    });
  });

  it('debits once when 50 copies of the same bet arrive together', async () => {
    const wallet = await createWallet(app.url, '100.00');
    const bet = betFor(wallet, '10.00');

    const responses = await Promise.all(
      Array.from({ length: 50 }, () => submit(app.url, bet)),
    );
    const bodies = await Promise.all(responses.map((r) => r.json()));

    expect(new Set(responses.map((r) => r.status))).toEqual(new Set([200]));
    expect(new Set(bodies.map((body) => body.transactionId)).size).toBe(1);
    expect(bodies.filter((body) => body.idempotentReplay)).toHaveLength(49);
    expect(new Set(bodies.map((body) => body.balance.amount))).toEqual(
      new Set(['90.00']),
    );
    expect(await ledgerOf(wallet)).toEqual({
      balance: '90.00',
      ledger_balance: '90.00',
      debits: '1',
    });
  });

  it('stays correct with three instances sharing the database', async () => {
    const wallet = await createWallet(app.url, '100.00');
    const bets = Array.from({ length: 15 }, () => betFor(wallet, '10.00'));

    const responses = await Promise.all(
      bets.flatMap((bet) =>
        instances.map((instance) => submit(instance.url, bet)),
      ),
    );
    const bodies = await Promise.all(responses.map((r) => r.json()));

    const outcomes = new Map<string, string>();
    for (const body of bodies) {
      const previous = outcomes.get(body.transactionId);
      expect(previous === undefined || previous === body.status).toBe(true);
      outcomes.set(body.transactionId, body.status);
    }
    const statuses = [...outcomes.values()];
    expect(outcomes.size).toBe(15);
    expect(statuses.filter((status) => status === 'PROCESSED')).toHaveLength(
      10,
    );
    expect(statuses.filter((status) => status === 'REJECTED')).toHaveLength(5);
    expect(await ledgerOf(wallet)).toEqual({
      balance: '0.00',
      ledger_balance: '0.00',
      debits: '10',
    });
  });

  describe('lock scope', () => {
    let lockedApp: TestApp;

    beforeAll(async () => {
      lockedApp = await createTestApp(database.name, { lockTimeoutMs: 300 });
    });

    afterAll(async () => {
      await lockedApp.close();
    });

    async function holdLock(wallet: WalletRef) {
      const em = database.orm.em.fork();
      await em.begin();
      await em.execute('select id from wallets where id = ? for update', [
        wallet.id,
      ]);
      return () => em.rollback();
    }

    it('does not block bets on other wallets', async () => {
      const locked = await createWallet(app.url, '100.00');
      const free = await createWallet(app.url, '100.00');
      const release = await holdLock(locked);

      try {
        const response = await submit(lockedApp.url, betFor(free, '10.00'));

        expect(response.status).toBe(200);
      } finally {
        await release();
      }
    });

    it('answers 503 when the wallet stays locked, and the retry is applied once', async () => {
      const wallet = await createWallet(app.url, '100.00');
      const bet = betFor(wallet, '10.00');
      const release = await holdLock(wallet);

      let response: Response;
      try {
        response = await submit(lockedApp.url, bet);
      } finally {
        await release();
      }

      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).toBe('1');
      expect(await response.json()).toMatchObject({
        code: 'TEMPORARILY_UNAVAILABLE',
      });
      expect((await ledgerOf(wallet)).debits).toBe('0');

      const retry = await submit(lockedApp.url, bet);

      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({ idempotentReplay: false });
      expect(await ledgerOf(wallet)).toMatchObject({
        balance: '90.00',
        debits: '1',
      });
    });
  });
});
