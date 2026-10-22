import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createTestApp, type TestApp } from '../../support/test-app.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../support/test-database.js';

describe('wagering HTTP: BET', () => {
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

  async function createWallet(amount = '100.00', currency = 'BRL') {
    const response = await fetch(`${app.url}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        playerId: randomUUID(),
        initialBalance: { amount, currency },
      }),
    });
    return (await response.json()) as { id: string; playerId: string };
  }

  function betFor(
    wallet: { id: string; playerId: string },
    overrides: Record<string, unknown> = {},
  ) {
    return {
      providerId: 'provider-a',
      externalTransactionId: randomUUID(),
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: 'BET',
      money: { amount: '25.00', currency: 'BRL' },
      ...overrides,
    };
  }

  function submit(body: Record<string, unknown>, idempotencyKey?: string) {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    const key =
      idempotencyKey ?? `${body.providerId}:${body.externalTransactionId}`;
    if (key) {
      headers['idempotency-key'] = key;
    }
    return fetch(`${app.url}/wagering/transactions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }

  function query<T>(sql: string, params: unknown[]) {
    return database.orm.em.getConnection().execute<T[]>(sql, params);
  }

  async function walletState(walletId: string) {
    const [wallet] = await query<{ balance: string; version: number }>(
      'select balance, version from wallets where id = ?',
      [walletId],
    );
    const entries = await query<{ direction: string; amount: string }>(
      "select direction, amount from wallet_ledger_entries where wallet_id = ? and direction = 'DEBIT'",
      [walletId],
    );
    return { ...wallet, debits: entries };
  }

  it('debits the wallet and records the ledger entry', async () => {
    const wallet = await createWallet();

    const response = await submit(betFor(wallet));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      transactionId: expect.any(String),
      status: 'PROCESSED',
      balance: { amount: '75.00', currency: 'BRL' },
      idempotentReplay: false,
    });
    expect(await walletState(wallet.id)).toEqual({
      balance: '75.00',
      version: 2,
      debits: [{ direction: 'DEBIT', amount: '25.00' }],
    });
  });

  it('rejects a bet above the balance without touching the wallet', async () => {
    const wallet = await createWallet('10.00');

    const response = await submit(betFor(wallet));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      transactionId: expect.any(String),
      status: 'REJECTED',
      balance: { amount: '10.00', currency: 'BRL' },
      failureCode: 'INSUFFICIENT_FUNDS',
      idempotentReplay: false,
    });
    expect(await walletState(wallet.id)).toEqual({
      balance: '10.00',
      version: 1,
      debits: [],
    });
  });

  it('rejects a bet in another currency', async () => {
    const wallet = await createWallet();

    const response = await submit(
      betFor(wallet, { money: { amount: '25.00', currency: 'USD' } }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      status: 'REJECTED',
      balance: { amount: '100.00', currency: 'BRL' },
      failureCode: 'CURRENCY_MISMATCH',
    });
  });

  it('rejects a bet from another player', async () => {
    const wallet = await createWallet();

    const response = await submit(betFor(wallet, { playerId: randomUUID() }));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      status: 'REJECTED',
      failureCode: 'PLAYER_MISMATCH',
    });
  });

  describe('idempotency', () => {
    it('replays the original response, including the balance of that moment', async () => {
      const wallet = await createWallet();
      const bet = betFor(wallet);
      const first = await (await submit(bet)).json();
      await submit(betFor(wallet));

      const replay = await submit(bet);

      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual({
        ...first,
        idempotentReplay: true,
      });
      expect((await walletState(wallet.id)).debits).toHaveLength(2);
    });

    it('replays a rejection with the same status', async () => {
      const wallet = await createWallet('10.00');
      const bet = betFor(wallet);
      await submit(bet);

      const replay = await submit(bet);

      expect(replay.status).toBe(422);
      expect(await replay.json()).toMatchObject({
        failureCode: 'INSUFFICIENT_FUNDS',
        idempotentReplay: true,
      });
    });

    it('treats 25.5 and 25.50 as the same payload', async () => {
      const wallet = await createWallet();
      const bet = betFor(wallet, {
        money: { amount: '25.5', currency: 'BRL' },
      });
      await submit(bet);

      const replay = await submit({
        ...bet,
        money: { amount: '25.50', currency: 'BRL' },
      });

      expect(await replay.json()).toMatchObject({ idempotentReplay: true });
    });

    it('rejects the same key with a different payload', async () => {
      const wallet = await createWallet();
      const bet = betFor(wallet);
      await submit(bet);

      const response = await submit({
        ...bet,
        money: { amount: '30.00', currency: 'BRL' },
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: 'IDEMPOTENCY_CONFLICT',
      });
      expect((await walletState(wallet.id)).debits).toHaveLength(1);
    });

    it('rejects the same external transaction under another key', async () => {
      const wallet = await createWallet();
      const bet = betFor(wallet);
      await submit(bet);

      const response = await submit(bet, 'another-key');

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: 'EXTERNAL_TRANSACTION_CONFLICT',
      });
    });
  });

  describe('invalid requests', () => {
    it('requires the Idempotency-Key header', async () => {
      const wallet = await createWallet();

      const response = await submit(betFor(wallet), '');

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'INVALID_PAYLOAD' });
    });

    it.each([
      ['an unknown kind', { kind: 'OPENING' }],
      ['a walletId that is not a UUID', { walletId: 'wallet-1' }],
      ['a numeric amount', { money: { amount: 25, currency: 'BRL' } }],
    ])('rejects %s with 400', async (_, overrides) => {
      const wallet = await createWallet();

      const response = await submit(betFor(wallet, overrides));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'INVALID_PAYLOAD' });
    });

    it('rejects an invalid amount with 400', async () => {
      const wallet = await createWallet();

      const response = await submit(
        betFor(wallet, { money: { amount: '-1.00', currency: 'BRL' } }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'INVALID_MONEY' });
    });

    it('returns 404 for an unknown wallet', async () => {
      const response = await submit(
        betFor({ id: randomUUID(), playerId: randomUUID() }),
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: 'WALLET_NOT_FOUND' });
    });
  });
});
