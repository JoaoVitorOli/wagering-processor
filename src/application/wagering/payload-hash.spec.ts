import { describe, expect, it } from 'bun:test';
import {
  canonicalJson,
  hashPayload,
  type WagerPayload,
} from './payload-hash.js';

const payload: WagerPayload = {
  providerId: 'provider-a',
  externalTransactionId: 'transaction-123',
  playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
  walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
  roundId: 'round-987',
  gameId: 'fortune-chimp',
  kind: 'BET',
  money: { amount: '25.00', currency: 'BRL' },
};

describe('canonicalJson', () => {
  it('sorts keys at every level', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
  });

  it('leaves out undefined fields', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe('hashPayload', () => {
  it('returns a sha256 hex digest', () => {
    expect(hashPayload(payload)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not depend on key order', () => {
    const reordered = Object.fromEntries(
      Object.entries(payload).reverse(),
    ) as unknown as WagerPayload;

    expect(hashPayload(reordered)).toBe(hashPayload(payload));
  });

  it('treats a missing reference like an undefined one', () => {
    expect(
      hashPayload({ ...payload, referenceExternalTransactionId: undefined }),
    ).toBe(hashPayload(payload));
  });

  it.each([
    ['amount', { money: { amount: '25.01', currency: 'BRL' } }],
    ['currency', { money: { amount: '25.00', currency: 'USD' } }],
    ['wallet', { walletId: '0192f291-27dd-7d3f-8071-5f8685deef38' }],
    ['round', { roundId: 'round-988' }],
  ])('changes when the %s changes', (_, change) => {
    expect(hashPayload({ ...payload, ...change })).not.toBe(
      hashPayload(payload),
    );
  });
});
