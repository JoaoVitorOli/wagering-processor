import { describe, expect, it } from 'bun:test';
import { Money } from '../money/money.js';
import { CurrencyMismatchError } from '../money/money.errors.js';
import { LedgerDirection, WalletLedgerEntry } from './wallet-ledger-entry.js';
import { Wallet, type WalletMovement } from './wallet.js';
import {
  InsufficientFundsError,
  InvalidMovementAmountError,
} from './wallet.errors.js';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });
const usd = (amount: string) => Money.from({ amount, currency: 'USD' });

const openedAt = new Date('2026-10-21T12:00:00Z');
const movedAt = new Date('2026-10-21T12:05:00Z');

const openWallet = (initialBalance: string) =>
  Wallet.open({
    id: 'wallet-1',
    playerId: 'player-1',
    initialBalance: brl(initialBalance),
    openingTransactionId: 'opening-1',
    openingEntryId: 'entry-0',
    at: openedAt,
  });

let sequence = 0;
const movement = (amount: Money): WalletMovement => {
  sequence += 1;
  return {
    entryId: `entry-${sequence}`,
    transactionId: `transaction-${sequence}`,
    amount,
    at: movedAt,
  };
};

const ledgerBalance = (entries: WalletLedgerEntry[]): Money =>
  entries.reduce(
    (balance, entry) =>
      entry.direction === LedgerDirection.Credit
        ? balance.add(entry.money)
        : balance.subtract(entry.money),
    Money.zero('BRL'),
  );

describe('Wallet', () => {
  describe('open', () => {
    it('opens with a positive balance and a matching opening credit', () => {
      const { wallet, openingEntry } = openWallet('100.00');

      expect(wallet.balance.equals(brl('100.00'))).toBe(true);
      expect(wallet.currency).toBe('BRL');
      expect(wallet.version).toBe(1);
      expect(openingEntry?.direction).toBe(LedgerDirection.Credit);
      expect(openingEntry?.transactionId).toBe('opening-1');
      expect(openingEntry?.balanceBefore.isZero()).toBe(true);
      expect(openingEntry?.balanceAfter.equals(brl('100.00'))).toBe(true);
    });

    it('opens with zero balance and no ledger entry', () => {
      const { wallet, openingEntry } = openWallet('0.00');

      expect(wallet.balance.isZero()).toBe(true);
      expect(wallet.version).toBe(1);
      expect(openingEntry).toBeUndefined();
    });

    it('rejects a negative initial balance', () => {
      expect(() =>
        Wallet.open({
          id: 'wallet-1',
          playerId: 'player-1',
          initialBalance: brl('10.00').negate(),
          openingTransactionId: 'opening-1',
          openingEntryId: 'entry-0',
          at: openedAt,
        }),
      ).toThrow(InvalidMovementAmountError);
    });
  });

  describe('debit', () => {
    it('debits, bumps the version and returns the ledger entry', () => {
      const { wallet } = openWallet('100.00');

      const entry = wallet.debit(movement(brl('80.00')));

      expect(wallet.balance.equals(brl('20.00'))).toBe(true);
      expect(wallet.version).toBe(2);
      expect(wallet.updatedAt).toEqual(movedAt);
      expect(entry.direction).toBe(LedgerDirection.Debit);
      expect(entry.balanceBefore.equals(brl('100.00'))).toBe(true);
      expect(entry.balanceAfter.equals(brl('20.00'))).toBe(true);
    });

    it('can debit the whole balance', () => {
      const { wallet } = openWallet('100.00');

      wallet.debit(movement(brl('100.00')));

      expect(wallet.balance.isZero()).toBe(true);
    });

    it('refuses to go negative and leaves the wallet untouched', () => {
      const { wallet } = openWallet('100.00');
      wallet.debit(movement(brl('80.00')));

      expect(() => wallet.debit(movement(brl('80.00')))).toThrow(
        InsufficientFundsError,
      );
      expect(wallet.balance.equals(brl('20.00'))).toBe(true);
      expect(wallet.version).toBe(2);
    });

    it('tells in advance whether a debit fits the balance', () => {
      const { wallet } = openWallet('100.00');

      expect(wallet.canDebit(brl('100.00'))).toBe(true);
      expect(wallet.canDebit(brl('100.01'))).toBe(false);
    });
  });

  describe('credit', () => {
    it('credits, bumps the version and returns the ledger entry', () => {
      const { wallet } = openWallet('20.00');

      const entry = wallet.credit(movement(brl('50.00')));

      expect(wallet.balance.equals(brl('70.00'))).toBe(true);
      expect(wallet.version).toBe(2);
      expect(entry.direction).toBe(LedgerDirection.Credit);
    });
  });

  describe('invalid movements', () => {
    it.each([
      [
        'debit',
        (wallet: Wallet, amount: Money) => wallet.debit(movement(amount)),
      ],
      [
        'credit',
        (wallet: Wallet, amount: Money) => wallet.credit(movement(amount)),
      ],
    ])('%s rejects another currency without changing the wallet', (_, move) => {
      const { wallet } = openWallet('100.00');

      expect(() => move(wallet, usd('10.00'))).toThrow(CurrencyMismatchError);
      expect(wallet.balance.equals(brl('100.00'))).toBe(true);
      expect(wallet.version).toBe(1);
    });

    it.each([
      [
        'debit',
        (wallet: Wallet, amount: Money) => wallet.debit(movement(amount)),
      ],
      [
        'credit',
        (wallet: Wallet, amount: Money) => wallet.credit(movement(amount)),
      ],
    ])('%s rejects a zero amount', (_, move) => {
      const { wallet } = openWallet('100.00');

      expect(() => move(wallet, brl('0.00'))).toThrow(
        InvalidMovementAmountError,
      );
      expect(wallet.version).toBe(1);
    });

    it('rejects a currency mismatch when checking a debit', () => {
      const { wallet } = openWallet('100.00');

      expect(() => wallet.canDebit(usd('10.00'))).toThrow(
        CurrencyMismatchError,
      );
    });
  });

  it('rehydrates persisted state as is', () => {
    const wallet = Wallet.rehydrate({
      id: 'wallet-1',
      playerId: 'player-1',
      currency: 'BRL',
      balance: brl('42.00'),
      version: 7,
      createdAt: openedAt,
      updatedAt: movedAt,
    });

    expect(wallet.balance.equals(brl('42.00'))).toBe(true);
    expect(wallet.version).toBe(7);
    expect(wallet.updatedAt).toEqual(movedAt);
  });

  it('keeps the balance equal to what the ledger rebuilds', () => {
    const { wallet, openingEntry } = openWallet('100.00');
    const entries = [openingEntry!];

    entries.push(wallet.debit(movement(brl('80.00'))));
    entries.push(wallet.credit(movement(brl('50.00'))));
    entries.push(wallet.debit(movement(brl('50.00'))));

    expect(ledgerBalance(entries).equals(wallet.balance)).toBe(true);
    expect(wallet.balance.equals(brl('20.00'))).toBe(true);
    expect(wallet.version).toBe(4);
  });
});
