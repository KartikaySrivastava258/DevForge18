import { BookmarkButton } from "../components/BookmarkButton.tsx";
import { Crumbs } from "../components/Crumbs.tsx";
import { ErrorState, Loading } from "../components/States.tsx";
import { LevelTag, ModeTag } from "../components/Tags.tsx";
import { TrackIcon } from "../components/TrackIcon.tsx";
import { formatDate, hours, levelLabel, statusLabel } from "../lib/format.ts";
import { useAuth } from "../lib/auth.tsx";
import { Link } from "../lib/router.tsx";
import type { Level, ProgressResponse, Resource, TrackResponse } from "../lib/types.ts";
import { useApi, useTitle } from "../lib/useApi.ts";
import { useScrollSpy } from "../lib/useScrollSpy.ts";

const SECTIONS = [
  { id: "understand", label: "Understand it" },
  { id: "connections", label: "How it connects" },
  { id: "curriculum", label: "Curriculum" },
  { id: "lessons", label: "Lessons" },
  { id: "simulations", label: "Simulations" },
  { id: "practice", label: "Labs" },
  { id: "projects", label: "Projects" },
  { id: "quiz", label: "Quiz" },
  { id: "who-uses", label: "Who uses it" },
  { id: "alternatives", label: "Alternatives" },
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

  // Completion ticks for a signed-in learner, from the same progress endpoint as the dashboard.
  const { user } = useAuth();
  const progress = useApi<ProgressResponse>(user ? "/api/me/progress" : null);
  const completed = new Set((progress.data?.lessons ?? []).filter((p) => p.status === "completed").map((p) => p.lessonId));

  if (error) return <div className="page"><ErrorState error={error} onRetry={reload} /></div>;
  if (loading || !data) return <div className="page"><Loading label="Loading track" /></div>;
  const { track, summary, lessons, simulations, caseStudies, labs, coveredLabs = [], quiz, projects, prerequisites, related, paths } = data;

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
              <>
                {user ? (
                  <p className="muted small" role="status">
                    {progress.data
                      ? `You have completed ${lessons.filter((l) => completed.has(l.id)).length} of ${lessons.length} lessons in this track.`
                      : progress.error
                        ? "Your progress could not be loaded; the lessons are listed without it."
                        : "Loading your progress…"}
                  </p>
                ) : null}
                {LEVELS.map((lvl) => {
                  const group = lessons.map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => l.level === lvl);
                  if (!group.length) return null;
                  return (
                    <div key={lvl} className="lesson-group">
                      <h3 className="lesson-group__h">
                        {levelLabel(lvl)} <span className="faint small">({group.length})</span>
                      </h3>
                      <ol className="lesson-list">
                        {group.map(({ l, n }) => (
                          <li key={l.id}>
                            <Link to={`/tracks/${track.slug}/lessons/${l.id}`}>
                              <span className="lesson-list__n">{n}</span>
                              <span>{l.title}</span>
                              <span className="tags">
                                {completed.has(l.id) ? <span className="tag tag--done">Completed</span> : null}
                                <span className="tag">{l.estimatedMinutes} min</span>
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ol>
                    </div>
                  );
                })}
              </>
            ) : (
              <p className="muted">No lessons are published for this track yet. The curriculum above shows what they will cover.</p>
            )}
          </section>

          <section id="simulations" className="section" aria-labelledby="simulations-h">
            <h2 id="simulations-h">Simulations</h2>
            {simulations.length ? (
              <>
                <p className="muted">Interactive teaching models of the concept. They are labelled as simulations, say what they simplify, and run nothing real.</p>
                <ul className="plan-list">
                  {simulations.map((s) => (
                    <li key={s.id}>
                      <span>
                        <Link to={`/tracks/${track.slug}/simulations/${s.id}`}>{s.title}</Link>
                        <span className="muted small sim-card__concept">{s.concept}</span>
                      </span>
                      <span className="tags">
                        <span className="tag tag--sim">Simulation</span>
                        <span className="tag">
                          {s.challengeCount} challenge{s.challengeCount === 1 ? "" : "s"}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="muted">No simulation is published for this track yet.</p>
            )}
          </section>

          <section id="practice" className="section" aria-labelledby="practice-h">
            <h2 id="practice-h">Labs</h2>
            <p className="muted">
              Local labs run on your own machine. Browser simulations are interactive models of the concept, clearly labelled, and do
              not run real infrastructure.
            </p>
            {coveredLabs.length ? (
              <p className="muted">
                Where a lesson or a project already has you do a task, it is listed here and links there instead of to a separate lab.
              </p>
            ) : null}
            <ul className="plan-list">
              {track.labs.map((l) => {
                const covered = l.status === "covered" ? coveredLabs.find((c) => c.lab === l.title) : undefined;
                if (covered) {
                  const to = `/tracks/${covered.track}/${covered.kind === "lesson" ? "lessons" : "projects"}/${covered.id}`;
                  return (
                    <li key={l.title}>
                      <span>
                        <span>{l.title}</span>
                        <span className="muted small sim-card__concept">
                          Practised in the {covered.kind} <Link to={to}>{covered.title}</Link>
                          {covered.track !== track.slug ? ` (${covered.track} track)` : ""}
                        </span>
                      </span>
                      <span className="tags">
                        <LevelTag level={covered.level} />
                        <span className="tag">{covered.kind === "lesson" ? "Lesson" : "Project"}</span>
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={l.title}>
                    {l.lab && labs.some((x) => x.id === l.lab) ? <Link to={`/tracks/${track.slug}/labs/${l.lab}`}>{l.title}</Link> : <span>{l.title}</span>}
                    <span className="tags">
                      <LevelTag level={l.level} />
                      <ModeTag mode={l.mode} />
                      {l.status !== "available" ? <span className="tag">Planned</span> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section id="projects" className="section" aria-labelledby="projects-h">
            <h2 id="projects-h">Projects</h2>
            <ul className="plan-list">
              {track.projects.map((p) => (
                <li key={p.title}>
                  {p.project && projects.some((x) => x.id === p.project) ? <Link to={`/tracks/${track.slug}/projects/${p.project}`}>{p.title}</Link> : <span>{p.title}</span>}
                  <span className="tags">
                    <LevelTag level={p.level} />
                    {p.status === "planned" ? <span className="tag">Planned</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section id="quiz" className="section" aria-labelledby="quiz-h">
            <h2 id="quiz-h">Quiz</h2>
            {quiz ? (
              <p>
                <Link to={`/tracks/${track.slug}/quiz`}>{quiz.title}</Link> — {quiz.questionCount} questions from all levels, pass mark{" "}
                {Math.round(quiz.passMark * 100)}%. Already know this tool? Passing lets learning paths mark this track as skippable.
              </p>
            ) : (
              <p className="muted">The quiz for this track is planned.</p>
            )}
          </section>

          <section id="who-uses" className="section" aria-labelledby="who-uses-h">
            <h2 id="who-uses-h">Who uses this and why</h2>
            {caseStudies.length ? (
              <>
                <p className="muted">
                  Every statement quotes its source word for word and links to it. <strong>Confirmed</strong> means the organisation or its own staff
                  say it; <strong>inferred</strong> means it comes from someone else’s account, often the vendor’s customer story.
                </p>
                <div className="case-studies">
                  {caseStudies.map((c) => (
                    <article key={c.id} className="case-study" aria-labelledby={`cs-${c.id}`}>
                      <h3 id={`cs-${c.id}`}>{c.organisation}</h3>
                      <p>{c.summary}</p>
                      <ul className="case-study__claims">
                        {c.claims.map((cl, i) => (
                          <li key={i}>
                            <p className="case-study__claim">
                              <span className={`tag ${cl.kind === "confirmed" ? "tag--done" : ""}`}>{cl.kind === "confirmed" ? "Confirmed" : "Inferred"}</span> {cl.text}
                            </p>
                            <blockquote className="case-study__quote">
                              <p>“{cl.quote}”</p>
                            </blockquote>
                            <p className="small muted">
                              <a href={cl.source_url} rel="noopener noreferrer" target="_blank">
                                {cl.source_title}
                              </a>{" "}
                              — {cl.publisher}
                              {cl.published !== "not stated" ? `, ${formatDate(cl.published)}` : ", date not shown"}. Checked {formatDate(cl.checked_on)}.
                              {cl.note ? ` ${cl.note}` : ""}
                            </p>
                          </li>
                        ))}
                      </ul>
                      <h4 className="case-study__h">What to take from it</h4>
                      <ul>
                        {c.lessons_learned.map((l) => (
                          <li key={l}>{l}</li>
                        ))}
                      </ul>
                      {c.caveat ? <p className="small muted">Keep in mind: {c.caveat}</p> : null}
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <p className="muted">No sourced case study is published for this track yet.</p>
            )}
          </section>

          <section id="alternatives" className="section" aria-labelledby="alternatives-h">
            <h2 id="alternatives-h">Alternatives and how to choose</h2>
            {track.alternatives?.length ? (
              <>
                <p className="muted">
                  No tool is best everywhere, only a better fit for a context. Licences are as stated by each project where we read them
                  {track.alternatives_checked_on ? ` (checked ${formatDate(track.alternatives_checked_on)})` : ""}; check them for your own use.
                </p>
                <ul className="alternatives">
                  {track.alternatives.map((a) => (
                    <li key={a.name} className="alternative">
                      <h3 className="alternative__name">
                        {a.url ? (
                          <a href={a.url} rel="noopener noreferrer" target="_blank">
                            {a.name}
                          </a>
                        ) : (
                          a.name
                        )}{" "}
                        <span className="tag">{a.category}</span>
                      </h3>
                      <dl className="alternative__facts">
                        <dt>Choose it when</dt>
                        <dd>{a.choose_when}</dd>
                        <dt>Look elsewhere when</dt>
                        <dd>{a.avoid_when}</dd>
                        <dt>Licence</dt>
                        <dd>
                          {a.licence_source ? (
                            <a href={a.licence_source} rel="noopener noreferrer" target="_blank">
                              {a.licence}
                            </a>
                          ) : (
                            a.licence
                          )}
                          {a.note ? <span className="muted"> — {a.note}</span> : null}
                        </dd>
                      </dl>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="muted">The comparison with alternatives is still being written.</p>
            )}
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
