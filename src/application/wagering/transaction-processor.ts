import { FailureCode } from '../../domain/wagering/failure-code.js';
import {
  type WagerTransaction,
  WagerTransactionStatus,
} from '../../domain/wagering/wager-transaction.js';
import {
  LedgerDirection,
  type WalletLedgerEntry,
} from '../../domain/wallet/wallet-ledger-entry.js';
import type { Wallet } from '../../domain/wallet/wallet.js';
import { eventsForTransaction } from '../events/transaction-events.js';
import { OutboxMessage } from '../outbox/outbox-message.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { Repositories } from '../ports/unit-of-work.js';

export type ProcessingOutcome =
  { pending: true } | { pending: false; entry: WalletLedgerEntry | undefined };

type Resolution =
  | { reference: WagerTransaction | undefined }
  | { failure: FailureCode }
  | { pending: true };

export class TransactionProcessor {
  constructor(
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async process(
    repositories: Repositories,
    wallet: Wallet,
    transaction: WagerTransaction,
  ): Promise<ProcessingOutcome> {
    const at = this.clock.now();
    const reject = (code: FailureCode): ProcessingOutcome => {
      transaction.reject({ code, resultBalance: wallet.balance, at });
      return { pending: false, entry: undefined };
    };

    const contextFailure = this.checkWallet(wallet, transaction);
    if (contextFailure) {
      return reject(contextFailure);
    }

    const resolution = await this.resolveReference(repositories, transaction);
    if ('pending' in resolution) {
      return { pending: true };
    }
    if ('failure' in resolution) {
      return reject(resolution.failure);
    }
    const { reference } = resolution;

    if (!transaction.affectsBalance()) {
      transaction.markProcessed({
        resultBalance: wallet.balance,
        referenceTransactionId: reference?.id,
        at,
      });
      return { pending: false, entry: undefined };
    }

    const direction = transaction.ledgerDirectionFor(reference);
    if (
      direction === LedgerDirection.Debit &&
      !wallet.canDebit(transaction.money)
    ) {
      return reject(
        transaction.isReversal()
          ? FailureCode.ReversalWouldOverdraw
          : FailureCode.InsufficientFunds,
      );
    }

    const previousVersion = wallet.version;
    const movement = {
      entryId: this.ids.next(),
      transactionId: transaction.id,
      amount: transaction.money,
      at,
    };
    const entry =
      direction === LedgerDirection.Debit
        ? wallet.debit(movement)
        : wallet.credit(movement);
    await repositories.wallets.update(wallet, previousVersion);
    await repositories.ledger.add(entry);
    transaction.markProcessed({
      resultBalance: wallet.balance,
      referenceTransactionId: reference?.id,
      at,
    });
    return { pending: false, entry };
  }

  private checkWallet(
    wallet: Wallet,
    transaction: WagerTransaction,
  ): FailureCode | undefined {
    if (transaction.money.currency !== wallet.currency) {
      return FailureCode.CurrencyMismatch;
    }
    if (transaction.playerId !== wallet.playerId) {
      return FailureCode.PlayerMismatch;
    }
    return undefined;
  }

  private async resolveReference(
    { transactions }: Repositories,
    transaction: WagerTransaction,
  ): Promise<Resolution> {
    const externalId = transaction.referenceExternalTransactionId;
    if (!externalId) {
      return { reference: undefined };
    }

    const reference = await transactions.findByExternalId(
      transaction.providerId,
      externalId,
    );
    if (!reference) {
      return { pending: true };
    }
    if (!transaction.sharesContextWith(reference)) {
      return { failure: FailureCode.ReferenceContextMismatch };
    }
    if (!transaction.canReference(reference)) {
      return { failure: FailureCode.ReferenceKindNotAllowed };
    }
    if (reference.status === WagerTransactionStatus.PendingReference) {
      return { pending: true };
    }
    if (reference.status !== WagerTransactionStatus.Processed) {
      return { failure: FailureCode.ReferenceNotProcessed };
    }
    if (transaction.isReversal()) {
      if (!transaction.money.equals(reference.money)) {
        return { failure: FailureCode.AmountMismatch };
      }
      if (await transactions.isReversed(reference.id)) {
        return { failure: FailureCode.ReferenceAlreadyReversed };
      }
    }
    return { reference };
  }

  events(
    transaction: WagerTransaction,
    wallet: Wallet,
    entry: WalletLedgerEntry | undefined,
  ): OutboxMessage[] {
    return eventsForTransaction(transaction, wallet, entry, () => ({
      eventId: this.ids.next(),
      correlationId: transaction.id,
      occurredAt: this.clock.now(),
    })).map(OutboxMessage.enqueue);
  }
}
