import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Content-Security-Policy: only same-origin scripts, styles and connections.
 * The frontend has no inline scripts or styles, so no 'unsafe-inline'.
 * (When video embeds arrive, add a narrowly scoped frame-src.)
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function applySecurityHeaders(res: ServerResponse, secure: boolean): void {
  res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if (secure) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

export const CSRF_HEADER = "x-devforge-csrf";

/**
 * CSRF defence for cookie-authenticated, state-changing requests:
 *  1. SameSite=Lax session cookie (browsers omit it on cross-site POSTs);
 *  2. a required custom header — cross-site pages cannot add custom headers
 *     without a CORS preflight, and this server grants no CORS;
 *  3. if the browser sends Origin, it must equal the configured public origin.
 * Returns a reason string when the request must be rejected.
 */
export function csrfProblem(req: IncomingMessage, publicOrigin: string): string | null {
  if (req.headers[CSRF_HEADER] !== "1") return "missing CSRF header";
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== publicOrigin) return "cross-origin request";
  const fetchSite = req.headers["sec-fetch-site"];
  if (fetchSite !== undefined && fetchSite !== "same-origin" && fetchSite !== "none") return "cross-site request";
  return null;
}

/**
 * Client IP for rate limiting. Behind a trusted proxy we use the right-most
 * X-Forwarded-For entry: the one appended by our own proxy. Left-most
 * entries are supplied by the client and can be forged.
 */
export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    const value = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;
    const last = value?.split(",").map((s) => s.trim()).filter(Boolean).at(-1);
    if (last) return last;
  }
  return req.socket.remoteAddress ?? "unknown";
}
