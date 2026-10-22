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

export interface TransactionBody {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: { amount: string; currency: string };
  referenceExternalTransactionId?: string;
}

export function transactionFor(
  wallet: WalletRef,
  kind: string,
  amount: string,
  overrides: Partial<TransactionBody> = {},
): TransactionBody {
  return {
    providerId: 'provider-a',
    externalTransactionId: randomUUID(),
    playerId: wallet.playerId,
    walletId: wallet.id,
    roundId: 'round-1',
    gameId: 'fortune-chimp',
    kind,
    money: { amount, currency: 'BRL' },
    ...overrides,
  };
}

export function betFor(
  wallet: WalletRef,
  amount: string,
  externalTransactionId: string = randomUUID(),
): TransactionBody {
  return transactionFor(wallet, 'BET', amount, { externalTransactionId });
}

export function submit(url: string, bet: TransactionBody) {
  return fetch(`${url}/wagering/transactions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': `${bet.providerId}:${bet.externalTransactionId}`,
    },
    body: JSON.stringify(bet),
  });
}
