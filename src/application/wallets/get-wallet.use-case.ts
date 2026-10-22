import type { Wallet } from '../../domain/wallet/wallet.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';
import { WalletNotFoundError } from './wallet.errors.js';

export class GetWalletUseCase {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async execute(walletId: string): Promise<Wallet> {
    const wallet = await this.unitOfWork.run(({ wallets }) =>
      wallets.findById(walletId),
    );
    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }
    return wallet;
  }
}
