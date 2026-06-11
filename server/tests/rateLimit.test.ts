import { describe, expect, it } from 'vitest';
import { CodeLockout, SlidingWindowRateLimiter } from '../src/rateLimit.js';

describe('SlidingWindowRateLimiter', () => {
  it('allows up to the limit inside the window and refuses beyond it', () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter({ limit: 3, windowMs: 1_000, now: () => now });

    expect(limiter.consume('ip-1')).toBe(true);
    expect(limiter.consume('ip-1')).toBe(true);
    expect(limiter.consume('ip-1')).toBe(true);
    expect(limiter.consume('ip-1')).toBe(false);
    // Other keys are independent.
    expect(limiter.consume('ip-2')).toBe(true);
  });

  it('frees capacity as the window slides', () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter({ limit: 2, windowMs: 1_000, now: () => now });

    expect(limiter.consume('ip-1')).toBe(true);
    expect(limiter.consume('ip-1')).toBe(true);
    expect(limiter.consume('ip-1')).toBe(false);

    now = 1_001;
    expect(limiter.consume('ip-1')).toBe(true);
  });
});

describe('CodeLockout', () => {
  it('locks a code after the failure threshold, regardless of source', () => {
    let now = 0;
    const lockout = new CodeLockout({ threshold: 3, lockMs: 10_000, now: () => now });

    lockout.recordFailure('123456');
    lockout.recordFailure('123456');
    expect(lockout.isLocked('123456')).toBe(false);
    lockout.recordFailure('123456');
    expect(lockout.isLocked('123456')).toBe(true);
    expect(lockout.isLocked('654321')).toBe(false);
  });

  it('unlocks after the lock period and on explicit clear', () => {
    let now = 0;
    const lockout = new CodeLockout({ threshold: 1, lockMs: 10_000, now: () => now });

    lockout.recordFailure('123456');
    expect(lockout.isLocked('123456')).toBe(true);
    now = 10_001;
    expect(lockout.isLocked('123456')).toBe(false);

    lockout.recordFailure('654321');
    lockout.clear('654321');
    expect(lockout.isLocked('654321')).toBe(false);
  });
});
