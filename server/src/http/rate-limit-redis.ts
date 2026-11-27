/**
 * Rate limits shared by every DevForge instance, in Redis (ADR 0010).
 *
 * Each limiter keeps a fixed-window counter per key in Redis: one Lua script increments the counter and
 * sets its expiry atomically, so concurrent requests on different instances cannot both see "first hit"
 * or leave a counter without an expiry. Keys are SHA-256 hashes of the limiter's own keys (which contain
 * IP addresses and e-mail addresses), so Redis never stores them in clear text.
 *
 * When Redis cannot be reached or answers too slowly, the limiter **fails open to the per-process
 * in-memory limiter** with the same limit: every instance still enforces the limit on its own (so the
 * effective limit is at most N × limit for N instances) instead of either rejecting all API traffic
 * (fail closed) or not limiting at all. The store logs once when Redis goes down and once when it comes
 * back, counts fallbacks for /metrics, and does not try Redis again for `retryAfterMs`, so an outage
 * costs one timeout, not one per request.
 */
import { createHash } from "node:crypto";
import type { Logger } from "../observability/logger.ts";
import type { RedisCommander } from "../redis/client.ts";
import { FixedWindowLimiter, type RateLimitDecision, type RateLimiter } from "./rate-limit.ts";

/** INCR, and set the window's expiry if the key has none yet (first hit, or a key left without a TTL). */
export const FIXED_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

export interface StoreStats {
  /** Hits answered by the per-process fallback because Redis was unavailable. */
  fallbacks: number;
  /** Redis commands that failed (connect error, timeout, error reply). */
  errors: number;
}

export class RedisRateLimitStore {
  readonly stats: StoreStats = { fallbacks: 0, errors: 0 };
  private readonly client: RedisCommander;
  private readonly logger: Logger;
  private readonly prefix: string;
  private readonly retryAfterMs: number;
  private readonly now: () => number;
  /** host:port for logs (never the password). */
  private readonly address: string;
  private downUntil = 0;
  private down = false;

  constructor(
    client: RedisCommander,
    options: { logger: Logger; prefix?: string; retryAfterMs?: number; now?: () => number; address?: string },
  ) {
    this.client = client;
    this.logger = options.logger;
    this.prefix = options.prefix ?? "devforge:rl:";
    this.retryAfterMs = options.retryAfterMs ?? 5_000;
    this.now = options.now ?? Date.now;
    this.address = options.address ?? "redis";
  }

  /** True while Redis is considered unavailable. */
  get isDown(): boolean {
    return this.down;
  }

  redisKey(limiter: string, key: string): string {
    return `${this.prefix}${limiter}:${createHash("sha256").update(key).digest("hex")}`;
  }

  /** Count one hit; undefined means "Redis unavailable, use the fallback". */
  async increment(limiter: string, key: string, windowMs: number): Promise<{ count: number; ttlMs: number } | undefined> {
    if (this.down && this.now() < this.downUntil) {
      this.stats.fallbacks += 1;
      return undefined;
    }
    try {
      const reply = await this.client.command(["EVAL", FIXED_WINDOW_SCRIPT, 1, this.redisKey(limiter, key), windowMs]);
      if (!Array.isArray(reply) || typeof reply[0] !== "number" || typeof reply[1] !== "number") {
        throw new Error(`unexpected reply ${JSON.stringify(reply)}`);
      }
      this.markUp();
      return { count: reply[0], ttlMs: reply[1] };
    } catch (err) {
      this.markDown(err);
      this.stats.fallbacks += 1;
      return undefined;
    }
  }

  async delete(limiter: string, key: string): Promise<void> {
    if (this.down && this.now() < this.downUntil) return;
    try {
      await this.client.command(["DEL", this.redisKey(limiter, key)]);
      this.markUp();
    } catch (err) {
      this.markDown(err);
    }
  }

  private markDown(err: unknown): void {
    this.stats.errors += 1;
    this.downUntil = this.now() + this.retryAfterMs;
    if (!this.down) {
      this.down = true;
      this.logger.warn("rate-limit store unavailable; using per-process limits", {
        redis: this.address,
        reason: err instanceof Error ? err.message : String(err),
        retryInMs: this.retryAfterMs,
      });
    }
  }

  private markUp(): void {
    if (this.down) {
      this.down = false;
      this.logger.info("rate-limit store reachable again; limits are shared", { redis: this.address });
    }
  }

  close(): void {
    this.client.close();
  }

  metricLines(): string[] {
    return [
      "# HELP devforge_rate_limit_store_up 1 if the shared rate-limit store (Redis) is in use, 0 while limits fall back to each process.",
      "# TYPE devforge_rate_limit_store_up gauge",
      `devforge_rate_limit_store_up ${this.down ? 0 : 1}`,
      "# HELP devforge_rate_limit_fallbacks_total Rate-limit checks answered by the per-process fallback because Redis was unavailable.",
      "# TYPE devforge_rate_limit_fallbacks_total counter",
      `devforge_rate_limit_fallbacks_total ${this.stats.fallbacks}`,
      "# HELP devforge_rate_limit_store_errors_total Failed Redis commands (connect errors, timeouts, error replies).",
      "# TYPE devforge_rate_limit_store_errors_total counter",
      `devforge_rate_limit_store_errors_total ${this.stats.errors}`,
    ];
  }
}

/** A fixed-window limiter whose counters live in Redis, with an in-memory fallback of the same size. */
export class RedisFixedWindowLimiter implements RateLimiter {
  private readonly name: string;
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly store: RedisRateLimitStore;
  readonly fallback: FixedWindowLimiter;

  constructor(name: string, limit: number, windowMs: number, store: RedisRateLimitStore, now: () => number = Date.now) {
    this.name = name;
    this.limit = limit;
    this.windowMs = windowMs;
    this.store = store;
    this.fallback = new FixedWindowLimiter(limit, windowMs, now);
  }

  async hit(key: string): Promise<RateLimitDecision> {
    const counted = await this.store.increment(this.name, key, this.windowMs);
    if (!counted) return this.fallback.hit(key);
    return decide(this.limit, counted.count, counted.ttlMs);
  }

  async reset(key: string): Promise<void> {
    this.fallback.reset(key);
    await this.store.delete(this.name, key);
  }

  sweep(): void {
    this.fallback.sweep();
  }
}

/** The decision for the count-th hit in a window that ends in ttlMs. */
export function decide(limit: number, count: number, ttlMs: number): RateLimitDecision {
  const allowed = count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(ttlMs / 1000)),
  };
}
