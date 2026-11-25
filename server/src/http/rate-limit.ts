/**
 * In-memory fixed-window rate limiter.
 *
 * Limitation (documented in docs/security.md): counters live in this process,
 * so limits are per instance and reset on restart. Running several instances
 * would need shared state — a genuine reason to introduce Redis later.
 */
export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export class FixedWindowLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  hit(key: string): RateLimitDecision {
    const now = this.now();
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count += 1;
    const allowed = entry.count <= this.limit;
    return {
      allowed,
      remaining: Math.max(0, this.limit - entry.count),
      retryAfterSeconds: allowed ? 0 : Math.ceil((entry.resetAt - now) / 1000),
    };
  }

  /** Clear the counter for a key (e.g. reset failed-login count after success). */
  reset(key: string): void {
    this.hits.delete(key);
  }

  /** Drop expired windows; call periodically to bound memory. */
  sweep(): void {
    const now = this.now();
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}
