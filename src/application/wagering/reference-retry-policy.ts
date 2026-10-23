export const REFERENCE_RETRY_POLICY = Symbol('ReferenceRetryPolicy');

export interface ReferenceRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_REFERENCE_RETRY_POLICY: ReferenceRetryPolicy = {
  maxAttempts: 10,
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
};

export function nextReferenceAttemptAt(
  policy: ReferenceRetryPolicy,
  attempts: number,
  now: Date,
): Date {
  const delay = Math.min(policy.baseDelayMs * 2 ** attempts, policy.maxDelayMs);
  return new Date(now.getTime() + delay);
}
