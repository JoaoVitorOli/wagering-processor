import { Decimal } from 'decimal.js';
import { CurrencyMismatchError, InvalidMoneyError } from './money.errors.js';

export interface MoneyProps {
  amount: string;
  currency: string;
}

const SCALE = 2;
const AMOUNT_PATTERN = /^\d{1,16}(\.\d{1,2})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const ExactDecimal = Decimal.clone({ precision: 40 });

export class Money {
  private constructor(
    private readonly value: Decimal,
    readonly currency: string,
  ) {}

  static from(props: MoneyProps): Money {
    const { amount, currency } = props;
    Money.assertValidCurrency(currency);

    if (typeof amount !== 'string' || !AMOUNT_PATTERN.test(amount)) {
      throw new InvalidMoneyError(
        `Invalid amount "${amount}": expected a non-negative decimal with up to ${SCALE} places`,
      );
    }

    return new Money(new ExactDecimal(amount), currency);
  }

  static zero(currency: string): Money {
    Money.assertValidCurrency(currency);
    return new Money(new ExactDecimal(0), currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.greaterThan(0);
  }

  isNegative(): boolean {
    return this.value.lessThan(0);
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }

  toJSON(): MoneyProps {
    return { amount: this.formatAmount(), currency: this.currency };
  }

  toString(): string {
    return `${this.formatAmount()} ${this.currency}`;
  }

  private formatAmount(): string {
    return this.value.toFixed(SCALE);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }

  private static assertValidCurrency(currency: string): void {
    if (typeof currency !== 'string' || !CURRENCY_PATTERN.test(currency)) {
      throw new InvalidMoneyError(
        `Invalid currency "${currency}": expected an ISO-4217 code`,
      );
    }
  }
}