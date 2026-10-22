import { Money } from '../../../domain/money/money.js';
import { Wallet } from '../../../domain/wallet/wallet.js';
import type { WalletRecord } from '../entities/wallet.entity.js';

export const WalletMapper = {
  toRecord(wallet: Wallet): WalletRecord {
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      currency: wallet.currency,
      balance: wallet.balance.toJSON().amount,
      version: wallet.version,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    };
  },

  toDomain(record: WalletRecord): Wallet {
    return Wallet.rehydrate({
      id: record.id,
      playerId: record.playerId,
      currency: record.currency,
      balance: Money.from({
        amount: record.balance,
        currency: record.currency,
      }),
      version: record.version,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  },
};
