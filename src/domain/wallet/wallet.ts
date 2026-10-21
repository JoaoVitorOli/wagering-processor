import { Money } from '../money/money.js';
import { CurrencyMismatchError } from '../money/money.errors.js';
import { LedgerDirection, WalletLedgerEntry } from './wallet-ledger-entry.js';
import {
  InsufficientFundsError,
  InvalidMovementAmountError,
} from './wallet.errors.js';

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
  openingTransactionId: string;
  openingEntryId: string;
  at: Date;
}

export interface OpenedWallet {
  wallet: Wallet;
  openingEntry: WalletLedgerEntry | undefined;
}

export interface WalletMovement {
  entryId: string;
  transactionId: string;
  amount: Money;
  at: Date;
}

export class Wallet {
  private constructor(
    readonly id: string,
    readonly playerId: string,
    readonly currency: string,
    private _balance: Money,
    private _version: number,
    readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open(props: OpenWalletProps): OpenedWallet {
    const { initialBalance } = props;
    if (initialBalance.isNegative()) {
      throw new InvalidMovementAmountError(
        'Initial balance cannot be negative',
      );
    }

    const wallet = new Wallet(
      props.id,
      props.playerId,
      initialBalance.currency,
      initialBalance,
      1,
      props.at,
      props.at,
    );

    if (initialBalance.isZero()) {
      return { wallet, openingEntry: undefined };
    }

    const openingEntry = WalletLedgerEntry.create({
      id: props.openingEntryId,
      walletId: wallet.id,
      transactionId: props.openingTransactionId,
      direction: LedgerDirection.Credit,
      money: initialBalance,
      balanceBefore: Money.zero(initialBalance.currency),
      balanceAfter: initialBalance,
      createdAt: props.at,
    });

    return { wallet, openingEntry };
  }

  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  canDebit(amount: Money): boolean {
    this.assertSameCurrency(amount);
    return !this._balance.isLessThan(amount);
  }

  debit(movement: WalletMovement): WalletLedgerEntry {
    this.assertValidAmount(movement.amount);
    if (!this.canDebit(movement.amount)) {
      throw new InsufficientFundsError(
        `Wallet ${this.id} has ${this._balance}, cannot debit ${movement.amount}`,
      );
    }
    return this.apply(
      LedgerDirection.Debit,
      this._balance.subtract(movement.amount),
      movement,
    );
  }

  credit(movement: WalletMovement): WalletLedgerEntry {
    this.assertValidAmount(movement.amount);
    return this.apply(
      LedgerDirection.Credit,
      this._balance.add(movement.amount),
      movement,
    );
  }

  private apply(
    direction: LedgerDirection,
    balanceAfter: Money,
    movement: WalletMovement,
  ): WalletLedgerEntry {
    const entry = WalletLedgerEntry.create({
      id: movement.entryId,
      walletId: this.id,
      transactionId: movement.transactionId,
      direction,
      money: movement.amount,
      balanceBefore: this._balance,
      balanceAfter,
      createdAt: movement.at,
    });

    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = movement.at;
    return entry;
  }

  private assertValidAmount(amount: Money): void {
    this.assertSameCurrency(amount);
    if (!amount.isPositive()) {
      throw new InvalidMovementAmountError(
        `Movement amount must be positive, got ${amount}`,
      );
    }
  }

  private assertSameCurrency(money: Money): void {
    if (money.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, money.currency);
    }
  }
}
