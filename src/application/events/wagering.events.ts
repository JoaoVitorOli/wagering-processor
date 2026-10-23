import type { MoneyProps } from '../../domain/money/money.js';
import type { WagerTransaction } from '../../domain/wagering/wager-transaction.js';
import type {
  LedgerDirection,
  WalletLedgerEntry,
} from '../../domain/wallet/wallet-ledger-entry.js';
import type { Wallet } from '../../domain/wallet/wallet.js';
import { type EventContext, IntegrationEvent } from './integration-event.js';

export interface WagerTransactionEventData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
  resultBalance: MoneyProps | null;
}

export interface WagerTransactionProcessedData extends WagerTransactionEventData {
  referenceTransactionId?: string;
}

export interface WagerTransactionRejectedData extends WagerTransactionEventData {
  failureCode: string;
}

export interface WalletBalanceChangedData {
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
}

function transactionData(
  transaction: WagerTransaction,
): WagerTransactionEventData {
  return {
    transactionId: transaction.id,
    providerId: transaction.providerId,
    externalTransactionId: transaction.externalTransactionId,
    walletId: transaction.walletId,
    playerId: transaction.playerId,
    roundId: transaction.roundId,
    gameId: transaction.gameId,
    kind: transaction.kind,
    money: transaction.money.toJSON(),
    referenceExternalTransactionId: transaction.referenceExternalTransactionId,
    resultBalance: transaction.resultBalance?.toJSON() ?? null,
  };
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;

  static from(
    transaction: WagerTransaction,
    context: EventContext,
  ): WagerTransactionProcessed {
    return new WagerTransactionProcessed({
      ...context,
      aggregateId: transaction.walletId,
      data: {
        ...transactionData(transaction),
        referenceTransactionId: transaction.referenceTransactionId,
      },
    });
  }
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;

  static from(
    transaction: WagerTransaction,
    context: EventContext,
  ): WagerTransactionRejected {
    return new WagerTransactionRejected({
      ...context,
      aggregateId: transaction.walletId,
      data: {
        ...transactionData(transaction),
        failureCode: transaction.failureCode ?? '',
      },
    });
  }
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionEventData> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;

  static from(
    transaction: WagerTransaction,
    context: EventContext,
  ): WagerTransactionPendingReference {
    return new WagerTransactionPendingReference({
      ...context,
      aggregateId: transaction.walletId,
      data: transactionData(transaction),
    });
  }
}

export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;

  static from(
    wallet: Wallet,
    entry: WalletLedgerEntry,
    context: EventContext,
  ): WalletBalanceChanged {
    return new WalletBalanceChanged({
      ...context,
      aggregateId: wallet.id,
      data: {
        walletId: wallet.id,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        walletVersion: wallet.version,
      },
    });
  }
}
