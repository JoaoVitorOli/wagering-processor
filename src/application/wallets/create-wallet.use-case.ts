import { Money, type MoneyProps } from '../../domain/money/money.js';
import { WagerTransaction } from '../../domain/wagering/wager-transaction.js';
import { Wallet } from '../../domain/wallet/wallet.js';
import { eventsForTransaction } from '../events/transaction-events.js';
import { OutboxMessage } from '../outbox/outbox-message.js';
import type { Trace } from '../events/integration-event.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';

export interface CreateWalletInput {
  playerId: string;
  initialBalance: MoneyProps;
  trace?: Trace;
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

    await this.unitOfWork.run(
      async ({ wallets, transactions, ledger, outbox }) => {
        await wallets.add(wallet);
        if (!openingEntry) {
          return;
        }
        const opening = WagerTransaction.opening({
          id: openingTransactionId,
          walletId,
          playerId: input.playerId,
          money: initialBalance,
          at,
        });
        await transactions.add(opening);
        await ledger.add(openingEntry);
        await outbox.add(
          eventsForTransaction(opening, wallet, openingEntry, () => ({
            eventId: this.ids.next(),
            correlationId: input.trace?.correlationId ?? opening.id,
            occurredAt: at,
          })).map(OutboxMessage.enqueue),
        );
      },
    );

    return wallet;
  }
}
