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
  /** OpenTelemetry tracing (ADR 0009); undefined = off. */
  tracing?: TracingConfig;
  /** redis:// or rediss:// URL for shared rate limits (ADR 0010); undefined = in-memory limits. */
  redisUrl?: string;
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
    ...(tracing ? { tracing } : {}),
    ...(e.REDIS_URL ? { redisUrl: e.REDIS_URL } : {}),
  };
}
