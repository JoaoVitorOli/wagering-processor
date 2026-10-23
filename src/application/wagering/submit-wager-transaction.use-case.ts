import { Money, type MoneyProps } from '../../domain/money/money.js';
import { FailureCode } from '../../domain/wagering/failure-code.js';
import {
  WagerTransaction,
  type WagerTransactionKind,
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
import type { Repositories, UnitOfWork } from '../ports/unit-of-work.js';
import { WalletNotFoundError } from '../wallets/wallet.errors.js';
import { hashPayload } from './payload-hash.js';
import {
  ExternalTransactionConflictError,
  IdempotencyConflictError,
} from './wagering.errors.js';

export interface SubmitWagerTransactionInput {
  idempotencyKey: string;
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
}

export interface SubmitWagerTransactionResult {
  transaction: WagerTransaction;
  idempotentReplay: boolean;
}

type Resolution =
  | { reference: WagerTransaction | undefined }
  | { failure: FailureCode }
  | { pending: true };

export class SubmitWagerTransactionUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: SubmitWagerTransactionInput,
  ): Promise<SubmitWagerTransactionResult> {
    const money = Money.from(input.money);
    const payloadHash = hashPayload({
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      playerId: input.playerId,
      walletId: input.walletId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money: money.toJSON(),
      referenceExternalTransactionId: input.referenceExternalTransactionId,
    });
    const transaction = WagerTransaction.create({
      id: this.ids.next(),
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      idempotencyKey: input.idempotencyKey,
      payloadHash,
      walletId: input.walletId,
      playerId: input.playerId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money,
      referenceExternalTransactionId: input.referenceExternalTransactionId,
      createdAt: this.clock.now(),
    });

    return this.unitOfWork.run(async (repositories) => {
      const wallet = await repositories.wallets.findByIdForUpdate(
        input.walletId,
      );
      if (!wallet) {
        throw new WalletNotFoundError(input.walletId);
      }

      if (!(await repositories.transactions.addIfAbsent(transaction))) {
        return this.replay(repositories, transaction);
      }

      const entry = await this.process(repositories, wallet, transaction);
      await repositories.transactions.update(transaction);
      await repositories.outbox.add(
        eventsForTransaction(transaction, wallet, entry, () => ({
          eventId: this.ids.next(),
          correlationId: transaction.id,
          occurredAt: this.clock.now(),
        })).map(OutboxMessage.enqueue),
      );
      return { transaction, idempotentReplay: false };
    });
  }

  private async replay(
    { transactions }: Repositories,
    submitted: WagerTransaction,
  ): Promise<SubmitWagerTransactionResult> {
    const existing = await transactions.findByIdempotencyKey(
      submitted.idempotencyKey,
    );
    if (!existing) {
      throw new ExternalTransactionConflictError(
        submitted.providerId,
        submitted.externalTransactionId,
      );
    }
    if (!existing.matchesPayload(submitted.payloadHash)) {
      throw new IdempotencyConflictError(submitted.idempotencyKey);
    }
    return { transaction: existing, idempotentReplay: true };
  }

  private async process(
    repositories: Repositories,
    wallet: Wallet,
    transaction: WagerTransaction,
  ): Promise<WalletLedgerEntry | undefined> {
    const at = this.clock.now();
    const reject = (code: FailureCode) => {
      transaction.reject({ code, resultBalance: wallet.balance, at });
      return undefined;
    };

    const contextFailure = this.checkWallet(wallet, transaction);
    if (contextFailure) {
      return reject(contextFailure);
    }

    const resolution = await this.resolveReference(repositories, transaction);
    if ('pending' in resolution) {
      transaction.markPendingReference({ resultBalance: wallet.balance });
      return undefined;
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
      return undefined;
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
    return entry;
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
}
