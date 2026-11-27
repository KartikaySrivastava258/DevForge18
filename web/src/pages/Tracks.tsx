import { useMemo } from "react";
import { LuSearch } from "react-icons/lu";
import { ErrorState, Loading } from "../components/States.tsx";
import { LevelTag } from "../components/Tags.tsx";
import { TrackIcon } from "../components/TrackIcon.tsx";
import { hours, statusLabel } from "../lib/format.ts";
import { Link, navigate, useLocation } from "../lib/router.tsx";
import type { TrackSummary, TracksResponse } from "../lib/types.ts";
import { useApi, useTitle } from "../lib/useApi.ts";

function matches(t: TrackSummary, q: string): boolean {
  if (!q) return true;
  const hay = `${t.shortTitle} ${t.title} ${t.products.join(" ")} ${t.mentalModel} ${t.outcome}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

export function TracksPage() {
  useTitle("Technology tracks");
  const { search } = useLocation();
  const q = search.get("q") ?? "";
  const level = search.get("level") ?? "";
  const category = search.get("category") ?? "";
  const { data, error, loading, reload } = useApi<TracksResponse>("/api/tracks", { cache: true });

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    navigate(`/tracks${qs ? `?${qs}` : ""}`, { replace: true });
  };

  const filtered = useMemo(
    () =>
      (data?.tracks ?? []).filter((t) => matches(t, q) && (!level || t.entryLevel === level) && (!category || t.category === category)),
    [data, q, level, category],
  );

  return (
    <div className="page">
      <h1>Technology tracks</h1>
      <p className="lede">
        Eighteen tracks, grouped by the job they do in a system. Each one starts with a plain explanation and builds towards
        production practice.
      </p>
      <p>
        <Link to="/graph">See how the tools connect</Link> · <Link to="/architecture">Reference architectures</Link> · <Link to="/capstones">Capstone projects that combine them</Link>
      </p>

      <div className="filters" role="group" aria-label="Filter tracks">
        <div className="search-input">
          <LuSearch aria-hidden="true" />
          <label className="sr-only" htmlFor="track-filter">
            Filter tracks by name or purpose
          </label>
          <input id="track-filter" className="input" type="search" placeholder="Filter by name or purpose" value={q} onChange={(e) => update("q", e.target.value)} />
        </div>
        <label className="sr-only" htmlFor="level-filter">
          Starting level
        </label>
        <select id="level-filter" className="select" value={level} onChange={(e) => update("level", e.target.value)}>
          <option value="">Any starting level</option>
          <option value="beginner">Starts at beginner</option>
          <option value="intermediate">Starts at intermediate</option>
        </select>
        <label className="sr-only" htmlFor="category-filter">
          Category
        </label>
        <select id="category-filter" className="select" value={category} onChange={(e) => update("category", e.target.value)}>
          <option value="">All categories</option>
          {data?.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {loading ? <Loading label="Loading tracks" /> : null}
      {data ? (
        <>
          <p className="small faint" aria-live="polite">
            Showing {filtered.length} of {data.tracks.length} tracks
          </p>
          {filtered.length === 0 ? (
            <div className="state">
              <h2>No tracks match these filters</h2>
              <p>
                <button type="button" className="btn" onClick={() => navigate("/tracks", { replace: true })}>
                  Clear filters
                </button>
              </p>
            </div>
          ) : (
            data.categories.map((cat) => {
              const items = filtered.filter((t) => t.category === cat.id);
              if (!items.length) return null;
              return (
                <section className="group" key={cat.id} aria-labelledby={`cat-${cat.id}`}>
                  <h2 id={`cat-${cat.id}`}>{cat.label}</h2>
                  {items.map((t) => (
                    <Link key={t.slug} to={`/tracks/${t.slug}`} className="track-row">
                      <span className="track-row__num">{t.number}</span>
                      <span className="track-row__icon">
                        <TrackIcon slug={t.slug} size={22} />
                      </span>
                      <span className="track-row__name">
                        {t.shortTitle}
                        <span className="track-row__products">{t.title}</span>
                      </span>
                      <span className="track-row__model">{t.mentalModel}</span>
                      <span className="track-row__meta">
                        <LevelTag level={t.entryLevel} />
                        <span>{hours(t.estimatedHours)}</span>
                        <span>{t.lessonCount > 0 ? `${t.lessonCount} lesson${t.lessonCount > 1 ? "s" : ""}` : statusLabel[t.contentStatus]}</span>
                      </span>
                    </Link>
                  ))}
                </section>
              );
            })
          )}
        </>
      ) : null}
    </div>
  );
}
