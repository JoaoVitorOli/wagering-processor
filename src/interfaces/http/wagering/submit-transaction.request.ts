import { z } from 'zod';
import { WagerTransactionKind } from '../../../domain/wagering/wager-transaction.js';

const identifier = z.string().min(1).max(255);

export const idempotencyKeySchema = identifier;

export const submitTransactionRequestSchema = z.object({
  providerId: identifier,
  externalTransactionId: identifier,
  playerId: z.uuid(),
  walletId: z.uuid(),
  roundId: identifier,
  gameId: identifier,
  kind: z.enum([
    WagerTransactionKind.Bet,
    WagerTransactionKind.Win,
    WagerTransactionKind.Loss,
    WagerTransactionKind.Refund,
    WagerTransactionKind.Rollback,
  ]),
  money: z.object({
    amount: z.string(),
    currency: z.string(),
  }),
  referenceExternalTransactionId: identifier.optional(),
});

export type SubmitTransactionRequest = z.infer<
  typeof submitTransactionRequestSchema
>;
