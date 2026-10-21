import { describe, expect, it } from 'bun:test';
import { Money } from './money.js';
import { CurrencyMismatchError, InvalidMoneyError } from './money-errors.js';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });
const usd = (amount: string) => Money.from({ amount, currency: 'USD' });

describe('Money', () => {
  describe('from', () => {
    it.each([
      ['25.00', '25.00'],
      ['25', '25.00'],
      ['25.5', '25.50'],
      ['0.01', '0.01'],
      ['0', '0.00'],
      ['007.10', '7.10'],
      ['9999999999999999.99', '9999999999999999.99'],
    ])('accepts "%s" and serializes it as "%s"', (input, expected) => {
      expect(brl(input).toJSON()).toEqual({
        amount: expected,
        currency: 'BRL',
      });
    });

    it.each([
      ['an empty string', ''],
      ['NaN', 'NaN'],
      ['Infinity', 'Infinity'],
      ['scientific notation', '1e3'],
      ['more than two decimal places', '10.005'],
      ['a negative value', '-10.00'],
      ['an explicit plus sign', '+10.00'],
      ['a missing integer part', '.50'],
      ['a trailing dot', '10.'],
      ['a comma as separator', '10,00'],
      ['surrounding spaces', ' 10.00 '],
      ['more than 16 integer digits', '12345678901234567.00'],
    ])('rejects %s', (_, input) => {
      expect(() => brl(input)).toThrow(InvalidMoneyError);
    });

    it('rejects an amount that is not a string', () => {
      expect(() =>
        Money.from({ amount: 10 as unknown as string, currency: 'BRL' }),
      ).toThrow(InvalidMoneyError);
    });

    it.each(['brl', 'BR', 'BRLL', '', '123'])(
      'rejects the currency "%s"',
      (currency) => {
        expect(() => Money.from({ amount: '10.00', currency })).toThrow(
          InvalidMoneyError,
        );
      },
    );
  });

  describe('arithmetic', () => {
    it('adds without floating point errors', () => {
      expect(brl('0.10').add(brl('0.20')).equals(brl('0.30'))).toBe(true);
    });

    it('subtracts and can go below zero', () => {
      const result = brl('20.00').subtract(brl('80.00'));

      expect(result.isNegative()).toBe(true);
      expect(result.toJSON().amount).toBe('-60.00');
    });

    it('negates', () => {
      expect(brl('25.00').negate().toJSON().amount).toBe('-25.00');
      expect(brl('25.00').negate().negate().equals(brl('25.00'))).toBe(true);
    });

    it('keeps the original instance unchanged', () => {
      const original = brl('100.00');
      original.add(brl('1.00'));
      original.subtract(brl('1.00'));
      original.negate();

      expect(original.toJSON().amount).toBe('100.00');
    });
  });

  describe('comparison', () => {
    it('reports zero, positive and negative values', () => {
      expect(Money.zero('BRL').isZero()).toBe(true);
      expect(brl('0.01').isPositive()).toBe(true);
      expect(brl('0.01').negate().isNegative()).toBe(true);
      expect(Money.zero('BRL').isPositive()).toBe(false);
    });

    it('compares amounts', () => {
      expect(brl('79.99').isLessThan(brl('80.00'))).toBe(true);
      expect(brl('80.00').isLessThan(brl('80.00'))).toBe(false);
    });

    it('treats different currencies as not equal', () => {
      expect(brl('10.00').equals(usd('10.00'))).toBe(false);
    });
  });

  describe('currency mismatch', () => {
    it.each([
      ['add', (a: Money, b: Money) => a.add(b)],
      ['subtract', (a: Money, b: Money) => a.subtract(b)],
      ['isLessThan', (a: Money, b: Money) => a.isLessThan(b)],
    ])('%s throws for different currencies', (_, operation) => {
      expect(() => operation(brl('10.00'), usd('10.00'))).toThrow(
        CurrencyMismatchError,
      );
    });
  });

  it('formats as text with the currency', () => {
    expect(String(brl('1234.5'))).toBe('1234.50 BRL');
  });
});