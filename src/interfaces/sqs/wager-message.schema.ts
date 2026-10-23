import { z } from 'zod';
import { WagerTransactionKind } from '../../domain/wagering/wager-transaction.js';

const identifier = z.string().min(1).max(255);

export const wagerMessageSchema = z.object({
  messageId: identifier,
  type: z.literal('WagerTransactionRequested'),
  occurredAt: z.iso.datetime(),
  data: z.object({
    providerId: identifier,
    externalTransactionId: identifier,
    idempotencyKey: identifier,
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
    money: z.object({ amount: z.string(), currency: z.string() }),
    referenceExternalTransactionId: identifier.optional(),
  }),
});

export type WagerMessageBody = z.infer<typeof wagerMessageSchema>;
