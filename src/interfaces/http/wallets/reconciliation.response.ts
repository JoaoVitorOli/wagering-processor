import type { Reconciliation } from '../../../application/wallets/reconcile-wallet.use-case.js';
import type { MoneyProps } from '../../../domain/money/money.js';

export interface ReconciliationResponse {
  walletId: string;
  storedBalance: MoneyProps;
  calculatedBalance: MoneyProps;
  difference: MoneyProps;
  consistent: boolean;
  checkedEntries: number;
}

export function toReconciliationResponse(
  reconciliation: Reconciliation,
): ReconciliationResponse {
  return {
    walletId: reconciliation.walletId,
    storedBalance: reconciliation.storedBalance.toJSON(),
    calculatedBalance: reconciliation.calculatedBalance.toJSON(),
    difference: reconciliation.difference.toJSON(),
    consistent: reconciliation.consistent,
    checkedEntries: reconciliation.checkedEntries,
  };
}
