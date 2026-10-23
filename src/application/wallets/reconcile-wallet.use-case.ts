import { Money } from '../../domain/money/money.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';
import { WalletNotFoundError } from './wallet.errors.js';

export interface Reconciliation {
  walletId: string;
  storedBalance: Money;
  calculatedBalance: Money;
  difference: Money;
  consistent: boolean;
  checkedEntries: number;
}

export class ReconcileWalletUseCase {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  execute(walletId: string): Promise<Reconciliation> {
    return this.unitOfWork.run(async ({ wallets, ledger }) => {
      const wallet = await wallets.findByIdForShare(walletId);
      if (!wallet) {
        throw new WalletNotFoundError(walletId);
      }
      const totals = await ledger.totals(walletId);
      const money = (amount: string) =>
        Money.from({ amount, currency: wallet.currency });
      const calculatedBalance = money(totals.credits).subtract(
        money(totals.debits),
      );
      const difference = wallet.balance.subtract(calculatedBalance);

      return {
        walletId,
        storedBalance: wallet.balance,
        calculatedBalance,
        difference,
        consistent: difference.isZero(),
        checkedEntries: totals.entries,
      };
    });
  }
}
