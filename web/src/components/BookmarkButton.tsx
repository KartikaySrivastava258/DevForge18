import { useState } from "react";
import { LuBookmark, LuBookmarkCheck } from "react-icons/lu";
import { bookmarkKey, useAuth } from "../lib/auth.tsx";
import { Link, useLocation } from "../lib/router.tsx";
import type { Bookmark } from "../lib/types.ts";

export function BookmarkButton({ type, id }: { type: Bookmark["type"]; id: string }) {
  const { user, bookmarks, toggleBookmark } = useAuth();
  const { pathname } = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  if (user === undefined) return null;
  if (!user) {
    return (
      <Link className="btn btn--small" to={`/login?next=${encodeURIComponent(pathname)}`}>
        <LuBookmark aria-hidden="true" /> Sign in to save
      </Link>
    );
  }
  const saved = bookmarks.has(bookmarkKey(type, id));
  return (
    <button
      type="button"
      className="btn btn--small"
      aria-pressed={saved}
      disabled={busy}
      title={error ? "Could not update the bookmark. Try again." : undefined}
      onClick={async () => {
        setBusy(true);
        setError(false);
        try {
          await toggleBookmark(type, id);
        } catch {
          setError(true);
        } finally {
          setBusy(false);
        }
      }}
    >
      {saved ? <LuBookmarkCheck aria-hidden="true" /> : <LuBookmark aria-hidden="true" />}
      {saved ? "Saved" : "Save"}
      {error ? <span className="sr-only"> (last change failed)</span> : null}
    </button>
  );
}
