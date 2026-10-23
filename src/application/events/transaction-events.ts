import {
  type WagerTransaction,
  WagerTransactionStatus,
} from '../../domain/wagering/wager-transaction.js';
import type { WalletLedgerEntry } from '../../domain/wallet/wallet-ledger-entry.js';
import type { Wallet } from '../../domain/wallet/wallet.js';
import type { EventContext, IntegrationEvent } from './integration-event.js';
import {
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
} from './wagering.events.js';

export function eventsForTransaction(
  transaction: WagerTransaction,
  wallet: Wallet,
  entry: WalletLedgerEntry | undefined,
  nextContext: () => EventContext,
): IntegrationEvent<unknown>[] {
  switch (transaction.status) {
    case WagerTransactionStatus.Processed:
      return [
        WagerTransactionProcessed.from(transaction, nextContext()),
        ...(entry
          ? [WalletBalanceChanged.from(wallet, entry, nextContext())]
          : []),
      ];
    case WagerTransactionStatus.Rejected:
      return [WagerTransactionRejected.from(transaction, nextContext())];
    case WagerTransactionStatus.PendingReference:
      return [
        WagerTransactionPendingReference.from(transaction, nextContext()),
      ];
    default:
      return [];
  }
}
