import { randomUUID } from 'node:crypto';

export interface WalletRef {
  id: string;
  playerId: string;
}

export async function createWallet(
  url: string,
  amount: string,
  currency = 'BRL',
): Promise<WalletRef> {
  const response = await fetch(`${url}/wallets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      playerId: randomUUID(),
      initialBalance: { amount, currency },
    }),
  });
  return (await response.json()) as WalletRef;
}

export function betFor(
  wallet: WalletRef,
  amount: string,
  externalTransactionId: string = randomUUID(),
) {
  return {
    providerId: 'provider-a',
    externalTransactionId,
    playerId: wallet.playerId,
    walletId: wallet.id,
    roundId: 'round-1',
    gameId: 'fortune-chimp',
    kind: 'BET',
    money: { amount, currency: 'BRL' },
  };
}

export function submit(url: string, bet: ReturnType<typeof betFor>) {
  return fetch(`${url}/wagering/transactions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': `${bet.providerId}:${bet.externalTransactionId}`,
    },
    body: JSON.stringify(bet),
  });
}
