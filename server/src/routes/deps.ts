import type { AppConfig } from "../config.ts";
import type { ContentStore } from "../content/store.ts";
import type { Db } from "../db/database.ts";
import type { FixedWindowLimiter } from "../http/rate-limit.ts";
import type { Logger } from "../observability/logger.ts";
import type { Metrics } from "../observability/metrics.ts";

export interface Limiters {
  /** Account creation per client IP. */
  register: FixedWindowLimiter;
  /** Login attempts per client IP (generous: a classroom may share one NAT address). */
  loginByIp: FixedWindowLimiter;
  /** Failed logins per account — the main brute-force defence. */
  loginFailuresByEmail: FixedWindowLimiter;
  /** Coarse abuse guard for all API requests per IP. */
  api: FixedWindowLimiter;
}

export interface AppDeps {
  config: AppConfig;
  db: Db;
  content: ContentStore;
  logger: Logger;
  metrics: Metrics;
  limiters: Limiters;
}

export function sessionCookieName(secure: boolean): string {
  // The __Host- prefix makes browsers refuse the cookie unless it is Secure,
  // host-only and Path=/ — so it cannot be planted by a sibling sub-domain.
  return secure ? "__Host-df_session" : "df_session";
}
