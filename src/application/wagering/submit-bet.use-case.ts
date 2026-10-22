import { Money, type MoneyProps } from '../../domain/money/money.js';
import { FailureCode } from '../../domain/wagering/failure-code.js';
import {
  WagerTransaction,
  WagerTransactionKind,
} from '../../domain/wagering/wager-transaction.js';
import type { Wallet } from '../../domain/wallet/wallet.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { Repositories, UnitOfWork } from '../ports/unit-of-work.js';
import { WalletNotFoundError } from '../wallets/wallet.errors.js';
import { hashPayload } from './payload-hash.js';
import {
  ExternalTransactionConflictError,
  IdempotencyConflictError,
} from './wagering.errors.js';

export interface SubmitBetInput {
  idempotencyKey: string;
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  money: MoneyProps;
}

export interface SubmitBetResult {
  transaction: WagerTransaction;
  idempotentReplay: boolean;
}

export class SubmitBetUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: SubmitBetInput): Promise<SubmitBetResult> {
    const money = Money.from(input.money);
    const payloadHash = hashPayload({
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      playerId: input.playerId,
      walletId: input.walletId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: WagerTransactionKind.Bet,
      money: money.toJSON(),
    });
    const transaction = WagerTransaction.create({
      id: this.ids.next(),
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      idempotencyKey: input.idempotencyKey,
      payloadHash,
      walletId: input.walletId,
      playerId: input.playerId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: WagerTransactionKind.Bet,
      money,
      createdAt: this.clock.now(),
    });

    return this.unitOfWork.run(async (repositories) => {
      const wallet = await repositories.wallets.findByIdForUpdate(
        input.walletId,
      );
      if (!wallet) {
        throw new WalletNotFoundError(input.walletId);
      }

      if (!(await repositories.transactions.addIfAbsent(transaction))) {
        return this.replay(repositories, transaction);
      }

      await this.apply(repositories, wallet, transaction);
      await repositories.transactions.update(transaction);
      return { transaction, idempotentReplay: false };
    });
  }

  private async replay(
    { transactions }: Repositories,
    submitted: WagerTransaction,
  ): Promise<SubmitBetResult> {
    const existing = await transactions.findByIdempotencyKey(
      submitted.idempotencyKey,
    );
    if (!existing) {
      throw new ExternalTransactionConflictError(
        submitted.providerId,
        submitted.externalTransactionId,
      );
    }
    if (!existing.matchesPayload(submitted.payloadHash)) {
      throw new IdempotencyConflictError(submitted.idempotencyKey);
    }
    return { transaction: existing, idempotentReplay: true };
  }

  private async apply(
    { wallets, ledger }: Repositories,
    wallet: Wallet,
    transaction: WagerTransaction,
  ): Promise<void> {
    const at = this.clock.now();
    const failure = this.findFailure(wallet, transaction);
    if (failure) {
      transaction.reject({ code: failure, resultBalance: wallet.balance, at });
      return;
    }

    const previousVersion = wallet.version;
    const entry = wallet.debit({
      entryId: this.ids.next(),
      transactionId: transaction.id,
      amount: transaction.money,
      at,
    });
    await wallets.update(wallet, previousVersion);
    await ledger.add(entry);
    transaction.markProcessed({ resultBalance: wallet.balance, at });
  }

  private findFailure(
    wallet: Wallet,
    transaction: WagerTransaction,
  ): FailureCode | undefined {
    if (transaction.money.currency !== wallet.currency) {
      return FailureCode.CurrencyMismatch;
    }
    if (transaction.playerId !== wallet.playerId) {
      return FailureCode.PlayerMismatch;
    }
    if (!wallet.canDebit(transaction.money)) {
      return FailureCode.InsufficientFunds;
    }
    return undefined;
  }
}
