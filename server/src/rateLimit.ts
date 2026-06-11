export interface SlidingWindowOptions {
  limit: number;
  windowMs: number;
  now?: () => number;
}

/** Small in-memory per-key sliding-window limiter (per-IP request limits). */
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: SlidingWindowOptions) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.now = options.now ?? Date.now;
  }

  /** Returns true if the request is allowed and records it. */
  consume(key: string): boolean {
    const windowStart = this.now() - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((timestamp) => timestamp > windowStart);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(this.now());
    this.hits.set(key, recent);
    return true;
  }
}

export interface CodeLockoutOptions {
  threshold?: number;
  lockMs?: number;
  now?: () => number;
}

/**
 * Per-room-code failure lockout. Counts failed join attempts for a code from
 * any source, so distributed brute-forcing of one code locks the code itself.
 */
export class CodeLockout {
  private readonly failures = new Map<string, { count: number; lockedUntil?: number }>();
  private readonly threshold: number;
  private readonly lockMs: number;
  private readonly now: () => number;

  constructor(options: CodeLockoutOptions = {}) {
    this.threshold = options.threshold ?? 20;
    this.lockMs = options.lockMs ?? 10 * 60_000;
    this.now = options.now ?? Date.now;
  }

  isLocked(code: string): boolean {
    const entry = this.failures.get(code);
    if (!entry?.lockedUntil) return false;
    if (entry.lockedUntil > this.now()) return true;
    this.failures.delete(code);
    return false;
  }

  recordFailure(code: string): void {
    const entry = this.failures.get(code) ?? { count: 0 };
    entry.count += 1;
    if (entry.count >= this.threshold) {
      entry.lockedUntil = this.now() + this.lockMs;
      entry.count = 0;
    }
    this.failures.set(code, entry);
  }

  clear(code: string): void {
    this.failures.delete(code);
  }
}
