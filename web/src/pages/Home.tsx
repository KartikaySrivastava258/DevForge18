import { HeaderSearch } from "../components/Layout.tsx";
import { ErrorState, Loading } from "../components/States.tsx";
import { SystemMap } from "../components/SystemMap.tsx";
import { useAuth } from "../lib/auth.tsx";
import { Link } from "../lib/router.tsx";
import type { PathsResponse, ProgressResponse, TracksResponse } from "../lib/types.ts";
import { useApi, useTitle } from "../lib/useApi.ts";

function ContinueLearning() {
  const { user } = useAuth();
  const progress = useApi<ProgressResponse>(user ? "/api/me/progress" : null);
  const recent = progress.data?.recent.filter((r) => r.status === "in_progress") ?? [];
  if (!user || recent.length === 0) return null;
  const item = recent[0];
  if (!item) return null;
  return (
    <div className="notice">
      <p>
        <strong>Continue where you left off:</strong>{" "}
        <Link to={`/tracks/${item.track}/lessons/${item.lessonId}`}>{item.title}</Link>
      </p>
    </div>
  );
}

export function HomePage() {
  useTitle(undefined);
  const tracks = useApi<TracksResponse>("/api/tracks", { cache: true });
  const paths = useApi<PathsResponse>("/api/paths", { cache: true });
  const lessonCount = tracks.data?.tracks.reduce((n, t) => n + t.lessonCount, 0);

  return (
    <div className="page">
      <section className="hero" aria-labelledby="hero-title">
        <div>
          <h1 id="hero-title">
            <span>Learn the tools.</span>
            <span>Understand the systems.</span>
            <span>Build like an engineer.</span>
          </h1>
          <HeaderSearch large />
        </div>
        <div className="hero__side">
          <p>
            Eighteen industry technologies, taught the way they are used: as parts of one system. Start from a plain-language
            explanation, see how each tool connects to the others, then practise.
          </p>
          <div className="hero__facts">
            <div>
              <b>18</b>technology tracks
            </div>
            <div>
              <b>{paths.data?.paths.length ?? 8}</b>learning paths
            </div>
            <div>
              <b>{lessonCount ?? "–"}</b>
              {lessonCount === 1 ? "published lesson" : "published lessons"}
            </div>
          </div>
          <p className="small faint" style={{ marginTop: "var(--space-4)" }}>
            DevForge is built in phases. Every track has its full curriculum outline; lessons, labs and projects are published as they
            pass review.
          </p>
        </div>
      </section>

      <ContinueLearning />

      <section className="section" aria-labelledby="map-title">
        <div className="section__head">
          <h2 id="map-title">How the 18 tracks connect</h2>
          <Link to="/tracks">Browse the catalogue</Link>
        </div>
        {tracks.error ? (
          <ErrorState error={tracks.error} onRetry={tracks.reload} />
        ) : tracks.data ? (
          <SystemMap tracks={tracks.data.tracks} />
        ) : (
          <Loading label="Loading the system map" />
        )}
      </section>

      <section className="section" aria-labelledby="paths-title">
        <div className="section__head">
          <h2 id="paths-title">Choose a learning path</h2>
          <Link to="/paths">All paths</Link>
        </div>
        {paths.error ? <ErrorState error={paths.error} onRetry={paths.reload} /> : null}
        {paths.data ? (
          <div className="split">
            {paths.data.paths.map((p) => (
              <div key={p.slug}>
                <h3 style={{ fontSize: "var(--step-0)", marginBottom: "var(--space-1)" }}>
                  <Link to={`/paths/${p.slug}`}>{p.title}</Link>
                </h3>
                <p className="small muted" style={{ marginBottom: 0 }}>
                  {p.modules.length} tracks, about {p.estimatedHours.min}–{p.estimatedHours.max} hours
                </p>
              </div>
            ))}
          </div>
        ) : paths.loading ? (
          <Loading />
        ) : null}
      </section>
    </div>
  );
}
