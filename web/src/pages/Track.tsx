import { BookmarkButton } from "../components/BookmarkButton.tsx";
import { Crumbs } from "../components/Crumbs.tsx";
import { ErrorState, Loading } from "../components/States.tsx";
import { LevelTag, ModeTag } from "../components/Tags.tsx";
import { TrackIcon } from "../components/TrackIcon.tsx";
import { formatDate, hours, levelLabel, statusLabel } from "../lib/format.ts";
import { Link } from "../lib/router.tsx";
import type { Level, Resource, TrackResponse } from "../lib/types.ts";
import { useApi, useTitle } from "../lib/useApi.ts";
import { useScrollSpy } from "../lib/useScrollSpy.ts";

const SECTIONS = [
  { id: "understand", label: "Understand it" },
  { id: "connections", label: "How it connects" },
  { id: "curriculum", label: "Curriculum" },
  { id: "lessons", label: "Lessons" },
  { id: "practice", label: "Labs" },
  { id: "projects", label: "Projects" },
  { id: "resources", label: "Official resources" },
  { id: "about", label: "About this track" },
];
const LEVELS: Level[] = ["beginner", "intermediate", "advanced"];

export function ResourceItem({ r }: { r: Resource }) {
  return (
    <div className="resource">
      <a className="resource__title" href={r.url} target="_blank" rel="noopener noreferrer">
        {r.title}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      <div className="resource__meta">
        <span>{r.publisher}</span>
        {r.official ? <span className="tag">Official</span> : <span className="tag">Community</span>}
        <span className="tag">{levelLabel(r.level === "all" ? "all levels" : r.level)}</span>
        {r.verification.status === "verified" && r.verification.checked_on ? (
          <span className="tag tag--done">Link checked {formatDate(r.verification.checked_on)}</span>
        ) : r.verification.status === "broken" ? (
          <span className="tag tag--sim">Link reported broken</span>
        ) : (
          <span className="faint">Link not yet verified</span>
        )}
      </div>
      <p>{r.why}</p>
    </div>
  );
}

