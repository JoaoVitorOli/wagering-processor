import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
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

describe('queries and reconciliation', () => {
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

  async function get(path: string) {
    const response = await fetch(`${app.url}${path}`);
    return { status: response.status, body: await response.json() };
  }

  async function reconcile(wallet: WalletRef) {
    const response = await fetch(
      `${app.url}/wallets/${wallet.id}/reconciliation`,
      { method: 'POST' },
    );
    return { status: response.status, body: await response.json() };
  }

  async function walletWithBets(count: number) {
    const wallet = await createWallet(app.url, '100.00');
    for (let index = 0; index < count; index++) {
      await submit(app.url, betFor(wallet, '1.00'));
    }
    return wallet;
  }

  describe('GET /wallets/:walletId/ledger', () => {
    it('lists the newest entries first, page by page, until there is no next cursor', async () => {
      const wallet = await walletWithBets(4);

      const first = await get(`/wallets/${wallet.id}/ledger?limit=2`);
      const second = await get(
        `/wallets/${wallet.id}/ledger?limit=2&cursor=${first.body.nextCursor}`,
      );
      const third = await get(
        `/wallets/${wallet.id}/ledger?limit=2&cursor=${second.body.nextCursor}`,
      );

      const balances = [first, second, third].flatMap((page) =>
        page.body.items.map(
          (item: { balanceAfter: { amount: string } }) =>
            item.balanceAfter.amount,
        ),
      );
      expect(balances).toEqual(['96.00', '97.00', '98.00', '99.00', '100.00']);
      expect(third.body.nextCursor).toBeNull();
      expect(first.body.items[0]).toEqual({
        id: expect.any(String),
        transactionId: expect.any(String),
        direction: 'DEBIT',
        money: { amount: '1.00', currency: 'BRL' },
        balanceBefore: { amount: '97.00', currency: 'BRL' },
        balanceAfter: { amount: '96.00', currency: 'BRL' },
        createdAt: expect.any(String),
      });
    });

    it('keeps the following pages stable when new entries arrive', async () => {
      const wallet = await walletWithBets(3);
      const first = await get(`/wallets/${wallet.id}/ledger?limit=2`);

      await submit(app.url, betFor(wallet, '1.00'));
      const second = await get(
        `/wallets/${wallet.id}/ledger?limit=2&cursor=${first.body.nextCursor}`,
      );

      expect(
        second.body.items.map(
          (item: { balanceAfter: { amount: string } }) =>
            item.balanceAfter.amount,
        ),
      ).toEqual(['99.00', '100.00']);
      expect(second.body.nextCursor).toBeNull();
    });

    it('uses a default page size of 50', async () => {
      const wallet = await walletWithBets(2);

      const { body } = await get(`/wallets/${wallet.id}/ledger`);

      expect(body.items).toHaveLength(3);
      expect(body.nextCursor).toBeNull();
    });

    it.each([
      ['a cursor that is not ours', 'cursor=not-a-cursor', 'INVALID_CURSOR'],
      ['a limit above 100', 'limit=101', 'INVALID_PAYLOAD'],
      ['a limit of zero', 'limit=0', 'INVALID_PAYLOAD'],
    ])('rejects %s with 400', async (_, query, code) => {
      const wallet = await walletWithBets(0);

      const { status, body } = await get(
        `/wallets/${wallet.id}/ledger?${query}`,
      );

      expect(status).toBe(400);
      expect(body).toMatchObject({ code });
    });

    it('returns 404 for an unknown wallet', async () => {
      const { status, body } = await get(`/wallets/${randomUUID()}/ledger`);

      expect(status).toBe(404);
      expect(body).toMatchObject({ code: 'WALLET_NOT_FOUND' });
    });
  });

  describe('GET transaction', () => {
    it('finds a transaction by its id and by the provider id', async () => {
      const wallet = await createWallet(app.url, '10.00');
      const bet = betFor(wallet, '25.00');
      const { transactionId } = await (await submit(app.url, bet)).json();

      const byId = await get(`/wagering/transactions/${transactionId}`);
      const byProvider = await get(
        `/providers/${bet.providerId}/wagering/transactions/${bet.externalTransactionId}`,
      );

      expect(byId.status).toBe(200);
      expect(byId.body).toEqual({
        transactionId,
        providerId: bet.providerId,
        externalTransactionId: bet.externalTransactionId,
        walletId: wallet.id,
        playerId: wallet.playerId,
        roundId: bet.roundId,
        gameId: bet.gameId,
        kind: 'BET',
        money: { amount: '25.00', currency: 'BRL' },
        status: 'REJECTED',
        failureCode: 'INSUFFICIENT_FUNDS',
        referenceExternalTransactionId: null,
        referenceTransactionId: null,
        balance: { amount: '10.00', currency: 'BRL' },
        createdAt: expect.any(String),
        processedAt: expect.any(String),
      });
      expect(byProvider.body).toEqual(byId.body);
    });

    it('returns 404 for unknown transactions', async () => {
      const byId = await get(`/wagering/transactions/${randomUUID()}`);
      const byProvider = await get(
        `/providers/provider-a/wagering/transactions/${randomUUID()}`,
      );

      expect([byId.status, byProvider.status]).toEqual([404, 404]);
      expect(byId.body).toMatchObject({ code: 'TRANSACTION_NOT_FOUND' });
    });

    it('returns 400 when the transaction id is not a UUID', async () => {
      const { status } = await get('/wagering/transactions/not-a-uuid');

      expect(status).toBe(400);
    });
  });

  describe('POST /wallets/:walletId/reconciliation', () => {
    it('confirms a wallet whose balance matches its ledger', async () => {
      const wallet = await walletWithBets(3);

      const { status, body } = await reconcile(wallet);

      expect(status).toBe(200);
      expect(body).toEqual({
        walletId: wallet.id,
        storedBalance: { amount: '97.00', currency: 'BRL' },
        calculatedBalance: { amount: '97.00', currency: 'BRL' },
        difference: { amount: '0.00', currency: 'BRL' },
        consistent: true,
        checkedEntries: 4,
      });
    });

    it('confirms a wallet opened with zero and no entries', async () => {
      const wallet = await createWallet(app.url, '0.00');

      const { body } = await reconcile(wallet);

      expect(body).toMatchObject({
        calculatedBalance: { amount: '0.00', currency: 'BRL' },
        consistent: true,
        checkedEntries: 0,
      });
    });

    it('flags a divergence without correcting it', async () => {
      const wallet = await walletWithBets(1);
      await database.orm.em
        .getConnection()
        .execute("update wallets set balance = '120.00' where id = ?", [
          wallet.id,
        ]);

      const { body } = await reconcile(wallet);

      expect(body).toMatchObject({
        storedBalance: { amount: '120.00', currency: 'BRL' },
        calculatedBalance: { amount: '99.00', currency: 'BRL' },
        difference: { amount: '21.00', currency: 'BRL' },
        consistent: false,
      });
      const current = await get(`/wallets/${wallet.id}`);
      expect(current.body.balance).toEqual({
        amount: '120.00',
        currency: 'BRL',
      });
    });

    it('returns 404 for an unknown wallet', async () => {
      const { status } = await reconcile({ id: randomUUID(), playerId: '' });

      expect(status).toBe(404);
    });
  });
});
