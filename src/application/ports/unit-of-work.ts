import type { WagerTransaction } from '../../domain/wagering/wager-transaction.js';
import type { Wallet } from '../../domain/wallet/wallet.js';
import type { WalletLedgerEntry } from '../../domain/wallet/wallet-ledger-entry.js';
import type { OutboxMessage } from '../outbox/outbox-message.js';

export const UNIT_OF_WORK = Symbol('UnitOfWork');

export interface WalletRepository {
  add(wallet: Wallet): Promise<void>;
  findById(id: string): Promise<Wallet | undefined>;
  findByIdForUpdate(id: string): Promise<Wallet | undefined>;
  update(wallet: Wallet, expectedVersion: number): Promise<void>;
}

export interface DueTransaction {
  transactionId: string;
  walletId: string;
}

export interface WagerTransactionRepository {
  add(transaction: WagerTransaction): Promise<void>;
  addIfAbsent(transaction: WagerTransaction): Promise<boolean>;
  findByIdempotencyKey(key: string): Promise<WagerTransaction | undefined>;
  findByExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | undefined>;
  isReversed(transactionId: string): Promise<boolean>;
  findDuePendingReferences(now: Date, limit: number): Promise<DueTransaction[]>;
  findDuePendingReferenceForUpdate(
    transactionId: string,
    now: Date,
  ): Promise<WagerTransaction | undefined>;
  update(transaction: WagerTransaction): Promise<void>;
}

export interface LedgerRepository {
  add(entry: WalletLedgerEntry): Promise<void>;
}

export interface OutboxRepository {
  add(messages: OutboxMessage[]): Promise<void>;
}

export interface Repositories {
  wallets: WalletRepository;
  transactions: WagerTransactionRepository;
  ledger: LedgerRepository;
  outbox: OutboxRepository;
}

export interface UnitOfWork {
  run<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>;
}
