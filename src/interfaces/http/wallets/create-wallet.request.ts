import { z } from 'zod';

export const createWalletRequestSchema = z.object({
  playerId: z.uuid(),
  initialBalance: z.object({
    amount: z.string(),
    currency: z.string(),
  }),
});

export type CreateWalletRequest = z.infer<typeof createWalletRequestSchema>;
