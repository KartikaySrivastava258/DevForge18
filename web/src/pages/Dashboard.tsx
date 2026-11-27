import { useEffect } from "react";
import { CourseworkPanels } from "./Coursework.tsx";
import { ErrorState, Loading } from "../components/States.tsx";
import { useAuth } from "../lib/auth.tsx";
import { formatDate } from "../lib/format.ts";
import { Link, navigate } from "../lib/router.tsx";
import type { Bookmark, ProgressResponse } from "../lib/types.ts";
import { useApi, useTitle } from "../lib/useApi.ts";

export function DashboardPage() {
  useTitle("My progress");
  const { user } = useAuth();
  useEffect(() => {
    if (user === null) navigate("/login?next=%2Fdashboard", { replace: true });
  }, [user]);
  const progress = useApi<ProgressResponse>(user ? "/api/me/progress" : null);
  const bookmarks = useApi<{ bookmarks: Bookmark[] }>(user ? "/api/me/bookmarks" : null);

  if (!user) return <div className="page"><Loading /></div>;
  if (progress.error) return <div className="page"><ErrorState error={progress.error} onRetry={progress.reload} /></div>;
  const p = progress.data;
  const started = p?.tracks.filter((t) => t.total > 0) ?? [];

  return (
    <div className="page">
      <h1>My progress</h1>
      <p className="lede">Signed in as {user.displayName}. A lesson counts as complete only after you pass its self-check.</p>
      {!p ? (
        <Loading />
      ) : (
        <>
          <div className="stat-row">
            <div className="stat">
              <b>{p.totals.lessonsCompleted}</b>
              <span>lessons completed</span>
            </div>
            <div className="stat">
              <b>{p.totals.lessonsInProgress}</b>
              <span>in progress</span>
            </div>
            <div className="stat">
              <b>{p.totals.lessonsAvailable}</b>
              <span>published so far</span>
            </div>
          </div>

          <div className="split" style={{ alignItems: "start" }}>
            <section aria-labelledby="recent-h">
              <h2 id="recent-h">Recent activity</h2>
              {p.recent.length === 0 ? (
                <p className="muted">
                  Nothing yet. Open a lesson to start, for example{" "}
                  <Link to="/tracks/docker/lessons/docker-images-vs-containers">Images vs Containers</Link>.
                </p>
              ) : (
                <ul className="link-list">
                  {p.recent.map((r) => (
                    <li key={r.lessonId}>
                      <Link to={`/tracks/${r.track}/lessons/${r.lessonId}`}>{r.title}</Link>
                      <span className={`tag${r.status === "completed" ? " tag--done" : ""}`}>
                        {r.status === "completed" ? `Completed ${formatDate(r.completedAt ?? r.updatedAt)}` : "In progress"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="tracks-h">
              <h2 id="tracks-h">Tracks with lessons</h2>
              <ul className="progress-list">
                {started.map((t) => (
                  <li key={t.slug}>
                    <Link to={`/tracks/${t.slug}`}>{t.shortTitle}</Link>
                    <div className="bar" role="progressbar" aria-label={`${t.shortTitle} progress`} aria-valuemin={0} aria-valuemax={t.total} aria-valuenow={t.completed}>
                      <span style={{ width: `${t.total ? (t.completed / t.total) * 100 : 0}%` }} />
                    </div>
                    <span>
                      {t.completed}/{t.total}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="small faint">Tracks appear here once their first lesson is published.</p>
            </section>
          </div>

          <CourseworkPanels />

          <section className="section" aria-labelledby="saved-h">
            <h2 id="saved-h">Saved for later</h2>
            {bookmarks.data && bookmarks.data.bookmarks.length === 0 ? (
              <p className="muted">Use “Save” on any track, lesson or path to keep it here.</p>
            ) : (
              <ul className="link-list">
                {bookmarks.data?.bookmarks.map((b) => (
                  <li key={`${b.type}:${b.id}`}>
                    {b.available && b.url ? <Link to={b.url}>{b.title}</Link> : <span className="muted">{b.id} (no longer available)</span>}
                    <span className="small faint">{b.type}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
