/**
 * A deliberately small router: method + path pattern with :params.
 * Params only match safe identifier characters, so handlers never see
 * slashes, dots-only segments or encoded traversal sequences.
 */
import type { Role } from "../auth/users.ts";
import type { JsonResult, RequestContext } from "./context.ts";

export type Handler = (ctx: RequestContext) => Promise<JsonResult> | JsonResult;

export interface RouteOptions {
  /** "user" = any signed-in user; an array = one of these roles. */
  auth?: "user" | Role[];
}

interface Route {
  method: string;
  pattern: string;
  segments: string[];
  handler: Handler;
  options: RouteOptions;
}

export interface RouteMatch {
  route: Route;
  params: Record<string, string>;
}

const PARAM_VALUE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler, options: RouteOptions = {}): void {
    this.routes.push({ method, pattern, segments: pattern.split("/").filter(Boolean), handler, options });
  }
  get(p: string, h: Handler, o?: RouteOptions): void { this.add("GET", p, h, o); }
  post(p: string, h: Handler, o?: RouteOptions): void { this.add("POST", p, h, o); }
  put(p: string, h: Handler, o?: RouteOptions): void { this.add("PUT", p, h, o); }
  patch(p: string, h: Handler, o?: RouteOptions): void { this.add("PATCH", p, h, o); }
  delete(p: string, h: Handler, o?: RouteOptions): void { this.add("DELETE", p, h, o); }

  /** Returns the match, "method_not_allowed" if only the path matched, or undefined. */
  match(method: string, path: string): RouteMatch | "method_not_allowed" | undefined {
    const parts = path.split("/").filter(Boolean);
    let pathMatched = false;
    for (const route of this.routes) {
      const params = matchSegments(route.segments, parts);
      if (!params) continue;
      if (route.method === method || (method === "HEAD" && route.method === "GET")) return { route, params };
      pathMatched = true;
    }
    return pathMatched ? "method_not_allowed" : undefined;
  }
}

function matchSegments(pattern: string[], parts: string[]): Record<string, string> | undefined {
  if (pattern.length !== parts.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const expected = pattern[i] ?? "";
    let actual = parts[i] ?? "";
    if (expected.startsWith(":")) {
      try {
        actual = decodeURIComponent(actual);
      } catch {
        return undefined;
      }
      if (!PARAM_VALUE.test(actual)) return undefined;
      params[expected.slice(1)] = actual;
    } else if (expected !== actual) {
      return undefined;
    }
  }
  return params;
}
