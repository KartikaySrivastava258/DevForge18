/**
 * Assembles the HTTP application: request context, security headers, CSRF,
 * authentication, routing, error handling, metrics and access logs.
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { getSessionUser, purgeExpiredSessions } from "./auth/sessions.ts";
import type { AppConfig } from "./config.ts";
import type { ContentStore } from "./content/store.ts";
import type { Db } from "./db/database.ts";
import type { JsonResult, RequestContext } from "./http/context.ts";
import { parseCookies } from "./http/cookies.ts";
import { HttpError, forbidden, unauthorized } from "./http/errors.ts";
import { FixedWindowLimiter, type RateLimiter } from "./http/rate-limit.ts";
import { RedisFixedWindowLimiter, type RedisRateLimitStore } from "./http/rate-limit-redis.ts";
import { Router } from "./http/router.ts";
import { applySecurityHeaders, clientIp, csrfProblem } from "./http/security.ts";
import { serveStatic } from "./http/static.ts";
import type { Logger } from "./observability/logger.ts";
import { Metrics } from "./observability/metrics.ts";
import type { Tracer } from "./observability/tracing.ts";
import { registerAdminRoutes } from "./routes/admin.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerContentRoutes } from "./routes/content.ts";
import { sessionCookieName, type AppDeps, type Limiters } from "./routes/deps.ts";
import { registerLearningRoutes } from "./routes/learning.ts";
import { registerLabRoutes } from "./routes/labs.ts";
import { registerAssessmentRoutes } from "./routes/assessment.ts";
import { registerArchitectureRoutes } from "./routes/architecture.ts";
import { registerSimulationRoutes } from "./routes/simulations.ts";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MINUTE = 60_000;

/** Limit and window of each limiter (ADR 0004). */
const LIMITS: Record<keyof Limiters, { limit: number; windowMs: number }> = {
  register: { limit: 60, windowMs: 60 * MINUTE },
  loginByIp: { limit: 200, windowMs: 15 * MINUTE },
  loginFailuresByEmail: { limit: 10, windowMs: 15 * MINUTE },
  api: { limit: 1200, windowMs: MINUTE },
};

const mapLimits = (make: (name: keyof Limiters, limit: number, windowMs: number) => RateLimiter): Limiters => ({
  register: make("register", LIMITS.register.limit, LIMITS.register.windowMs),
  loginByIp: make("loginByIp", LIMITS.loginByIp.limit, LIMITS.loginByIp.windowMs),
  loginFailuresByEmail: make("loginFailuresByEmail", LIMITS.loginFailuresByEmail.limit, LIMITS.loginFailuresByEmail.windowMs),
  api: make("api", LIMITS.api.limit, LIMITS.api.windowMs),
});

/** Per-process limiters in memory (one instance, or REDIS_URL not set). */
export function defaultLimiters(): Limiters {
  return mapLimits((_name, limit, windowMs) => new FixedWindowLimiter(limit, windowMs));
}

/** The same limits, counted in Redis and shared by every instance (ADR 0010). */
export function sharedLimiters(store: RedisRateLimitStore): Limiters {
  return mapLimits((name, limit, windowMs) => new RedisFixedWindowLimiter(name, limit, windowMs, store));
}

/** Loopback and private-network addresses (used to restrict /metrics). */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (/^127\./.test(v4) || /^10\./.test(v4) || /^192\.168\./.test(v4)) return true;
  const m = /^172\.(\d+)\./.exec(v4);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return ip === "::1" || /^f[cd][0-9a-f]{2}:/i.test(ip);
}

/** The scheme the client used: https behind a trusted proxy that says so, or on a TLS socket. */
function requestScheme(req: IncomingMessage, trustProxy: boolean): "http" | "https" {
  const forwarded = req.headers["x-forwarded-proto"];
  if (trustProxy && typeof forwarded === "string") return forwarded.split(",")[0]?.trim() === "https" ? "https" : "http";
  return (req.socket as { encrypted?: boolean }).encrypted ? "https" : "http";
}

export interface App {
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  router: Router;
  metrics: Metrics;
  close: () => void;
}

