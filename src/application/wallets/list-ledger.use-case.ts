import type { Wallet } from '../../domain/wallet/wallet.js';
import type { LedgerPageItem, UnitOfWork } from '../ports/unit-of-work.js';
import { WalletNotFoundError } from './wallet.errors.js';

export interface ListLedgerInput {
  walletId: string;
  beforeSequence?: string;
  limit: number;
}

export interface LedgerPage {
  wallet: Wallet;
  items: LedgerPageItem[];
  hasMore: boolean;
}

export class ListLedgerUseCase {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  execute(input: ListLedgerInput): Promise<LedgerPage> {
    return this.unitOfWork.run(async ({ wallets, ledger }) => {
      const wallet = await wallets.findById(input.walletId);
      if (!wallet) {
        throw new WalletNotFoundError(input.walletId);
      }
      const items = await ledger.findPage(
        input.walletId,
        input.beforeSequence,
        input.limit + 1,
      );
      return {
        wallet,
        items: items.slice(0, input.limit),
        hasMore: items.length > input.limit,
      };
    });
  }
}
