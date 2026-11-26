import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookmarkButton } from "../components/BookmarkButton.tsx";
import { Crumbs } from "../components/Crumbs.tsx";
import { SelfCheck } from "../components/SelfCheck.tsx";
import { StepDiagram } from "../components/StepDiagram.tsx";
import { LazySimulation } from "../simulations/LazySimulation.tsx";
import { ErrorState, Loading, NotFoundState } from "../components/States.tsx";
import { LevelTag } from "../components/Tags.tsx";
import { api } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import { formatDate } from "../lib/format.ts";
import { ArticleBody, useArticleClick } from "../lib/article.tsx";
import { Link } from "../lib/router.tsx";
import type { LessonResponse } from "../lib/types.ts";
import { useApi, useTitle } from "../lib/useApi.ts";
import { useScrollSpy } from "../lib/useScrollSpy.ts";
import { ResourceItem } from "./Track.tsx";

export function LessonPage({ trackSlug, lessonId }: { trackSlug: string; lessonId: string }) {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi<LessonResponse>(`/api/lessons/${encodeURIComponent(lessonId)}`, { cache: true });
  const [announce, setAnnounce] = useState("");
  const started = useRef<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [diagrams, setDiagrams] = useState<HTMLElement[]>([]);
  const [simulations, setSimulations] = useState<HTMLElement[]>([]);
  useTitle(data?.lesson.title);
  const tocIds = data?.lesson.toc.map((t) => t.id) ?? [];
  const active = useScrollSpy(tocIds, Boolean(data));

  // Record "in progress" for signed-in learners (for "continue learning"; never counted as completion).
  useEffect(() => {
    if (!user || !data || started.current === data.lesson.id) return;
    started.current = data.lesson.id;
    api(`/api/lessons/${data.lesson.id}/start`, { method: "POST" }).catch(() => undefined);
  }, [user, data]);

  // Step-through diagrams arrive as static HTML; give each one its controls.
  const loadedLessonId = data?.lesson.id;
  useEffect(() => {
    setDiagrams(Array.from(bodyRef.current?.querySelectorAll<HTMLElement>("[data-step-diagram]") ?? []));
    const sims = Array.from(bodyRef.current?.querySelectorAll<HTMLElement>("[data-simulation]") ?? []);
    for (const el of sims) el.dataset.enhanced = "true";
    setSimulations(sims);
  }, [loadedLessonId]);

  const onArticleClick = useArticleClick(setAnnounce);

  if (error) return <div className="page"><ErrorState error={error} onRetry={reload} /></div>;
  if (loading || !data) return <div className="page"><Loading label="Loading lesson" /></div>;
  const { lesson, track } = data;
  if (lesson.track !== trackSlug) return <div className="page"><NotFoundState /></div>;

  return (
    <div className="page">
      <Crumbs
        items={[
          { label: "Tracks", to: "/tracks" },
          { label: track?.shortTitle ?? lesson.track, to: `/tracks/${lesson.track}` },
          { label: lesson.title },
        ]}
      />
      <div className="doc">
        <nav className="doc__aside" aria-label="Lesson contents">
          <h2>In this lesson</h2>
          <ul>
            {lesson.toc.map((t) => (
              <li key={t.id}>
                <a href={`#${t.id}`} aria-current={active === t.id ? "true" : undefined}>
                  {t.text}
                </a>
              </li>
            ))}
            <li>
              <a href="#check-title">Check your understanding</a>
            </li>
          </ul>
        </nav>

        <div>
          <header style={{ maxWidth: "var(--measure)" }}>
            <h1>{lesson.title}</h1>
            <div className="tags" style={{ marginBottom: "var(--space-5)", alignItems: "center" }}>
              <LevelTag level={lesson.level} />
              <span className="tag">{lesson.estimatedMinutes} min</span>
              <span className="small faint">Reviewed {formatDate(lesson.lastReviewed)}</span>
              <BookmarkButton type="lesson" id={lesson.id} />
            </div>
          </header>

          <p className={`verified verified--${lesson.verification.method}`}>
            <strong>
              {lesson.verification.method === "executed"
                ? "Tested commands."
                : lesson.verification.method === "pending"
                  ? "Automated test pending."
                  : "Checked against official documentation."}
            </strong>{" "}
            {lesson.verification.details}
          </p>

          <section className="objectives" aria-labelledby="objectives-h">
            <h2 id="objectives-h">By the end you will be able to</h2>
            <ul>
              {lesson.learningObjectives.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          </section>

          <div ref={bodyRef}>
            <ArticleBody html={lesson.html} onClick={onArticleClick} />
          </div>
          {diagrams.map((root) => {
            const slot = root.querySelector("[data-controls]");
            return slot ? createPortal(<StepDiagram root={root} />, slot, root.id) : null;
          })}
          {simulations.map((el) =>
            createPortal(<LazySimulation id={el.dataset.simulation ?? ""} scenario={el.dataset.scenario ?? null} headingLevel={3} embedded />, el, `sim-${el.dataset.simulation}`),
          )}
          <p className="sr-only" aria-live="polite">
            {announce}
          </p>

          <SelfCheck lesson={lesson} />

          {lesson.resources.length ? (
            <section className="section" style={{ maxWidth: "var(--measure)" }} aria-labelledby="lesson-res-h">
              <h2 id="lesson-res-h">Resources</h2>
              {lesson.resources.map((r) => (
                <ResourceItem key={r.url} r={r} />
              ))}
            </section>
          ) : null}

          <nav className="pager" aria-label="Lesson navigation">
            {lesson.previous ? (
              <Link to={`/tracks/${lesson.track}/lessons/${lesson.previous.id}`}>
                <small>Previous lesson</small>
                {lesson.previous.title}
              </Link>
            ) : (
              <Link to={`/tracks/${lesson.track}`}>
                <small>Back to track</small>
                {track?.shortTitle}
              </Link>
            )}
            {lesson.next ? (
              <Link to={`/tracks/${lesson.track}/lessons/${lesson.next.id}`}>
                <small>Next lesson</small>
                {lesson.next.title}
              </Link>
            ) : (
              <Link to={`/tracks/${lesson.track}#curriculum`}>
                <small>End of published lessons</small>
                See the full curriculum
              </Link>
            )}
          </nav>
        </div>
      </div>
    </div>
  );
}
