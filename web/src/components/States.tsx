import type { ApiError } from "../lib/api.ts";
import { Link } from "../lib/router.tsx";

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="skeleton-lines" role="status" aria-live="polite">
      <span className="sr-only">{label}…</span>
      <div className="skeleton" style={{ width: "40%", height: "2rem" }} />
      <div className="skeleton" style={{ width: "90%" }} />
      <div className="skeleton" style={{ width: "80%" }} />
      <div className="skeleton" style={{ width: "85%" }} />
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  if (error.status === 404) return <NotFoundState />;
  return (
    <div className="state" role="alert">
      <h2>This page could not load</h2>
      <p>{error.message}</p>
      {onRetry ? (
        <button type="button" className="btn btn--primary" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function NotFoundState() {
  return (
    <div className="state">
      <h2>Page not found</h2>
      <p>The link may be mistyped, or the content may have moved.</p>
      <p>
        <Link to="/tracks">Browse all 18 tracks</Link> or <Link to="/search">search for a topic</Link>.
      </p>
    </div>
  );
}

/** Shown to signed-in users whose role does not allow a page (the server enforces the same rule). */
export function NotAllowedState({ message }: { message: string }) {
  return (
    <div className="state" role="alert">
      <h2>You are not allowed to use this page</h2>
      <p>{message}</p>
      <p>
        <Link to="/dashboard">Go to my progress</Link>
      </p>
    </div>
  );
}
