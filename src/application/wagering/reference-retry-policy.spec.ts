import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_REFERENCE_RETRY_POLICY,
  nextReferenceAttemptAt,
} from './reference-retry-policy.js';

const now = new Date('2026-10-22T12:00:00Z');
const delayAfter = (attempts: number) =>
  nextReferenceAttemptAt(
    DEFAULT_REFERENCE_RETRY_POLICY,
    attempts,
    now,
  ).getTime() - now.getTime();

describe('nextReferenceAttemptAt', () => {
  it('doubles the delay on every attempt', () => {
    expect([0, 1, 2, 3, 4, 5].map(delayAfter)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 32_000,
    ]);
  });

  it('never waits longer than the maximum delay', () => {
    expect(delayAfter(6)).toBe(60_000);
    expect(delayAfter(9)).toBe(60_000);
  });

  it('gives up after about five minutes with the default policy', () => {
    const total = Array.from(
      { length: DEFAULT_REFERENCE_RETRY_POLICY.maxAttempts },
      (_, attempts) => delayAfter(attempts),
    ).reduce((sum, delay) => sum + delay, 0);

    expect(total).toBe(303_000);
  });
});