export function TrackPage({ slug }: { slug: string }) {
  const { data, error, loading, reload } = useApi<TrackResponse>(`/api/tracks/${encodeURIComponent(slug)}`, { cache: true });
  useTitle(data ? `${data.track.short_title}: ${data.track.title}` : undefined);
  const active = useScrollSpy(
    SECTIONS.map((s) => s.id),
    Boolean(data),
  );

  if (error) return <div className="page"><ErrorState error={error} onRetry={reload} /></div>;
  if (loading || !data) return <div className="page"><Loading label="Loading track" /></div>;
  const { track, summary, lessons, prerequisites, related, paths } = data;

  return (
    <div className="page">
      <Crumbs items={[{ label: "Tracks", to: "/tracks" }, { label: track.short_title }]} />
      <header className="track-head">
        <div>
          <p className="track-head__kicker">
            <TrackIcon slug={track.slug} size={18} />
            Track {track.number} of 18, {summary.categoryLabel.toLowerCase()}
          </p>
          <h1>
            {track.short_title}: {track.title}
          </h1>
          <p className="lede">{track.outcome}</p>
        </div>
        <BookmarkButton type="track" id={track.slug} />
      </header>

      <dl className="facts">
        <div>
          <dt>Starts at</dt>
          <dd>{levelLabel(track.entry_level)}</dd>
        </div>
        <div>
          <dt>Estimated time</dt>
          <dd>{hours(track.estimated_hours)}</dd>
        </div>
        <div>
          <dt>Recommended first</dt>
          <dd>{prerequisites.length ? prerequisites.map((p) => p.shortTitle).join(", ") : "No earlier track"}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{statusLabel[track.content_status]}</dd>
        </div>
      </dl>

      {track.content_status !== "complete" ? (
        <div className="notice notice--warn">
          <p>
            <strong>This track is still being written.</strong> The explanation and curriculum below are reviewed;{" "}
            {lessons.length === 0
              ? "no lessons are published yet."
              : lessons.length === 1 ? "1 lesson is published so far." : `${lessons.length} lessons are published so far.`}{" "}
            Labs and projects marked “planned” are not available yet.
          </p>
        </div>
      ) : null}

      <div className="doc">
        <nav className="doc__aside" aria-label="On this page">
          <h2>On this page</h2>
          <ul>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} aria-current={active === s.id ? "true" : undefined}>
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <section id="understand" className="section" aria-labelledby="understand-h">
            <h2 id="understand-h">Understand it</h2>
            <p className="mental-model">{track.mental_model}</p>
            <div className="prose">
              <p>{track.summary}</p>
            </div>
            <div className="explain" style={{ marginTop: "var(--space-5)" }}>
              <div>
                <h3>The problem it solves</h3>
                <p>{track.problem}</p>
              </div>
              <div>
                <h3>What it is not</h3>
                <p>{track.not_this}</p>
              </div>
              <div>
                <h3>Where it sits in a system</h3>
                <p>{track.architecture_position}</p>
              </div>
            </div>
            <h3 style={{ marginTop: "var(--space-6)" }}>{track.products.length > 1 ? "What this track covers" : "The product"}</h3>
            <ul className="products">
              {track.products.map((p) => (
                <li key={p.name}>
                  <b>{p.name}</b>
                  <span className="muted">{p.role}</span>
                </li>
              ))}
            </ul>
          </section>

          <section id="connections" className="section" aria-labelledby="connections-h">
            <h2 id="connections-h">How it connects</h2>
            {related.length ? (
              <ul className="conn-list">
                {related.map((r) => (
                  <li key={r.track.slug}>
                    <Link to={`/tracks/${r.track.slug}`}>{r.track.shortTitle}</Link>
                    <div className="muted">{r.why}</div>
                  </li>
                ))}
              </ul>
            ) : null}
            {paths.length ? (
              <p style={{ marginTop: "var(--space-5)" }}>
                Part of{" "}
                {paths.map((p, i) => (
                  <span key={p.slug}>
                    {i > 0 ? (i === paths.length - 1 ? " and " : ", ") : ""}
                    <Link to={`/paths/${p.slug}`}>{p.title}</Link>
                  </span>
                ))}
                .
              </p>
            ) : null}
            {track.skills_needed.length ? (
              <>
                <h3>Skills that help before you start</h3>
                <ul className="muted">
                  {track.skills_needed.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>

          <section id="curriculum" className="section" aria-labelledby="curriculum-h">
            <h2 id="curriculum-h">Curriculum</h2>
            <p className="muted">What this track teaches, from first principles to production concerns.</p>
            <div className="levels">
              {LEVELS.map((lvl) => {
                const topics = track.topics.filter((t) => t.level === lvl);
                if (!topics.length) return null;
                return (
                  <div key={lvl}>
                    <h3>
                      <LevelTag level={lvl} />
                    </h3>
                    <ul>
                      {topics.map((t) => (
                        <li key={t.title}>{t.title}</li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>

          <section id="lessons" className="section" aria-labelledby="lessons-h">
            <h2 id="lessons-h">Lessons</h2>
            {lessons.length ? (
              <ol className="lesson-list">
                {lessons.map((l, i) => (
                  <li key={l.id}>
                    <Link to={`/tracks/${track.slug}/lessons/${l.id}`}>
                      <span className="lesson-list__n">{i + 1}</span>
                      <span>{l.title}</span>
                      <span className="tags">
                        <LevelTag level={l.level} />
                        <span className="tag">{l.estimatedMinutes} min</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">No lessons are published for this track yet. The curriculum above shows what they will cover.</p>
            )}
          </section>

          <section id="practice" className="section" aria-labelledby="practice-h">
            <h2 id="practice-h">Labs</h2>
            <p className="muted">
              Local labs run on your own machine. Browser simulations are interactive models of the concept, clearly labelled, and do
              not run real infrastructure.
            </p>
            <ul className="plan-list">
              {track.labs.map((l) => (
                <li key={l.title}>
                  <span>{l.title}</span>
                  <span className="tags">
                    <LevelTag level={l.level} />
                    <ModeTag mode={l.mode} />
                    {l.status === "planned" ? <span className="tag">Planned</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section id="projects" className="section" aria-labelledby="projects-h">
            <h2 id="projects-h">Projects</h2>
            <ul className="plan-list">
              {track.projects.map((p) => (
                <li key={p.title}>
                  <span>{p.title}</span>
                  <span className="tags">
                    <LevelTag level={p.level} />
                    {p.status === "planned" ? <span className="tag">Planned</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section id="resources" className="section" aria-labelledby="resources-h">
            <h2 id="resources-h">Official resources</h2>
            <p className="muted">Documentation from the projects themselves comes first. Links open in a new tab.</p>
            {track.resources.map((r) => (
              <ResourceItem key={r.url} r={r} />
            ))}
          </section>

          <section id="about" className="section" aria-labelledby="about-h">
            <h2 id="about-h">About this track</h2>
            <p className="muted small">
              Content version {track.content_version}, last reviewed {formatDate(track.last_reviewed)} by {track.owner}. Spotted
              something outdated or wrong? Report it through the project’s issue tracker so it can be reviewed.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
