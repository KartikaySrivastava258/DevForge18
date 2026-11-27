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
import { FixedWindowLimiter } from "./http/rate-limit.ts";
import { Router } from "./http/router.ts";
import { applySecurityHeaders, clientIp, csrfProblem } from "./http/security.ts";
import { serveStatic } from "./http/static.ts";
import type { Logger } from "./observability/logger.ts";
import { Metrics } from "./observability/metrics.ts";
import { registerAdminRoutes } from "./routes/admin.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerContentRoutes } from "./routes/content.ts";
import { sessionCookieName, type AppDeps, type Limiters } from "./routes/deps.ts";
import { registerLearningRoutes } from "./routes/learning.ts";
import { registerLabRoutes } from "./routes/labs.ts";
import { registerAssessmentRoutes } from "./routes/assessment.ts";
import { registerArchitectureRoutes } from "./routes/architecture.ts";
import { registerSimulationRoutes } from "./routes/simulations.ts";
import { registerCmsRoutes } from "./routes/cms.ts";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MINUTE = 60_000;

export function defaultLimiters(): Limiters {
  return {
    register: new FixedWindowLimiter(60, 60 * MINUTE),
    loginByIp: new FixedWindowLimiter(200, 15 * MINUTE),
    loginFailuresByEmail: new FixedWindowLimiter(10, 15 * MINUTE),
    api: new FixedWindowLimiter(1200, MINUTE),
  };
}

/** Loopback and private-network addresses (used to restrict /metrics). */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (/^127\./.test(v4) || /^10\./.test(v4) || /^192\.168\./.test(v4)) return true;
  const m = /^172\.(\d+)\./.exec(v4);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return ip === "::1" || /^f[cd][0-9a-f]{2}:/i.test(ip);
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
}): App {
  const metrics = new Metrics();
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
  registerCmsRoutes(router, deps); // content editor that opens pull requests (ADR 0011)

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

    res.on("finish", () => {
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      metrics.observeRequest(method, route, res.statusCode, seconds);
      logger.info("request", { requestId, method, route, status: res.statusCode, ms: Math.round(seconds * 1000) });
    });

    const rawUrl = req.url ?? "/";
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
      const apiLimit = deps.limiters.api.hit(`api:${ip}`);
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
        logger.error("unhandled error", { requestId, route, err });
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
