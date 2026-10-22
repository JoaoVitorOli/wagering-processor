import { z } from 'zod';

const identifier = z.string().min(1).max(255);

export const idempotencyKeySchema = identifier;

export const submitTransactionRequestSchema = z.object({
  providerId: identifier,
  externalTransactionId: identifier,
  playerId: z.uuid(),
  walletId: z.uuid(),
  roundId: identifier,
  gameId: identifier,
  kind: z.literal('BET'),
  money: z.object({
    amount: z.string(),
    currency: z.string(),
  }),
});

export type SubmitTransactionRequest = z.infer<
  typeof submitTransactionRequestSchema
>;
