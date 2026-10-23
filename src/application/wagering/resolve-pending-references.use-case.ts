import { FailureCode } from '../../domain/wagering/failure-code.js';
import {
  type WagerTransactionKind,
  WagerTransactionStatus,
} from '../../domain/wagering/wager-transaction.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { DueTransaction, UnitOfWork } from '../ports/unit-of-work.js';
import {
  nextReferenceAttemptAt,
  type ReferenceRetryPolicy,
} from './reference-retry-policy.js';
import { TransactionProcessor } from './transaction-processor.js';

export interface ResolvedTransaction {
  kind: WagerTransactionKind;
  status: WagerTransactionStatus;
}

export interface ResolvePendingReferencesResult {
  attempted: number;
  resolved: ResolvedTransaction[];
  rescheduled: number;
  failures: unknown[];
}

export class ResolvePendingReferencesUseCase {
  private readonly processor: TransactionProcessor;

  constructor(
    private readonly unitOfWork: UnitOfWork,
    ids: IdGenerator,
    private readonly clock: Clock,
    private readonly policy: ReferenceRetryPolicy,
  ) {
    this.processor = new TransactionProcessor(ids, clock);
  }

  async execute(limit: number): Promise<ResolvePendingReferencesResult> {
    const now = this.clock.now();
    const due = await this.unitOfWork.run(({ transactions }) =>
      transactions.findDuePendingReferences(now, limit),
    );

    const resolved: ResolvedTransaction[] = [];
    const failures: unknown[] = [];
    let rescheduled = 0;
    for (const item of due) {
      try {
        const outcome = await this.retry(item, now);
        if (outcome === 'rescheduled') {
          rescheduled++;
        } else if (outcome) {
          resolved.push(outcome);
        }
      } catch (error) {
        failures.push(error);
      }
    }
    return { attempted: due.length, resolved, rescheduled, failures };
  }

  private retry(
    { transactionId, walletId }: DueTransaction,
    now: Date,
  ): Promise<ResolvedTransaction | 'rescheduled' | undefined> {
    return this.unitOfWork.run(async (repositories) => {
      const wallet = await repositories.wallets.findByIdForUpdate(walletId);
      const transaction = wallet
        ? await repositories.transactions.findDuePendingReferenceForUpdate(
            transactionId,
            now,
          )
        : undefined;
      if (!wallet || !transaction) {
        return undefined;
      }

      const outcome = await this.processor.process(
        repositories,
        wallet,
        transaction,
      );
      if (outcome.pending) {
        const attempts = transaction.referenceAttempts + 1;
        if (attempts >= this.policy.maxAttempts) {
          transaction.reject({
            code: FailureCode.ReferenceNotFound,
            resultBalance: wallet.balance,
            at: this.clock.now(),
          });
        } else {
          transaction.scheduleReferenceRetry({
            nextAttemptAt: nextReferenceAttemptAt(
              this.policy,
              attempts,
              this.clock.now(),
            ),
          });
        }
      }

      await repositories.transactions.update(transaction);
      if (transaction.status === WagerTransactionStatus.PendingReference) {
        return 'rescheduled';
      }
      await repositories.outbox.add(
        this.processor.events(
          transaction,
          wallet,
          outcome.pending ? undefined : outcome.entry,
        ),
      );
      return { kind: transaction.kind, status: transaction.status };
    });
  }
}
