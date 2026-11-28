/**
 * Runtime configuration, read from environment variables and validated at
 * start-up. An invalid value stops the process with a clear message instead
 * of failing later in a confusing way. See .env.example for documentation.
 */
import { z } from "zod/v4";
import { tracingConfigFromEnv, type TracingConfig } from "./observability/tracing.ts";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(0).max(65535).default(8080),
  PUBLIC_ORIGIN: z
    .string()
    .url()
    .transform((v) => v.replace(/\/+$/, ""))
    .default("http://localhost:8080"),
  DATABASE_PATH: z.string().min(1).default("./data/devforge.db"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(168),
  COOKIE_SECURE: bool.optional(),
  PASSWORD_HASH_LOG_N: z.coerce.number().int().min(14).max(20).default(17),
  TRUST_PROXY: bool.optional(), // see trustProxy below: never .default() on a transformed schema
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  CONTENT_PATH: z.string().min(1).default("./build/content.json"),
  WEB_ROOT: z.string().min(1).default("./build/web"),
  // API rate limits (docs/deployment.md, "Rate limits"): per client address, and per signed-in user.
  API_RATE_LIMIT_PER_IP_PER_MINUTE: z.coerce.number().int().min(1).max(10_000_000).default(6000),
  API_RATE_LIMIT_PER_USER_PER_MINUTE: z.coerce.number().int().min(1).max(10_000_000).default(600),
  // Shared rate-limit counters for several instances (ADR 0010); unset = per-process counters in memory.
  REDIS_URL: z
    .string()
    .url()
    .refine((v) => /^rediss?:\/\/[^/]/.test(v), "must be a redis:// or rediss:// URL with a host")
    .optional(),
});

export interface AppConfig {
  env: "development" | "production" | "test";
  host: string;
  port: number;
  publicOrigin: string;
  databasePath: string;
  sessionTtlHours: number;
  cookieSecure: boolean;
  passwordHashLogN: number;
  trustProxy: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
  contentPath: string;
  webRoot: string;
  /** Content editor (CMS that opens pull requests). Absent means "not configured". */
  cms?: CmsSettings;
  /** API request limits per minute; undefined = DEFAULT_API_RATE_LIMITS. */
  apiRateLimits?: ApiRateLimits;
  /** OpenTelemetry tracing (ADR 0009); undefined = off. */
  tracing?: TracingConfig;
  /** redis:// or rediss:// URL for shared rate limits (ADR 0010); undefined = in-memory limits. */
  redisUrl?: string;
}

/** API requests allowed per minute (docs/deployment.md, "Rate limits"). */
export interface ApiRateLimits {
  /** Per client address: every request, signed in or not. Size it as students behind one address × 100. */
  perIpPerMinute: number;
  /** Per signed-in user: the main abuse guard. Requests refused by it do not count against the address. */
  perUserPerMinute: number;
}

export const DEFAULT_API_RATE_LIMITS: ApiRateLimits = { perIpPerMinute: 6000, perUserPerMinute: 600 };

// ---- Content editor (ADR 0011) ------------------------------------------------
// Optional: a missing or invalid value disables the editor with a reason shown
// to faculty; it never stops the server from starting.

export interface GitHubSettings {
  owner: string;
  repo: string;
  /** Fine-grained token: Contents and Pull requests read/write on this one repository. */
  token: string;
  /** REST API base URL without a trailing slash. */
  apiUrl: string;
}

export type CmsSettings = { enabled: true; github: GitHubSettings } | { enabled: false; reason: string };

export const CMS_NOT_CONFIGURED =
  "The content editor is not configured on this server. An administrator must set GITHUB_REPOSITORY and GITHUB_TOKEN (see docs/deployment.md).";

const isLoopback = (host: string) => host === "localhost" || host === "127.0.0.1" || host === "[::1]";

export function cmsSettings(env: NodeJS.ProcessEnv): CmsSettings {
  const repository = env.GITHUB_REPOSITORY?.trim() ?? "";
  const token = env.GITHUB_TOKEN?.trim() ?? "";
  if (!repository && !token) return { enabled: false, reason: CMS_NOT_CONFIGURED };
  if (!repository || !token) {
    return { enabled: false, reason: `The content editor is not fully configured: ${repository ? "GITHUB_TOKEN" : "GITHUB_REPOSITORY"} is missing.` };
  }
  const m = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/.exec(repository);
  if (!m || m[2] === "." || m[2] === "..") {
    return { enabled: false, reason: "The content editor is disabled: GITHUB_REPOSITORY must look like owner/name." };
  }
  let apiUrl: URL;
  try {
    apiUrl = new URL(env.GITHUB_API_URL?.trim() || "https://api.github.com");
  } catch {
    return { enabled: false, reason: "The content editor is disabled: GITHUB_API_URL is not a valid URL." };
  }
  // The token travels with every request: plain HTTP is allowed only to this machine (a test double).
  if (apiUrl.protocol !== "https:" && !(apiUrl.protocol === "http:" && isLoopback(apiUrl.hostname))) {
    return { enabled: false, reason: "The content editor is disabled: GITHUB_API_URL must use https://." };
  }
  return {
    enabled: true,
    github: { owner: m[1] ?? "", repo: m[2] ?? "", token, apiUrl: `${apiUrl.origin}${apiUrl.pathname.replace(/\/+$/, "")}` },
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${details}`);
  }
  const e = parsed.data;
  let tracing: TracingConfig | undefined;
  try {
    tracing = tracingConfigFromEnv(env);
  } catch (err) {
    throw new Error(`Invalid configuration:\n  ${(err as Error).message}`);
  }
  const cookieSecure = e.COOKIE_SECURE ?? e.NODE_ENV === "production";
  if (e.NODE_ENV === "production" && e.PUBLIC_ORIGIN.startsWith("https://") && !cookieSecure) {
    throw new Error("Invalid configuration: COOKIE_SECURE must not be false when serving production over HTTPS");
  }
  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    publicOrigin: e.PUBLIC_ORIGIN,
    databasePath: e.DATABASE_PATH,
    sessionTtlHours: e.SESSION_TTL_HOURS,
    cookieSecure,
    passwordHashLogN: e.PASSWORD_HASH_LOG_N,
    trustProxy: e.TRUST_PROXY ?? false,
    logLevel: e.LOG_LEVEL,
    contentPath: e.CONTENT_PATH,
    webRoot: e.WEB_ROOT,
    apiRateLimits: { perIpPerMinute: e.API_RATE_LIMIT_PER_IP_PER_MINUTE, perUserPerMinute: e.API_RATE_LIMIT_PER_USER_PER_MINUTE },
    cms: cmsSettings(env),
    ...(tracing ? { tracing } : {}),
    ...(e.REDIS_URL ? { redisUrl: e.REDIS_URL } : {}),
  };
}
