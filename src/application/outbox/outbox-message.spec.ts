import { describe, expect, it } from 'bun:test';
import { OutboxMessage } from './outbox-message.js';

const occurredAt = new Date('2026-10-23T12:00:00Z');
const later = (seconds: number) =>
  new Date(occurredAt.getTime() + seconds * 1_000);

const pending = () =>
  OutboxMessage.rehydrate({
    id: 'event-1',
    aggregateId: 'wallet-1',
    eventType: 'WalletBalanceChanged',
    payload: {
      eventId: 'event-1',
      eventType: 'WalletBalanceChanged',
      aggregateId: 'wallet-1',
      correlationId: 'transaction-1',
      occurredAt: occurredAt.toISOString(),
      version: 1,
      data: {},
    },
    occurredAt,
    attempts: 0,
    nextAttemptAt: occurredAt,
  });

describe('OutboxMessage', () => {
  it('is due once its next attempt arrives and stops being due after publishing', () => {
    const message = pending();

    expect(message.isDue(occurredAt)).toBe(true);
    message.markPublished(later(1));

    expect(message.isPending()).toBe(false);
    expect(message.isDue(later(60))).toBe(false);
    expect(message.publishedAt).toEqual(later(1));
  });

  it('waits longer after every failed attempt, up to five minutes', () => {
    const message = pending();
    const delays: number[] = [];

    for (let attempt = 0; attempt < 11; attempt++) {
      message.scheduleRetry(occurredAt);
      delays.push(
        (message.nextAttemptAt.getTime() - occurredAt.getTime()) / 1_000,
      );
    }

    expect(delays).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 256, 300, 300]);
    expect(message.attempts).toBe(11);
    expect(message.isDue(later(299))).toBe(false);
    expect(message.isDue(later(300))).toBe(true);
  });
});
