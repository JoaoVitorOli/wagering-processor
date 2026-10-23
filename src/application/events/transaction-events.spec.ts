import { describe, expect, it } from 'bun:test';
import { Money } from '../../domain/money/money.js';
import { FailureCode } from '../../domain/wagering/failure-code.js';
import {
  WagerTransaction,
  WagerTransactionKind,
} from '../../domain/wagering/wager-transaction.js';
import { Wallet } from '../../domain/wallet/wallet.js';
import { OutboxMessage } from '../outbox/outbox-message.js';
import { eventsForTransaction } from './transaction-events.js';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });
const at = new Date('2026-10-22T12:00:00Z');

function setup(kind = WagerTransactionKind.Bet, amount = '25.00') {
  const { wallet } = Wallet.open({
    id: 'wallet-1',
    playerId: 'player-1',
    initialBalance: brl('100.00'),
    openingTransactionId: 'opening-1',
    openingEntryId: 'entry-0',
    at,
  });
  const transaction = WagerTransaction.create({
    id: 'transaction-1',
    providerId: 'provider-a',
    externalTransactionId: 'external-1',
    idempotencyKey: 'provider-a:external-1',
    payloadHash: 'hash',
    walletId: wallet.id,
    playerId: wallet.playerId,
    roundId: 'round-1',
    gameId: 'game-1',
    kind,
    money: brl(amount),
    createdAt: at,
  });
  let sequence = 0;
  const context = () => ({
    eventId: `event-${++sequence}`,
    correlationId: transaction.id,
    occurredAt: at,
  });
  return { wallet, transaction, context };
}

describe('eventsForTransaction', () => {
  it('emits processed and balance changed for a bet that moved the balance', () => {
    const { wallet, transaction, context } = setup();
    const entry = wallet.debit({
      entryId: 'entry-1',
      transactionId: transaction.id,
      amount: transaction.money,
      at,
    });
    transaction.markProcessed({ resultBalance: wallet.balance, at });

    const events = eventsForTransaction(transaction, wallet, entry, context);

    expect(events.map((event) => event.eventType)).toEqual([
      'WagerTransactionProcessed',
      'WalletBalanceChanged',
    ]);
    expect(events[1].toJSON()).toEqual({
      eventId: 'event-2',
      eventType: 'WalletBalanceChanged',
      aggregateId: 'wallet-1',
      correlationId: 'transaction-1',
      occurredAt: '2026-10-22T12:00:00.000Z',
      version: 1,
      data: {
        walletId: 'wallet-1',
        transactionId: 'transaction-1',
        direction: 'DEBIT',
        money: { amount: '25.00', currency: 'BRL' },
        balanceBefore: { amount: '100.00', currency: 'BRL' },
        balanceAfter: { amount: '75.00', currency: 'BRL' },
        walletVersion: 2,
      },
    });
  });

  it('emits only processed for a LOSS, which does not move the balance', () => {
    const { wallet, transaction, context } = setup(
      WagerTransactionKind.Loss,
      '0.00',
    );
    transaction.markProcessed({ resultBalance: wallet.balance, at });

    const events = eventsForTransaction(
      transaction,
      wallet,
      undefined,
      context,
    );

    expect(events.map((event) => event.eventType)).toEqual([
      'WagerTransactionProcessed',
    ]);
  });

  it('emits rejected with the failure code', () => {
    const { wallet, transaction, context } = setup();
    transaction.reject({
      code: FailureCode.InsufficientFunds,
      resultBalance: wallet.balance,
      at,
    });

    const [event] = eventsForTransaction(
      transaction,
      wallet,
      undefined,
      context,
    );

    expect(event.eventType).toBe('WagerTransactionRejected');
    expect(event.toJSON().data).toMatchObject({
      failureCode: 'INSUFFICIENT_FUNDS',
      money: { amount: '25.00', currency: 'BRL' },
      resultBalance: { amount: '100.00', currency: 'BRL' },
    });
  });

  it('emits pending reference', () => {
    const { wallet, transaction, context } = setup();
    transaction.markPendingReference({
      resultBalance: wallet.balance,
      nextAttemptAt: at,
    });

    const events = eventsForTransaction(
      transaction,
      wallet,
      undefined,
      context,
    );

    expect(events.map((event) => event.eventType)).toEqual([
      'WagerTransactionPendingReference',
    ]);
  });

  it('emits nothing for a transaction that is still pending', () => {
    const { wallet, transaction, context } = setup();

    expect(
      eventsForTransaction(transaction, wallet, undefined, context),
    ).toEqual([]);
  });
});

describe('OutboxMessage.enqueue', () => {
  it('stores the serialized envelope, due immediately and not yet published', () => {
    const { wallet, transaction, context } = setup();
    transaction.markProcessed({ resultBalance: wallet.balance, at });
    const [event] = eventsForTransaction(
      transaction,
      wallet,
      undefined,
      context,
    );

    const message = OutboxMessage.enqueue(event);

    expect(message.id).toBe(event.eventId);
    expect(message.aggregateId).toBe('wallet-1');
    expect(message.eventType).toBe('WagerTransactionProcessed');
    expect(message.payload).toEqual(event.toJSON());
    expect(message.attempts).toBe(0);
    expect(message.nextAttemptAt).toEqual(at);
    expect(message.isPending()).toBe(true);
  });
});
