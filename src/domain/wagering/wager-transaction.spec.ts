import { describe, expect, it } from 'bun:test';
import { Money } from '../money/money.js';
import { LedgerDirection } from '../wallet/wallet-ledger-entry.js';
import { FailureCode } from './failure-code.js';
import {
  type CreateWagerTransactionProps,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from './wager-transaction.js';
import {
  InvalidTransactionStateError,
  InvalidWagerTransactionError,
} from './wager-transaction.errors.js';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });
const at = new Date('2026-10-21T12:00:00Z');

const props = (
  overrides: Partial<CreateWagerTransactionProps> = {},
): CreateWagerTransactionProps => ({
  id: 'transaction-1',
  providerId: 'provider-a',
  externalTransactionId: 'external-1',
  idempotencyKey: 'provider-a:external-1',
  payloadHash: 'hash-1',
  walletId: 'wallet-1',
  playerId: 'player-1',
  roundId: 'round-1',
  gameId: 'game-1',
  kind: WagerTransactionKind.Bet,
  money: brl('25.00'),
  createdAt: at,
  ...overrides,
});

const bet = () => WagerTransaction.create(props());

const withStatus = (status: WagerTransactionStatus) =>
  WagerTransaction.rehydrate({ ...props(), status });

describe('WagerTransaction', () => {
  describe('create', () => {
    it('starts as PENDING', () => {
      const transaction = bet();

      expect(transaction.status).toBe(WagerTransactionStatus.Pending);
      expect(transaction.isTerminal()).toBe(false);
      expect(transaction.failureCode).toBeUndefined();
      expect(transaction.processedAt).toBeUndefined();
    });

    it('refuses OPENING, which is internal', () => {
      expect(() =>
        WagerTransaction.create(props({ kind: WagerTransactionKind.Opening })),
      ).toThrow(InvalidWagerTransactionError);
    });

    it.each([WagerTransactionKind.Refund, WagerTransactionKind.Rollback])(
      '%s requires a reference',
      (kind) => {
        expect(() => WagerTransaction.create(props({ kind }))).toThrow(
          InvalidWagerTransactionError,
        );
        expect(
          WagerTransaction.create(
            props({ kind, referenceExternalTransactionId: 'external-0' }),
          ).requiresReference(),
        ).toBe(true);
      },
    );

    it('refuses a BET with a reference', () => {
      expect(() =>
        WagerTransaction.create(
          props({ referenceExternalTransactionId: 'external-0' }),
        ),
      ).toThrow(InvalidWagerTransactionError);
    });

    it.each([WagerTransactionKind.Win, WagerTransactionKind.Loss])(
      '%s may or may not reference the bet',
      (kind) => {
        expect(() => WagerTransaction.create(props({ kind }))).not.toThrow();
        expect(() =>
          WagerTransaction.create(
            props({ kind, referenceExternalTransactionId: 'external-0' }),
          ),
        ).not.toThrow();
      },
    );

    it('refuses a transaction that references itself', () => {
      expect(() =>
        WagerTransaction.create(
          props({
            kind: WagerTransactionKind.Refund,
            referenceExternalTransactionId: 'external-1',
          }),
        ),
      ).toThrow(InvalidWagerTransactionError);
    });

    it('refuses a zero amount on operations that move money', () => {
      expect(() =>
        WagerTransaction.create(props({ money: brl('0.00') })),
      ).toThrow(InvalidWagerTransactionError);
    });

    it('accepts a zero amount on LOSS', () => {
      expect(() =>
        WagerTransaction.create(
          props({ kind: WagerTransactionKind.Loss, money: brl('0.00') }),
        ),
      ).not.toThrow();
    });
  });

  describe('opening', () => {
    it('is created already PROCESSED with the opening balance', () => {
      const opening = WagerTransaction.opening({
        id: 'opening-1',
        walletId: 'wallet-1',
        playerId: 'player-1',
        money: brl('100.00'),
        at,
      });

      expect(opening.kind).toBe(WagerTransactionKind.Opening);
      expect(opening.status).toBe(WagerTransactionStatus.Processed);
      expect(opening.resultBalance?.equals(brl('100.00'))).toBe(true);
      expect(opening.processedAt).toEqual(at);
      expect(opening.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
    });
  });

  describe('transitions', () => {
    it('marks as processed with the resulting balance', () => {
      const transaction = bet();

      transaction.markProcessed({ resultBalance: brl('75.00'), at });

      expect(transaction.status).toBe(WagerTransactionStatus.Processed);
      expect(transaction.resultBalance?.equals(brl('75.00'))).toBe(true);
      expect(transaction.processedAt).toEqual(at);
      expect(transaction.isTerminal()).toBe(true);
    });

    it('rejects with a failure code and the unchanged balance', () => {
      const transaction = bet();

      transaction.reject({
        code: FailureCode.InsufficientFunds,
        resultBalance: brl('20.00'),
        at,
      });

      expect(transaction.status).toBe(WagerTransactionStatus.Rejected);
      expect(transaction.failureCode).toBe(FailureCode.InsufficientFunds);
      expect(transaction.resultBalance?.equals(brl('20.00'))).toBe(true);
      expect(transaction.isTerminal()).toBe(true);
    });

    it('fails with a failure code', () => {
      const transaction = bet();

      transaction.fail({ code: FailureCode.ProcessingFailed, at });

      expect(transaction.status).toBe(WagerTransactionStatus.Failed);
      expect(transaction.failureCode).toBe(FailureCode.ProcessingFailed);
      expect(transaction.isTerminal()).toBe(true);
    });

    it('waits for the reference and is processed later', () => {
      const refund = WagerTransaction.create(
        props({
          kind: WagerTransactionKind.Refund,
          referenceExternalTransactionId: 'external-0',
        }),
      );

      refund.markPendingReference({
        resultBalance: brl('75.00'),
        nextAttemptAt: at,
      });
      expect(refund.status).toBe(WagerTransactionStatus.PendingReference);
      expect(refund.isTerminal()).toBe(false);

      refund.markProcessed({
        resultBalance: brl('100.00'),
        referenceTransactionId: 'transaction-0',
        at,
      });
      expect(refund.status).toBe(WagerTransactionStatus.Processed);
      expect(refund.referenceTransactionId).toBe('transaction-0');
    });

    it('cannot go back to PENDING_REFERENCE', () => {
      const transaction = withStatus(WagerTransactionStatus.PendingReference);

      expect(() =>
        transaction.markPendingReference({
          resultBalance: brl('75.00'),
          nextAttemptAt: at,
        }),
      ).toThrow(InvalidTransactionStateError);
    });

    describe('reference retries', () => {
      const later = new Date('2026-10-21T12:00:04Z');
      const pendingRefund = () => {
        const refund = WagerTransaction.create(
          props({
            kind: WagerTransactionKind.Refund,
            referenceExternalTransactionId: 'external-0',
          }),
        );
        refund.markPendingReference({
          resultBalance: brl('75.00'),
          nextAttemptAt: at,
        });
        return refund;
      };

      it('starts with no attempts and the first retry scheduled', () => {
        const refund = pendingRefund();

        expect(refund.referenceAttempts).toBe(0);
        expect(refund.nextReferenceAttemptAt).toEqual(at);
      });

      it('counts each retry without leaving PENDING_REFERENCE', () => {
        const refund = pendingRefund();

        refund.scheduleReferenceRetry({ nextAttemptAt: later });

        expect(refund.status).toBe(WagerTransactionStatus.PendingReference);
        expect(refund.referenceAttempts).toBe(1);
        expect(refund.nextReferenceAttemptAt).toEqual(later);
      });

      it('clears the schedule once processed or rejected', () => {
        const processed = pendingRefund();
        const rejected = pendingRefund();

        processed.markProcessed({ resultBalance: brl('100.00'), at });
        rejected.reject({
          code: FailureCode.ReferenceNotFound,
          resultBalance: brl('75.00'),
          at,
        });

        expect(processed.nextReferenceAttemptAt).toBeUndefined();
        expect(rejected.nextReferenceAttemptAt).toBeUndefined();
      });

      it('refuses a retry outside PENDING_REFERENCE', () => {
        expect(() =>
          bet().scheduleReferenceRetry({ nextAttemptAt: later }),
        ).toThrow(InvalidTransactionStateError);
      });
    });

    it.each([
      WagerTransactionStatus.Processed,
      WagerTransactionStatus.Rejected,
      WagerTransactionStatus.Failed,
    ])('%s is terminal and refuses every transition', (status) => {
      const transaction = withStatus(status);
      const attempts = [
        () => transaction.markProcessed({ resultBalance: brl('1.00'), at }),
        () =>
          transaction.markPendingReference({
            resultBalance: brl('1.00'),
            nextAttemptAt: at,
          }),
        () =>
          transaction.reject({
            code: FailureCode.InsufficientFunds,
            resultBalance: brl('1.00'),
            at,
          }),
        () => transaction.fail({ code: FailureCode.ProcessingFailed, at }),
      ];

      expect(transaction.isTerminal()).toBe(true);
      for (const attempt of attempts) {
        expect(attempt).toThrow(InvalidTransactionStateError);
      }
      expect(transaction.status).toBe(status);
    });
  });

  describe('queries', () => {
    it('only LOSS does not affect the balance', () => {
      expect(
        WagerTransaction.create(
          props({ kind: WagerTransactionKind.Loss }),
        ).affectsBalance(),
      ).toBe(false);
      expect(bet().affectsBalance()).toBe(true);
    });

    it('matches only the same payload hash', () => {
      expect(bet().matchesPayload('hash-1')).toBe(true);
      expect(bet().matchesPayload('hash-2')).toBe(false);
    });
  });

  describe('ledgerDirectionFor', () => {
    const create = (kind: WagerTransactionKind) =>
      WagerTransaction.create(
        props({
          kind,
          referenceExternalTransactionId:
            kind === WagerTransactionKind.Bet ? undefined : 'external-0',
        }),
      );

    it.each([
      [WagerTransactionKind.Bet, LedgerDirection.Debit],
      [WagerTransactionKind.Win, LedgerDirection.Credit],
      [WagerTransactionKind.Refund, LedgerDirection.Credit],
    ])('%s moves the balance as %s', (kind, direction) => {
      expect(create(kind).ledgerDirectionFor()).toBe(direction);
    });

    it.each([
      [WagerTransactionKind.Bet, LedgerDirection.Credit],
      [WagerTransactionKind.Win, LedgerDirection.Debit],
      [WagerTransactionKind.Refund, LedgerDirection.Debit],
    ])('ROLLBACK of %s moves the balance as %s', (referenceKind, direction) => {
      const rollback = create(WagerTransactionKind.Rollback);

      expect(rollback.ledgerDirectionFor(create(referenceKind))).toBe(
        direction,
      );
    });

    it('ROLLBACK without its reference has no direction', () => {
      expect(() =>
        create(WagerTransactionKind.Rollback).ledgerDirectionFor(),
      ).toThrow(InvalidWagerTransactionError);
    });

    it('LOSS has no direction', () => {
      expect(() =>
        create(WagerTransactionKind.Loss).ledgerDirectionFor(),
      ).toThrow(InvalidWagerTransactionError);
    });
  });

  it('rehydrates a terminal transaction without validating transitions', () => {
    const transaction = withStatus(WagerTransactionStatus.Processed);

    expect(transaction.status).toBe(WagerTransactionStatus.Processed);
  });
  describe('references', () => {
    const of = (
      kind: WagerTransactionKind,
      overrides: Partial<CreateWagerTransactionProps> = {},
    ) =>
      WagerTransaction.create(
        props({
          kind,
          externalTransactionId: `external-${kind}`,
          referenceExternalTransactionId:
            kind === WagerTransactionKind.Bet ? undefined : 'external-1',
          ...overrides,
        }),
      );
    const target = (kind: WagerTransactionKind) =>
      WagerTransaction.rehydrate({
        ...props({ kind }),
        status: WagerTransactionStatus.Processed,
      });

    it.each([
      [WagerTransactionKind.Win, WagerTransactionKind.Bet, true],
      [WagerTransactionKind.Loss, WagerTransactionKind.Bet, true],
      [WagerTransactionKind.Refund, WagerTransactionKind.Bet, true],
      [WagerTransactionKind.Refund, WagerTransactionKind.Win, false],
      [WagerTransactionKind.Rollback, WagerTransactionKind.Bet, true],
      [WagerTransactionKind.Rollback, WagerTransactionKind.Win, true],
      [WagerTransactionKind.Rollback, WagerTransactionKind.Refund, true],
      [WagerTransactionKind.Rollback, WagerTransactionKind.Rollback, false],
      [WagerTransactionKind.Win, WagerTransactionKind.Win, false],
    ])('%s referencing %s is allowed: %s', (kind, referenceKind, allowed) => {
      expect(of(kind).canReference(target(referenceKind))).toBe(allowed);
    });

    it('shares context with a reference from the same provider, wallet, player, round and currency', () => {
      expect(
        of(WagerTransactionKind.Refund).sharesContextWith(
          target(WagerTransactionKind.Bet),
        ),
      ).toBe(true);
    });

    it.each([
      ['provider', { providerId: 'provider-b' }],
      ['wallet', { walletId: 'wallet-2' }],
      ['player', { playerId: 'player-2' }],
      ['round', { roundId: 'round-2' }],
      ['currency', { money: Money.from({ amount: '25.00', currency: 'USD' }) }],
    ])('does not share context when the %s differs', (_, overrides) => {
      expect(
        of(WagerTransactionKind.Refund, overrides).sharesContextWith(
          target(WagerTransactionKind.Bet),
        ),
      ).toBe(false);
    });

    it('identifies reversals', () => {
      expect(of(WagerTransactionKind.Refund).isReversal()).toBe(true);
      expect(of(WagerTransactionKind.Rollback).isReversal()).toBe(true);
      expect(of(WagerTransactionKind.Win).isReversal()).toBe(false);
    });
  });
});