export function createApp(input: {
  config: AppConfig;
  db: Db;
  content: ContentStore;
  logger: Logger;
  limiters?: Limiters;
  /** Set when OpenTelemetry tracing is on (OTEL_EXPORTER_OTLP_ENDPOINT); see observability/tracing.ts. */
  tracer?: Tracer;
  /** The Redis store behind sharedLimiters(), when REDIS_URL is set; its health goes to /metrics. */
  rateLimitStore?: RedisRateLimitStore;
}): App {
  const metrics = new Metrics();
  const { tracer, rateLimitStore } = input;
  if (tracer) metrics.addCollector(() => tracer.metricLines());
  if (rateLimitStore) metrics.addCollector(() => rateLimitStore.metricLines());
  const deps: AppDeps = { ...input, metrics, limiters: input.limiters ?? defaultLimiters() };
  const { config, db, logger } = deps;
  const cookieName = sessionCookieName(config.cookieSecure);

  const router = new Router();
  router.get("/api/health", () => ({ status: 200, body: { status: "ok" } }));
  router.get("/api/ready", () => {
    db.prepare("SELECT 1").get();
    return { status: 200, body: { status: "ready", tracks: deps.content.listTracks().length } };
  });
  registerAuthRoutes(router, deps);
  registerContentRoutes(router, deps);
  registerLearningRoutes(router, deps);
  registerSimulationRoutes(router, deps);
  registerLabRoutes(router, deps);
  registerAssessmentRoutes(router, deps);
  registerArchitectureRoutes(router, deps);
  registerAdminRoutes(router, deps);

  const sweeper = setInterval(() => {
    for (const limiter of Object.values(deps.limiters)) limiter.sweep();
    try {
      purgeExpiredSessions(db);
    } catch (err) {
      logger.warn("session purge failed", { err });
    }
  }, 10 * MINUTE);
  sweeper.unref();

  const sendJson = (res: ServerResponse, result: JsonResult): void => {
    res.statusCode = result.status;
    for (const [k, v] of Object.entries(result.headers ?? {})) res.setHeader(k, v);
    if (result.status === 204 || result.body === undefined) {
      res.end();
      return;
    }
    const payload = JSON.stringify(result.body);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Length", Buffer.byteLength(payload));
    res.end(payload);
  };

  const errorResult = (err: HttpError, requestId: string): JsonResult => ({
    status: err.status,
    body: { error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}), requestId } },
  });

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const started = process.hrtime.bigint();
    const requestId = randomUUID();
    const method = (req.method ?? "GET").toUpperCase();
    let route = "unmatched";
    res.setHeader("X-Request-Id", requestId);
    applySecurityHeaders(res, config.cookieSecure);
    const rawUrl = req.url ?? "/";
    // One SERVER span per request when tracing is on; it joins the caller's trace if a traceparent came in.
    const span = tracer?.startServerSpan({
      method,
      path: rawUrl.split("?")[0] ?? "/",
      scheme: requestScheme(req, config.trustProxy),
      httpVersion: req.httpVersion,
      traceparent: req.headers.traceparent,
      tracestate: req.headers.tracestate,
      requestId,
    });
    const traceFields = span ? { traceId: span.traceId, spanId: span.spanId } : {};

    res.on("finish", () => {
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      metrics.observeRequest(method, route, res.statusCode, seconds);
      // Span name and http.route use the route template; requests that matched no route get the method only.
      span?.end({ route: route === "unmatched" || route === "static" ? undefined : route, statusCode: res.statusCode });
      logger.info("request", { requestId, ...traceFields, method, route, status: res.statusCode, ms: Math.round(seconds * 1000) });
    });

    if (rawUrl.length > 4096) {
      sendJson(res, errorResult(new HttpError(414, "uri_too_long", "URL is too long."), requestId));
      return;
    }
    const url = new URL(rawUrl, "http://internal");
    const ip = clientIp(req, config.trustProxy);

    if (url.pathname === "/metrics") {
      route = "/metrics";
      if (!isPrivateAddress(ip)) {
        sendJson(res, errorResult(new HttpError(404, "not_found", "Not found."), requestId));
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
      res.end(metrics.render());
      return;
    }

    if (!url.pathname.startsWith("/api/")) {
      route = "static";
      if (!serveStatic(req, res, config.webRoot, url.pathname)) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Not found");
      }
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    const token = parseCookies(req.headers.cookie).get(cookieName);
    const ctx: RequestContext = {
      req,
      res,
      method,
      path: url.pathname,
      query: url.searchParams,
      params: {},
      requestId,
      ip,
      route,
      sessionToken: token,
      user: undefined,
      setCookies: [],
    };

    let result: JsonResult;
    try {
      const apiLimit = await deps.limiters.api.hit(`api:${ip}`);
      if (!apiLimit.allowed) {
        throw new HttpError(429, "rate_limited", "Too many requests. Slow down and try again shortly.", {
          retryAfterSeconds: apiLimit.retryAfterSeconds,
        });
      }
      const match = router.match(method, url.pathname);
      if (match === undefined) throw new HttpError(404, "not_found", "No API endpoint at this path.");
      if (match === "method_not_allowed") throw new HttpError(405, "method_not_allowed", `${method} is not supported here.`);
      route = match.route.pattern;
      ctx.route = route;
      ctx.params = match.params;

      if (MUTATING.has(method)) {
        const problem = csrfProblem(req, config.publicOrigin);
        if (problem) throw new HttpError(403, "csrf_failed", "Request blocked by cross-site request protection.");
      }
      if (token) ctx.user = getSessionUser(db, token);

      const auth = match.route.options.auth;
      if (auth && !ctx.user) throw unauthorized();
      if (Array.isArray(auth) && ctx.user && !auth.includes(ctx.user.role)) throw forbidden();

      result = await match.route.handler(ctx);
    } catch (err) {
      if (err instanceof HttpError) {
        result = errorResult(err, requestId);
        if (err.status === 429) {
          const retry = (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
          if (retry) result.headers = { "Retry-After": String(retry) };
        }
      } else {
        logger.error("unhandled error", { requestId, ...traceFields, route, err });
        result = errorResult(new HttpError(500, "internal_error", "Something went wrong on our side. Please try again."), requestId);
      }
    }
    if (ctx.setCookies.length > 0) res.setHeader("Set-Cookie", ctx.setCookies);
    sendJson(res, result);
  };

  return { handle, router, metrics, close: () => clearInterval(sweeper) };
}

export function createHttpServer(app: App): Server {
  const server = createServer((req, res) => {
    app.handle(req, res).catch(() => {
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
  });
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  return server;
}
