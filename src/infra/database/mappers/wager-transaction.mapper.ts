import type { WagerTransaction } from '../../../domain/wagering/wager-transaction.js';

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
    };
  },
};
