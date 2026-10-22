import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createTestApp, type TestApp } from '../../support/test-app.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../support/test-database.js';

describe('wallets HTTP', () => {
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

  function createWallet(body: unknown) {
    return fetch(`${app.url}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function query<T>(sql: string, params: unknown[]) {
    return database.orm.em.getConnection().execute<T[]>(sql, params);
  }

  describe('POST /wallets', () => {
    it('creates a wallet with an opening transaction and ledger entry', async () => {
      const playerId = randomUUID();

      const response = await createWallet({
        playerId,
        initialBalance: { amount: '1000.00', currency: 'BRL' },
      });

      expect(response.status).toBe(201);
      const wallet = await response.json();
      expect(wallet).toEqual({
        id: expect.any(String),
        playerId,
        balance: { amount: '1000.00', currency: 'BRL' },
        version: 1,
      });

      const transactions = await query<{ kind: string; status: string }>(
        'select kind, status from wager_transactions where wallet_id = ?',
        [wallet.id],
      );
      expect(transactions).toEqual([{ kind: 'OPENING', status: 'PROCESSED' }]);

      const entries = await query<{
        direction: string;
        amount: string;
        balance_after: string;
      }>(
        'select direction, amount, balance_after from wallet_ledger_entries where wallet_id = ?',
        [wallet.id],
      );
      expect(entries).toEqual([
        { direction: 'CREDIT', amount: '1000.00', balance_after: '1000.00' },
      ]);
    });

    it('creates a wallet without opening records when the balance is zero', async () => {
      const response = await createWallet({
        playerId: randomUUID(),
        initialBalance: { amount: '0.00', currency: 'BRL' },
      });

      expect(response.status).toBe(201);
      const wallet = await response.json();

      const [{ count }] = await query<{ count: string }>(
        'select count(*) from wager_transactions where wallet_id = ?',
        [wallet.id],
      );
      expect(count).toBe('0');
    });

    it('rejects a second wallet for the same player and currency', async () => {
      const body = {
        playerId: randomUUID(),
        initialBalance: { amount: '10.00', currency: 'BRL' },
      };
      await createWallet(body);

      const response = await createWallet(body);

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: 'WALLET_ALREADY_EXISTS',
      });
    });

    it('allows the same player to open a wallet in another currency', async () => {
      const playerId = randomUUID();
      await createWallet({
        playerId,
        initialBalance: { amount: '10.00', currency: 'BRL' },
      });

      const response = await createWallet({
        playerId,
        initialBalance: { amount: '10.00', currency: 'USD' },
      });

      expect(response.status).toBe(201);
    });

    it('creates only one wallet when the same request arrives concurrently', async () => {
      const body = {
        playerId: randomUUID(),
        initialBalance: { amount: '10.00', currency: 'BRL' },
      };

      const responses = await Promise.all(
        Array.from({ length: 5 }, () => createWallet(body)),
      );

      const statuses = responses.map((response) => response.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409]);
      const [{ count }] = await query<{ count: string }>(
        'select count(*) from wallets where player_id = ?',
        [body.playerId],
      );
      expect(count).toBe('1');
    });

    it.each([
      [
        'a missing playerId',
        { initialBalance: { amount: '1.00', currency: 'BRL' } },
      ],
      [
        'a playerId that is not a UUID',
        {
          playerId: 'player-1',
          initialBalance: { amount: '1.00', currency: 'BRL' },
        },
      ],
      [
        'a numeric amount',
        {
          playerId: randomUUID(),
          initialBalance: { amount: 10, currency: 'BRL' },
        },
      ],
    ])('rejects %s with 400', async (_, body) => {
      const response = await createWallet(body);

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'INVALID_PAYLOAD' });
    });

    it.each([
      ['a negative amount', '-1.00', 'BRL'],
      ['more than two decimals', '1.001', 'BRL'],
      ['scientific notation', '1e3', 'BRL'],
      ['an invalid currency', '1.00', 'brl'],
    ])('rejects %s with 400', async (_, amount, currency) => {
      const response = await createWallet({
        playerId: randomUUID(),
        initialBalance: { amount, currency },
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'INVALID_MONEY' });
    });
  });

  describe('GET /wallets/:walletId', () => {
    it('returns an existing wallet', async () => {
      const created = await (
        await createWallet({
          playerId: randomUUID(),
          initialBalance: { amount: '25.50', currency: 'BRL' },
        })
      ).json();

      const response = await fetch(`${app.url}/wallets/${created.id}`);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(created);
    });

    it('returns 404 for an unknown wallet', async () => {
      const response = await fetch(`${app.url}/wallets/${randomUUID()}`);

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: 'WALLET_NOT_FOUND' });
    });

    it('returns 400 when the id is not a UUID', async () => {
      const response = await fetch(`${app.url}/wallets/not-a-uuid`);

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'INVALID_PAYLOAD' });
    });
  });
});
