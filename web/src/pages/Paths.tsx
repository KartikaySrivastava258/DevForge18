import { BookmarkButton } from "../components/BookmarkButton.tsx";
import { Crumbs } from "../components/Crumbs.tsx";
import { ErrorState, Loading } from "../components/States.tsx";
import { LevelTag } from "../components/Tags.tsx";
import { useAuth } from "../lib/auth.tsx";
import { formatDate, hours } from "../lib/format.ts";
import { Link } from "../lib/router.tsx";
import type { MyQuizResult, PathResponse, PathsResponse, TracksResponse } from "../lib/types.ts";
import { useApi, useTitle } from "../lib/useApi.ts";

export function PathsPage() {
  useTitle("Learning paths");
  const paths = useApi<PathsResponse>("/api/paths", { cache: true });
  const tracks = useApi<TracksResponse>("/api/tracks", { cache: true });
  const name = (slug: string) => tracks.data?.tracks.find((t) => t.slug === slug)?.shortTitle ?? slug;

  return (
    <div className="page">
      <h1>Learning paths</h1>
      <p className="lede">
        Curated routes through the tracks for a specific goal. You do not need all 18 tracks; pick the path that matches what you
        want to build.
      </p>
      {paths.error ? <ErrorState error={paths.error} onRetry={paths.reload} /> : null}
      {paths.loading ? <Loading label="Loading paths" /> : null}
      {paths.data?.paths.map((p) => (
        <article className="path-row" key={p.slug}>
          <span className="path-row__n">{p.number}</span>
          <div>
            <h3>
              <Link to={`/paths/${p.slug}`}>{p.title}</Link>
            </h3>
            <p>{p.outcome}</p>
            <ol className="route" aria-label="Tracks in order">
              {p.modules.map((m) => (
                <li key={m.track}>{name(m.track)}</li>
              ))}
            </ol>
            <p className="small faint" style={{ marginTop: "var(--space-2)", marginBottom: 0 }}>
              {hours(p.estimatedHours)} in total, an estimate that varies with prior experience
            </p>
          </div>
        </article>
      ))}
    </div>
  );
}

export function PathPage({ slug }: { slug: string }) {
  const { data, error, loading, reload } = useApi<PathResponse>(`/api/paths/${encodeURIComponent(slug)}`, { cache: true });
  const { user } = useAuth();
  const myQuizzes = useApi<{ quizzes: MyQuizResult[] }>(user ? "/api/me/quizzes" : null);
  const quizResult = (track: string) => myQuizzes.data?.quizzes.find((q) => q.track === track);
  useTitle(data?.path.title);
  if (error) return <div className="page"><ErrorState error={error} onRetry={reload} /></div>;
  if (loading || !data) return <div className="page"><Loading label="Loading path" /></div>;
  const { path, modules, estimatedHours } = data;

  return (
    <div className="page">
      <Crumbs items={[{ label: "Learning paths", to: "/paths" }, { label: path.title }]} />
      <div className="track-head">
        <div>
          <h1>{path.title}</h1>
          <p className="lede">{path.outcome}</p>
        </div>
        <BookmarkButton type="path" id={path.slug} />
      </div>
      <dl className="facts">
        <div>
          <dt>Who it is for</dt>
          <dd>{path.target_learner}</dd>
        </div>
        <div>
          <dt>Tracks</dt>
          <dd>{modules.length}</dd>
        </div>
        <div>
          <dt>Estimated time</dt>
          <dd>{hours(estimatedHours)}</dd>
        </div>
      </dl>
      <div className="split" style={{ alignItems: "start" }}>
        <section aria-labelledby="route-h">
          <h2 id="route-h">The route</h2>
          <ol className="steps">
            {modules.map((m) =>
              m.track ? (
                <li key={m.track.slug}>
                  <h3>
                    <Link to={`/tracks/${m.track.slug}`}>{m.track.shortTitle}</Link>
                  </h3>
                  <p className="muted" style={{ marginBottom: "var(--space-2)" }}>
                    {m.focus}
                  </p>
                  <div className="tags">
                    <LevelTag level={m.track.entryLevel} />
                    <span className="tag">{hours(m.track.estimatedHours)}</span>
                    <span className="tag">
                      {m.track.lessonCount ? `${m.track.lessonCount} lesson${m.track.lessonCount > 1 ? "s" : ""}` : "Outline only"}
                    </span>
                  </div>
                  {m.track.hasQuiz ? (
                    quizResult(m.track.slug)?.passed ? (
                      <p className="small">
                        <span className="tag tag--ok">Skipped by quiz</span> best score {Math.round((quizResult(m.track.slug)?.bestScore ?? 0) * 100)}% —{" "}
                        <Link to={`/tracks/${m.track.slug}`}>review the track anyway</Link>
                      </p>
                    ) : (
                      <p className="small">
                        Know it already? <Link to={`/tracks/${m.track.slug}/quiz`}>Take the {m.track.shortTitle} quiz</Link> to skip ahead.
                      </p>
                    )
                  ) : null}
                </li>
              ) : null,
            )}
          </ol>
        </section>
        <section aria-labelledby="before-h">
          <h2 id="before-h">Before you start</h2>
          <ul>
            {path.prerequisites.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <h2>If you already know some of this</h2>
          <p className="muted">{path.alternate_route}</p>
          <h2>Capstone</h2>
          <p>
            {path.capstone.title}{" "}
            {path.capstone.status === "planned" ? <span className="tag">Planned</span> : null}
          </p>
          <p className="small faint">Path last reviewed {formatDate(path.last_reviewed)}.</p>
        </section>
      </div>
    </div>
  );
}
