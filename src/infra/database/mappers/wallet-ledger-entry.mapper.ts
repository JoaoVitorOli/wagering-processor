import { Money } from '../../../domain/money/money.js';
import { WalletLedgerEntry } from '../../../domain/wallet/wallet-ledger-entry.js';
import type { WalletLedgerEntryRecord } from '../entities/wallet-ledger-entry.entity.js';

export const WalletLedgerEntryMapper = {
  toRecord(entry: WalletLedgerEntry) {
    return {
      id: entry.id,
      wallet: entry.walletId,
      transaction: entry.transactionId,
      direction: entry.direction,
      amount: entry.money.toJSON().amount,
      balanceBefore: entry.balanceBefore.toJSON().amount,
      balanceAfter: entry.balanceAfter.toJSON().amount,
      createdAt: entry.createdAt,
    };
  },

  toDomain(record: WalletLedgerEntryRecord): WalletLedgerEntry {
    const money = (amount: string) =>
      Money.from({ amount, currency: record.wallet.currency });

    return WalletLedgerEntry.rehydrate({
      id: record.id,
      walletId: record.wallet.id,
      transactionId: record.transaction.id,
      direction: record.direction,
      money: money(record.amount),
      balanceBefore: money(record.balanceBefore),
      balanceAfter: money(record.balanceAfter),
      createdAt: record.createdAt,
    });
  },
};
