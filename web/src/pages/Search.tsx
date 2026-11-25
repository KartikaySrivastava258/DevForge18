import { HeaderSearch } from "../components/Layout.tsx";
import { ErrorState, Loading } from "../components/States.tsx";
import { Link, useLocation } from "../lib/router.tsx";
import type { SearchResult } from "../lib/types.ts";
import { useApi, useTitle } from "../lib/useApi.ts";

const TYPE_LABEL: Record<SearchResult["type"], string> = { track: "Track", path: "Learning path", lesson: "Lesson", topic: "Curriculum topic" };

export function SearchPage() {
  const { search } = useLocation();
  const q = (search.get("q") ?? "").trim();
  useTitle(q ? `Search: ${q}` : "Search");
  const { data, error, loading, reload } = useApi<{ results: SearchResult[] }>(q ? `/api/search?q=${encodeURIComponent(q)}&limit=30` : null);

  return (
    <div className="page page--narrow">
      <h1>Search</h1>
      <HeaderSearch large autoFocus={!q} initial={q} />
      <div style={{ marginTop: "var(--space-5)" }} aria-live="polite">
        {!q ? (
          <p className="muted">Search tracks, curriculum topics, lessons and learning paths. Abbreviations such as k8s, pg and otel work.</p>
        ) : error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading ? (
          <Loading label="Searching" />
        ) : data && data.results.length === 0 ? (
          <div className="state">
            <h2>No results for “{q}”</h2>
            <p>Try a shorter term or a technology name, or <Link to="/tracks">browse all tracks</Link>.</p>
          </div>
        ) : data ? (
          <>
            <p className="small faint">
              {data.results.length} result{data.results.length === 1 ? "" : "s"} for “{q}”
            </p>
            <ul className="results">
              {data.results.map((r) => (
                <li key={`${r.type}:${r.id}`}>
                  <Link to={r.url}>{r.title}</Link>
                  <small>
                    {TYPE_LABEL[r.type]}, {r.context}
                  </small>
                  <p>{r.snippet}</p>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}
