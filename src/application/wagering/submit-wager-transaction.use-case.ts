import { Money, type MoneyProps } from '../../domain/money/money.js';
import {
  WagerTransaction,
  type WagerTransactionKind,
} from '../../domain/wagering/wager-transaction.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { Repositories, UnitOfWork } from '../ports/unit-of-work.js';
import { WalletNotFoundError } from '../wallets/wallet.errors.js';
import { hashPayload } from './payload-hash.js';
import {
  nextReferenceAttemptAt,
  type ReferenceRetryPolicy,
} from './reference-retry-policy.js';
import { TransactionProcessor } from './transaction-processor.js';
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

export class SubmitWagerTransactionUseCase {
  private readonly processor: TransactionProcessor;

  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly policy: ReferenceRetryPolicy,
  ) {
    this.processor = new TransactionProcessor(ids, clock);
  }

  execute(
    input: SubmitWagerTransactionInput,
  ): Promise<SubmitWagerTransactionResult> {
    return this.unitOfWork.run((repositories) =>
      this.executeIn(repositories, input),
    );
  }

  async executeIn(
    repositories: Repositories,
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

    const wallet = await repositories.wallets.findByIdForUpdate(input.walletId);
    if (!wallet) {
      throw new WalletNotFoundError(input.walletId);
    }

    if (!(await repositories.transactions.addIfAbsent(transaction))) {
      return this.replay(repositories, transaction);
    }

    const outcome = await this.processor.process(
      repositories,
      wallet,
      transaction,
    );
    if (outcome.pending) {
      transaction.markPendingReference({
        resultBalance: wallet.balance,
        nextAttemptAt: nextReferenceAttemptAt(this.policy, 0, this.clock.now()),
      });
    }
    await repositories.transactions.update(transaction);
    await repositories.outbox.add(
      this.processor.events(
        transaction,
        wallet,
        outcome.pending ? undefined : outcome.entry,
      ),
    );
    return { transaction, idempotentReplay: false };
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
}
