import { describe, expect, it } from 'bun:test';
import { Money } from '../money/money.js';
import { CurrencyMismatchError } from '../money/money.errors.js';
import {
  LedgerDirection,
  type LedgerEntryState,
  WalletLedgerEntry,
} from './wallet-ledger-entry.js';
import { InvalidLedgerEntryError } from './wallet.errors.js';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });

const entryProps = (
  overrides: Partial<LedgerEntryState> = {},
): LedgerEntryState => ({
  id: 'entry-1',
  walletId: 'wallet-1',
  transactionId: 'transaction-1',
  direction: LedgerDirection.Debit,
  money: brl('25.00'),
  balanceBefore: brl('100.00'),
  balanceAfter: brl('75.00'),
  createdAt: new Date('2026-10-21T12:00:00Z'),
  ...overrides,
});

describe('WalletLedgerEntry', () => {
  it('creates a balanced debit', () => {
    const entry = WalletLedgerEntry.create(entryProps());

    expect(entry.isBalanced()).toBe(true);
    expect(entry.balanceAfter.equals(brl('75.00'))).toBe(true);
  });

  it('creates a balanced credit', () => {
    const entry = WalletLedgerEntry.create(
      entryProps({
        direction: LedgerDirection.Credit,
        balanceAfter: brl('125.00'),
      }),
    );

    expect(entry.isBalanced()).toBe(true);
  });

  it('rejects an entry whose arithmetic does not add up', () => {
    expect(() =>
      WalletLedgerEntry.create(entryProps({ balanceAfter: brl('80.00') })),
    ).toThrow(InvalidLedgerEntryError);
  });

  it('rejects a credit recorded with debit arithmetic', () => {
    expect(() =>
      WalletLedgerEntry.create(
        entryProps({ direction: LedgerDirection.Credit }),
      ),
    ).toThrow(InvalidLedgerEntryError);
  });

  it('rejects a zero amount', () => {
    expect(() =>
      WalletLedgerEntry.create(
        entryProps({ money: brl('0.00'), balanceAfter: brl('100.00') }),
      ),
    ).toThrow(InvalidLedgerEntryError);
  });

  it('rejects an entry that leaves a negative balance', () => {
    expect(() =>
      WalletLedgerEntry.create(
        entryProps({
          balanceBefore: brl('10.00'),
          balanceAfter: brl('10.00').subtract(brl('25.00')),
        }),
      ),
    ).toThrow(InvalidLedgerEntryError);
  });

  it('rejects mixed currencies', () => {
    expect(() =>
      WalletLedgerEntry.create(
        entryProps({ money: Money.from({ amount: '25.00', currency: 'USD' }) }),
      ),
    ).toThrow(CurrencyMismatchError);
  });

  it('rehydrates persisted state without validating it', () => {
    const entry = WalletLedgerEntry.rehydrate(
      entryProps({ balanceAfter: brl('80.00') }),
    );

    expect(entry.isBalanced()).toBe(false);
  });

  it('cannot be changed after creation', () => {
    const entry = WalletLedgerEntry.create(entryProps());

    expect(() => {
      (entry as { balanceAfter: Money }).balanceAfter = brl('1000.00');
    }).toThrow(TypeError);
    expect(entry.balanceAfter.equals(brl('75.00'))).toBe(true);
  });
});
