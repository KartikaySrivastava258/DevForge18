/**
 * A small history-API router. Enough for this app's flat route table and
 * avoids a dependency; swap for a full router if nested layouts appear.
 */
import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

const snapshot = () => window.location.pathname + window.location.search + window.location.hash;

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (options.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  for (const l of listeners) l();
}

export interface Location {
  pathname: string;
  search: URLSearchParams;
  hash: string;
}

export function useLocation(): Location {
  const href = useSyncExternalStore(subscribe, snapshot, snapshot);
  const url = new URL(href, "http://local");
  return { pathname: url.pathname, search: url.searchParams, hash: url.hash };
}

/** Match "/tracks/:slug" against a pathname; returns params or null. */
export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const a = pathname.split("/").filter(Boolean);
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i] ?? "";
    const val = a[i] ?? "";
    if (seg.startsWith(":")) {
      try {
        params[seg.slice(1)] = decodeURIComponent(val);
      } catch {
        return null;
      }
    } else if (seg !== val) return null;
  }
  return params;
}

/** Only allow same-site relative paths as post-login redirects (prevents open redirects). */
export function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/dashboard";
  return value;
}

function isPlainLeftClick(e: MouseEvent<HTMLAnchorElement>): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented;
}

/** Intercept clicks on internal links inside rendered HTML (e.g. lesson bodies). */
export function handleInternalLinkClick(e: MouseEvent<HTMLElement>): void {
  const anchor = (e.target as HTMLElement).closest("a");
  if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
  const href = anchor.getAttribute("href") ?? "";
  if (!href.startsWith("/") || href.startsWith("//")) return;
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(href);
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string };

export function Link({ to, onClick, ...rest }: LinkProps) {
  const { pathname } = useLocation();
  const current = rest["aria-current"] ?? (to === pathname ? "page" : undefined);
  return (
    <a
      {...rest}
      href={to}
      aria-current={current}
      onClick={(e) => {
        onClick?.(e);
        if (!isPlainLeftClick(e) || rest.target) return;
        e.preventDefault();
        navigate(to);
      }}
    />
  );
}
