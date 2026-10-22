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
  type TransactionBody,
  transactionFor,
  type WalletRef,
} from '../../support/wagering-client.js';

describe('wagering HTTP: WIN, LOSS, REFUND and ROLLBACK', () => {
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

  async function send(body: TransactionBody) {
    const response = await submit(app.url, body);
    return { status: response.status, body: await response.json() };
  }

  async function placeBet(wallet: WalletRef, amount = '25.00') {
    const bet = betFor(wallet, amount);
    await send(bet);
    return bet;
  }

  function referencing(
    wallet: WalletRef,
    kind: string,
    reference: TransactionBody,
    overrides: Partial<TransactionBody> = {},
  ) {
    return transactionFor(wallet, kind, reference.money.amount, {
      referenceExternalTransactionId: reference.externalTransactionId,
      ...overrides,
    });
  }

  async function ledgerOf(wallet: WalletRef) {
    const [row] = await database.orm.em
      .getConnection()
      .execute<{ balance: string; entries: string }[]>(
        `select w.balance, (select count(*) from wallet_ledger_entries e where e.wallet_id = w.id) as entries
         from wallets w where w.id = ?`,
        [wallet.id],
      );
    return row;
  }

  describe('WIN', () => {
    it('credits the wallet without a reference', async () => {
      const wallet = await createWallet(app.url, '100.00');

      const { status, body } = await send(
        transactionFor(wallet, 'WIN', '40.00'),
      );

      expect(status).toBe(200);
      expect(body).toMatchObject({
        status: 'PROCESSED',
        balance: { amount: '140.00', currency: 'BRL' },
      });
    });

    it('credits the wallet when it references the BET of the round', async () => {
      const wallet = await createWallet(app.url, '100.00');
      const bet = await placeBet(wallet);

      const { body } = await send(
        referencing(wallet, 'WIN', bet, {
          money: { amount: '60.00', currency: 'BRL' },
        }),
      );

      expect(body).toMatchObject({
        status: 'PROCESSED',
        balance: { amount: '135.00', currency: 'BRL' },
      });
    });
  });

  describe('LOSS', () => {
    it('records the result without moving the balance', async () => {
      const wallet = await createWallet(app.url, '100.00');
      const bet = await placeBet(wallet);

      const { status, body } = await send(
        referencing(wallet, 'LOSS', bet, {
          money: { amount: '0.00', currency: 'BRL' },
        }),
      );

      expect(status).toBe(200);
      expect(body).toMatchObject({
        status: 'PROCESSED',
        balance: { amount: '75.00', currency: 'BRL' },
      });
      expect(await ledgerOf(wallet)).toEqual({
        balance: '75.00',
        entries: '2',
      });
    });
  });

  describe('REFUND', () => {
    it('credits the amount of the BET back', async () => {
      const wallet = await createWallet(app.url, '100.00');
      const bet = await placeBet(wallet);

      const { status, body } = await send(referencing(wallet, 'REFUND', bet));

      expect(status).toBe(200);
      expect(body).toMatchObject({
        status: 'PROCESSED',
        balance: { amount: '100.00', currency: 'BRL' },
      });
    });

    it('rejects a REFUND of a WIN', async () => {
      const wallet = await createWallet(app.url, '100.00');
      const win = transactionFor(wallet, 'WIN', '10.00');
      await send(win);

      const { status, body } = await send(referencing(wallet, 'REFUND', win));

      expect(status).toBe(422);
      expect(body).toMatchObject({ failureCode: 'REFERENCE_KIND_NOT_ALLOWED' });
    });

    it('rejects a different amount', async () => {
      const wallet = await createWallet(app.url, '100.00');
      const bet = await placeBet(wallet);

      const { body } = await send(
        referencing(wallet, 'REFUND', bet, {
          money: { amount: '10.00', currency: 'BRL' },
        }),
      );

      expect(body).toMatchObject({ failureCode: 'AMOUNT_MISMATCH' });
    });

    it('rejects a REFUND of a rejected BET', async () => {
      const wallet = await createWallet(app.url, '10.00');
      const bet = await placeBet(wallet, '25.00');

      const { body } = await send(referencing(wallet, 'REFUND', bet));

      expect(body).toMatchObject({ failureCode: 'REFERENCE_NOT_PROCESSED' });
    });

    it('rejects a reference from another round', async () => {
      const wallet = await createWallet(app.url, '100.00');
      const bet = await placeBet(wallet);

      const { body } = await send(
        referencing(wallet, 'REFUND', bet, { roundId: 'round-2' }),
      );

      expect(body).toMatchObject({ failureCode: 'REFERENCE_CONTEXT_MISMATCH' });
    });

    it('rejects a reference from another wallet', async () => {
      const wallet = await createWallet(app.url, '100.00');
      const other = await createWallet(app.url, '100.00');
      const bet = await placeBet(wallet);

      const { body } = await send(referencing(other, 'REFUND', bet));

      expect(body).toMatchObject({ failureCode: 'REFERENCE_CONTEXT_MISMATCH' });
    });
  });

  describe('ROLLBACK', () => {
    it('credits a rolled back BET', async () => {
      const wallet = await createWallet(app.url, '100.00');
      const bet = await placeBet(wallet);

      const { body } = await send(referencing(wallet, 'ROLLBACK', bet));

      expect(body).toMatchObject({
        status: 'PROCESSED',
        balance: { amount: '100.00', currency: 'BRL' },
      });
    });

    it('debits a rolled back WIN', async () => {
      const wallet = await createWallet(app.url, '100.00');
      const win = transactionFor(wallet, 'WIN', '30.00');
      await send(win);

      const { body } = await send(referencing(wallet, 'ROLLBACK', win));

      expect(body).toMatchObject({
        status: 'PROCESSED',
        balance: { amount: '100.00', currency: 'BRL' },
      });
    });

    it('rejects a ROLLBACK that would overdraw, with its own code', async () => {
      const wallet = await createWallet(app.url, '0.00');
      const win = transactionFor(wallet, 'WIN', '30.00');
      await send(win);
      await send(betFor(wallet, '20.00'));

      const { status, body } = await send(referencing(wallet, 'ROLLBACK', win));

      expect(status).toBe(422);
      expect(body).toMatchObject({
        status: 'REJECTED',
        failureCode: 'REVERSAL_WOULD_OVERDRAW',
        balance: { amount: '10.00', currency: 'BRL' },
      });
      expect((await ledgerOf(wallet)).balance).toBe('10.00');
    });

    it('rejects a ROLLBACK of a ROLLBACK', async () => {
      const wallet = await createWallet(app.url, '100.00');
      const bet = await placeBet(wallet);
      const rollback = referencing(wallet, 'ROLLBACK', bet);
      await send(rollback);

      const { body } = await send(referencing(wallet, 'ROLLBACK', rollback));

      expect(body).toMatchObject({ failureCode: 'REFERENCE_KIND_NOT_ALLOWED' });
    });

    it('allows a ROLLBACK of a REFUND', async () => {
      const wallet = await createWallet(app.url, '100.00');
      const bet = await placeBet(wallet);
      const refund = referencing(wallet, 'REFUND', bet);
      await send(refund);

      const { body } = await send(referencing(wallet, 'ROLLBACK', refund));

      expect(body).toMatchObject({
        status: 'PROCESSED',
        balance: { amount: '75.00', currency: 'BRL' },
      });
    });
  });

  describe('one reversal per transaction', () => {
    it.each([
      ['REFUND', 'REFUND'],
      ['REFUND', 'ROLLBACK'],
      ['ROLLBACK', 'REFUND'],
    ])('rejects a %s after a %s of the same BET', async (second, first) => {
      const wallet = await createWallet(app.url, '100.00');
      const bet = await placeBet(wallet);
      await send(referencing(wallet, first, bet));

      const { status, body } = await send(referencing(wallet, second, bet));

      expect(status).toBe(422);
      expect(body).toMatchObject({ failureCode: 'REFERENCE_ALREADY_REVERSED' });
      expect((await ledgerOf(wallet)).balance).toBe('100.00');
    });
  });

  describe('missing reference', () => {
    it('keeps the transaction as PENDING_REFERENCE without moving the balance', async () => {
      const wallet = await createWallet(app.url, '100.00');

      const { status, body } = await send(
        transactionFor(wallet, 'REFUND', '25.00', {
          referenceExternalTransactionId: randomUUID(),
        }),
      );

      expect(status).toBe(202);
      expect(body).toMatchObject({
        status: 'PENDING_REFERENCE',
        balance: { amount: '100.00', currency: 'BRL' },
      });
      expect(await ledgerOf(wallet)).toEqual({
        balance: '100.00',
        entries: '1',
      });
    });
  });

  describe('invalid combinations', () => {
    it.each([
      ['REFUND without a reference', 'REFUND', undefined],
      ['BET with a reference', 'BET', 'some-bet'],
    ])('rejects %s with 400', async (_, kind, reference) => {
      const wallet = await createWallet(app.url, '100.00');

      const { status, body } = await send(
        transactionFor(wallet, kind, '10.00', {
          referenceExternalTransactionId: reference,
        }),
      );

      expect(status).toBe(400);
      expect(body).toMatchObject({ code: 'INVALID_WAGER_TRANSACTION' });
    });
  });
});
