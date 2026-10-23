import { Money } from '../../../domain/money/money.js';
import type { FailureCode } from '../../../domain/wagering/failure-code.js';
import { WagerTransaction } from '../../../domain/wagering/wager-transaction.js';
import type { WagerTransactionRecord } from '../entities/wager-transaction.entity.js';

export const WagerTransactionMapper = {
  toRecord(transaction: WagerTransaction) {
    return {
      id: transaction.id,
      providerId: transaction.providerId,
      externalTransactionId: transaction.externalTransactionId,
      idempotencyKey: transaction.idempotencyKey,
      payloadHash: transaction.payloadHash,
      wallet: transaction.walletId,
      playerId: transaction.playerId,
      roundId: transaction.roundId,
      gameId: transaction.gameId,
      kind: transaction.kind,
      amount: transaction.money.toJSON().amount,
      currency: transaction.money.currency,
      referenceExternalTransactionId:
        transaction.referenceExternalTransactionId ?? null,
      referenceTransaction: transaction.referenceTransactionId ?? null,
      status: transaction.status,
      failureCode: transaction.failureCode ?? null,
      resultBalance: transaction.resultBalance?.toJSON().amount ?? null,
      createdAt: transaction.createdAt,
      processedAt: transaction.processedAt ?? null,
      referenceAttempts: transaction.referenceAttempts,
      nextReferenceAttemptAt: transaction.nextReferenceAttemptAt ?? null,
    };
  },
  toDomain(record: WagerTransactionRecord): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: record.id,
      providerId: record.providerId,
      externalTransactionId: record.externalTransactionId,
      idempotencyKey: record.idempotencyKey,
      payloadHash: record.payloadHash,
      walletId: record.wallet.id,
      playerId: record.playerId,
      roundId: record.roundId,
      gameId: record.gameId,
      kind: record.kind,
      money: Money.from({ amount: record.amount, currency: record.currency }),
      referenceExternalTransactionId:
        record.referenceExternalTransactionId ?? undefined,
      referenceTransactionId: record.referenceTransaction?.id,
      status: record.status,
      failureCode: (record.failureCode as FailureCode | null) ?? undefined,
      resultBalance: record.resultBalance
        ? Money.from({
            amount: record.resultBalance,
            currency: record.wallet.currency,
          })
        : undefined,
      createdAt: record.createdAt,
      processedAt: record.processedAt ?? undefined,
      referenceAttempts: record.referenceAttempts,
      nextReferenceAttemptAt: record.nextReferenceAttemptAt ?? undefined,
    });
  },
};
