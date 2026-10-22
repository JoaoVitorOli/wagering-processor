import type { WalletLedgerEntry } from '../../../domain/wallet/wallet-ledger-entry.js';

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
};
