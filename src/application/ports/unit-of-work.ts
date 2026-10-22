import type { WagerTransaction } from '../../domain/wagering/wager-transaction.js';
import type { Wallet } from '../../domain/wallet/wallet.js';
import type { WalletLedgerEntry } from '../../domain/wallet/wallet-ledger-entry.js';

export const UNIT_OF_WORK = Symbol('UnitOfWork');

export interface WalletRepository {
  add(wallet: Wallet): Promise<void>;
  findById(id: string): Promise<Wallet | undefined>;
}

export interface WagerTransactionRepository {
  add(transaction: WagerTransaction): Promise<void>;
}

export interface LedgerRepository {
  add(entry: WalletLedgerEntry): Promise<void>;
}

export interface Repositories {
  wallets: WalletRepository;
  transactions: WagerTransactionRepository;
  ledger: LedgerRepository;
}

export interface UnitOfWork {
  run<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>;
}