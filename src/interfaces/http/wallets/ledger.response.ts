import type { LedgerPage } from '../../../application/wallets/list-ledger.use-case.js';
import type { MoneyProps } from '../../../domain/money/money.js';
import type { LedgerDirection } from '../../../domain/wallet/wallet-ledger-entry.js';
import { encodeLedgerCursor } from './ledger-cursor.js';

export interface LedgerEntryResponse {
  id: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  createdAt: string;
}

export interface LedgerPageResponse {
  items: LedgerEntryResponse[];
  nextCursor: string | null;
}

export function toLedgerPageResponse(page: LedgerPage): LedgerPageResponse {
  const last = page.items.at(-1);
  return {
    items: page.items.map(({ entry }) => ({
      id: entry.id,
      transactionId: entry.transactionId,
      direction: entry.direction,
      money: entry.money.toJSON(),
      balanceBefore: entry.balanceBefore.toJSON(),
      balanceAfter: entry.balanceAfter.toJSON(),
      createdAt: entry.createdAt.toISOString(),
    })),
    nextCursor: page.hasMore && last ? encodeLedgerCursor(last.sequence) : null,
  };
}
