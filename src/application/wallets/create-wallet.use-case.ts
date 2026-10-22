import { Money, type MoneyProps } from '../../domain/money/money.js';
import { WagerTransaction } from '../../domain/wagering/wager-transaction.js';
import { Wallet } from '../../domain/wallet/wallet.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';

export interface CreateWalletInput {
  playerId: string;
  initialBalance: MoneyProps;
}

export class CreateWalletUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: CreateWalletInput): Promise<Wallet> {
    const initialBalance = Money.from(input.initialBalance);
    const at = this.clock.now();
    const walletId = this.ids.next();
    const openingTransactionId = this.ids.next();

    const { wallet, openingEntry } = Wallet.open({
      id: walletId,
      playerId: input.playerId,
      initialBalance,
      openingTransactionId,
      openingEntryId: this.ids.next(),
      at,
    });

    await this.unitOfWork.run(async ({ wallets, transactions, ledger }) => {
      await wallets.add(wallet);
      if (!openingEntry) {
        return;
      }
      await transactions.add(
        WagerTransaction.opening({
          id: openingTransactionId,
          walletId,
          playerId: input.playerId,
          money: initialBalance,
          at,
        }),
      );
      await ledger.add(openingEntry);
    });

    return wallet;
  }
}
