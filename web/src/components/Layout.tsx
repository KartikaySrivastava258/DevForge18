import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { LuLogOut, LuMenu, LuMoon, LuSearch, LuSun, LuX } from "react-icons/lu";
import { useAuth } from "../lib/auth.tsx";
import { Link, navigate, useLocation } from "../lib/router.tsx";
import { currentTheme, setTheme, type Theme } from "../lib/theme.ts";

function Logo() {
  // Two offset frames: a container inside a system. Drawn for DevForge; not derived from any product mark.
  return (
    <svg className="brand__mark" viewBox="0 0 26 26" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="15" height="15" rx="3" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.55" />
      <rect x="9.5" y="9.5" width="15" height="15" rx="3" fill="var(--accent)" />
    </svg>
  );
}

function ThemeToggle() {
  const [theme, setLocal] = useState<Theme>(() => currentTheme());
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="btn btn--ghost btn--icon"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => {
        setTheme(next);
        setLocal(next);
      }}
    >
      {theme === "dark" ? <LuSun aria-hidden="true" /> : <LuMoon aria-hidden="true" />}
    </button>
  );
}

export function HeaderSearch({ large = false, autoFocus = false, initial = "" }: { large?: boolean; autoFocus?: boolean; initial?: string }) {
  const [q, setQ] = useState(initial);
  useEffect(() => setQ(initial), [initial]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    navigate(query ? `/search?q=${encodeURIComponent(query)}` : "/search");
  };
  return (
    <form role="search" onSubmit={submit} className={large ? "" : "header-search"}>
      <div className={`search-input${large ? " search-input--large" : ""}`}>
        <LuSearch aria-hidden="true" />
        <label className="sr-only" htmlFor={large ? "search-main" : "search-header"}>
          Search tracks, topics and lessons
        </label>
        <input
          id={large ? "search-main" : "search-header"}
          className="input"
          type="search"
          value={q}
          autoFocus={autoFocus}
          placeholder={large ? "Search: try “k8s”, “merge conflict” or “cache”" : "Search"}
          onChange={(e) => setQ(e.target.value)}
          maxLength={200}
        />
      </div>
    </form>
  );
}

function AccountArea() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  if (user === undefined) return <span className="small faint" aria-hidden="true" />;
  if (!user) {
    return (
      <Link className="btn btn--small" to={`/login?next=${encodeURIComponent(pathname)}`}>
        Sign in
      </Link>
    );
  }
  return (
    <>
      <Link to="/dashboard" className="btn btn--ghost btn--small" title={user.email}>
        {user.displayName}
      </Link>
      <button
        type="button"
        className="btn btn--ghost btn--icon"
        aria-label="Sign out"
        title="Sign out"
        onClick={async () => {
          await logout().catch(() => undefined);
          navigate("/");
        }}
      >
        <LuLogOut aria-hidden="true" />
      </button>
    </>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [pathname]);

  const section = (prefix: string) => (pathname === prefix || pathname.startsWith(`${prefix}/`) ? "page" : undefined);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="site-header__inner">
          <Link to="/" className="brand" aria-label="DevForge 18 home" aria-current={undefined}>
            <Logo />
            <span>
              DevForge <span className="brand__num">18</span>
            </span>
          </Link>
          <nav
            className="nav"
            id="primary-nav"
            aria-label="Primary"
            data-open={menuOpen}
            onClick={(e) => {
              // Close immediately on tap, rather than after the route change re-renders the page.
              if ((e.target as HTMLElement).closest("a")) setMenuOpen(false);
            }}
          >
            <Link to="/tracks" aria-current={section("/tracks")}>
              Tracks
            </Link>
            <Link to="/paths" aria-current={section("/paths")}>
              Learning paths
            </Link>
            {user ? (
              <Link to="/dashboard" aria-current={section("/dashboard")}>
                My progress
              </Link>
            ) : null}
          </nav>
          {pathname !== "/search" ? <HeaderSearch /> : null}
          <div className="header-actions">
            <ThemeToggle />
            <AccountArea />
            <button
              type="button"
              className="btn btn--ghost btn--icon menu-button"
              aria-expanded={menuOpen}
              aria-controls="primary-nav"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              onClick={() => setMenuOpen((o) => !o)}
            >
              {menuOpen ? <LuX aria-hidden="true" /> : <LuMenu aria-hidden="true" />}
            </button>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <footer className="site-footer">
        <div className="site-footer__inner">
          <p>DevForge 18 is an open educational project for learning how software systems are engineered.</p>
          <p>Product names are trademarks of their owners and identify the technologies taught; no endorsement is implied.</p>
        </div>
      </footer>
    </>
  );
}
