import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Crumbs } from "../components/Crumbs.tsx";
import { ErrorState, Loading, NotFoundState } from "../components/States.tsx";
import { StepDiagram } from "../components/StepDiagram.tsx";
import { LevelTag } from "../components/Tags.tsx";
import { api, ApiError } from "../lib/api.ts";
import { ArticleBody, useArticleClick } from "../lib/article.tsx";
import { useAuth } from "../lib/auth.tsx";
import { formatDate } from "../lib/format.ts";
import { Link, useLocation } from "../lib/router.tsx";
import type { LabCompleteResponse, LabMode, LabProgress, LabResponse, PublicLab } from "../lib/types.ts";
import { useApi, useTitle } from "../lib/useApi.ts";
import { useScrollSpy } from "../lib/useScrollSpy.ts";
import { LazySimulation } from "../simulations/LazySimulation.tsx";
import { ResourceItem } from "./Track.tsx";

export const LAB_MODE_LABEL: Record<LabMode, string> = {
  local: "On your machine",
  simulation: "In the browser (simulation)",
  "read-through": "Read and interpret",
};

export function LabPage({ trackSlug, labId }: { trackSlug: string; labId: string }) {
  const { data, error, loading, reload } = useApi<LabResponse>(`/api/labs/${encodeURIComponent(labId)}`);
  const [announce, setAnnounce] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const [diagrams, setDiagrams] = useState<HTMLElement[]>([]);
  const [simulations, setSimulations] = useState<HTMLElement[]>([]);
  useTitle(data?.lab.title);
  const active = useScrollSpy(data?.lab.toc.map((t) => t.id) ?? [], Boolean(data));
  const onArticleClick = useArticleClick(setAnnounce);

  const loadedId = data?.lab.id;
  useEffect(() => {
    setDiagrams(Array.from(bodyRef.current?.querySelectorAll<HTMLElement>("[data-step-diagram]") ?? []));
    const sims = Array.from(bodyRef.current?.querySelectorAll<HTMLElement>("[data-simulation]") ?? []);
    for (const el of sims) el.dataset.enhanced = "true";
    setSimulations(sims);
  }, [loadedId]);

  if (error) return <div className="page"><ErrorState error={error} onRetry={reload} /></div>;
  if (loading || !data) return <div className="page"><Loading label="Loading lab" /></div>;
  const { lab, track } = data;
  if (lab.track !== trackSlug) return <div className="page"><NotFoundState /></div>;

  return (
    <div className="page">
      <Crumbs
        items={[
          { label: "Tracks", to: "/tracks" },
          { label: track?.shortTitle ?? lab.track, to: `/tracks/${lab.track}` },
          { label: "Labs", to: `/tracks/${lab.track}#practice` },
          { label: lab.title },
        ]}
      />
      <div className="doc">
        <nav className="doc__aside" aria-label="Lab contents">
          <h2>In this lab</h2>
          <ul>
            {lab.toc.map((t) => (
              <li key={t.id}>
                <a href={`#${t.id}`} aria-current={active === t.id ? "true" : undefined}>
                  {t.text}
                </a>
              </li>
            ))}
            <li>
              <a href="#lab-done-h">Finish the lab</a>
            </li>
          </ul>
        </nav>

        <div>
          <header style={{ maxWidth: "var(--measure)" }}>
            <p className="small faint">Lab</p>
            <h1>{lab.title}</h1>
            <div className="tags" style={{ marginBottom: "var(--space-5)", alignItems: "center" }}>
              <LevelTag level={lab.level} />
              <span className="tag">{LAB_MODE_LABEL[lab.mode]}</span>
              <span className="tag">{lab.estimatedMinutes} min</span>
              <span className="small faint">Reviewed {formatDate(lab.lastReviewed)}</span>
            </div>
          </header>

          <p className={`verified verified--${lab.verification.method}`}>
            <strong>
              {lab.verification.method === "executed"
                ? "Tested steps."
                : lab.verification.method === "pending"
                  ? "Automated test pending."
                  : "Checked against official documentation."}
            </strong>{" "}
            {lab.verification.details}
          </p>

          <section className="objectives" aria-labelledby="lab-objectives-h">
            <h2 id="lab-objectives-h">You will</h2>
            <ul>
              {lab.objectives.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
            {lab.prerequisites.length ? (
              <p className="small">
                Finish these lessons first:{" "}
                {lab.prerequisites.map((p, i) => (
                  <span key={p.id}>
                    {i ? ", " : ""}
                    <Link to={`/tracks/${p.track}/lessons/${p.id}`}>{p.title}</Link>
                  </span>
                ))}
                .
              </p>
            ) : null}
          </section>

          <div ref={bodyRef}>
            <ArticleBody html={lab.html} onClick={onArticleClick} />
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

          <LabCompletion lab={lab} initial={data.progress} challengesDone={data.challengesDone} onChange={reload} />

          {lab.resources.length ? (
            <section className="section" style={{ maxWidth: "var(--measure)" }} aria-labelledby="lab-res-h">
              <h2 id="lab-res-h">Resources</h2>
              {lab.resources.map((r) => (
                <ResourceItem key={r.url} r={r} />
              ))}
            </section>
          ) : null}

          <nav className="pager" aria-label="Lab navigation">
            <Link to={`/tracks/${lab.track}#practice`}>
              <small>Back to the track</small>
              All {track?.shortTitle ?? lab.track} labs
            </Link>
          </nav>
        </div>
      </div>
    </div>
  );
}

/**
 * How a lab is finished depends on its mode, and the UI says how completion
 * is established: ticking checkpoints is self-reported; simulation
 * challenges and read-through answers are checked by the server.
 */
function LabCompletion({ lab, initial, challengesDone, onChange }: { lab: PublicLab; initial: LabProgress | null; challengesDone: string[]; onChange: () => void }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<LabCompleteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const progress = result?.progress ?? initial;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (lab.mode === "local" && ticked.size < lab.checkpoints.length) {
      setError(`Tick every checkpoint once you have seen it (${lab.checkpoints.length - ticked.size} left).`);
      return;
    }
    if (lab.mode === "read-through" && lab.questions.some((q) => !answers[q.id])) {
      setError("Answer every question first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = lab.mode === "local" ? { checkpoints: [...ticked] } : lab.mode === "read-through" ? { answers } : {};
      const r = await api<LabCompleteResponse>(`/api/labs/${lab.id}/complete`, { method: "POST", body });
      setResult(r);
      if (r.completed) onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record the lab. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const signIn = (
    <p className="small">
      <Link to={`/login?next=${encodeURIComponent(pathname)}`}>Sign in</Link> or <Link to={`/register?next=${encodeURIComponent(pathname)}`}>create an account</Link> to record
      finished labs.
    </p>
  );

  return (
    <form className="check" onSubmit={submit} aria-labelledby="lab-done-h" noValidate>
      <h2 id="lab-done-h">Finish the lab</h2>
      {progress ? (
        <div className="notice notice--ok" role="status">
          <p>
            <strong>Lab complete</strong> ({progress.evidence === "verified" ? "checked by DevForge" : "self-reported"}), {formatDate(progress.completedAt)}.{" "}
            <Link to="/dashboard">See your progress</Link>
          </p>
        </div>
      ) : null}

      {progress ? null : lab.mode === "local" ? (
        <>
          <p className="muted">
            Run the check script above; when it passes, tick what you saw. DevForge cannot see your machine, so a local lab is recorded as{" "}
            <strong>self-reported</strong>.
          </p>
          <fieldset>
            <legend>Checkpoints</legend>
            {lab.checkpoints.map((c) => (
              <label className="option" key={c.id}>
                <input
                  type="checkbox"
                  checked={ticked.has(c.id)}
                  onChange={(e) =>
                    setTicked((t) => {
                      const next = new Set(t);
                      if (e.target.checked) next.add(c.id);
                      else next.delete(c.id);
                      return next;
                    })
                  }
                />
                <span>{c.text}</span>
              </label>
            ))}
          </fieldset>
        </>
      ) : null}

      {!progress && lab.mode === "simulation" && lab.simulation ? (
        <>
          <p className="muted">Complete these challenges in the simulation above. The server replays your actions to check each one.</p>
          <ul className="lab-challenges">
            {lab.simulation.challenges.map((c) => {
              const done = challengesDone.includes(c.id);
              return (
                <li key={c.id}>
                  <span className={`tag ${done ? "tag--done" : ""}`}>{done ? "Done" : "To do"}</span> {c.title}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {!progress && lab.mode === "read-through"
        ? lab.questions.map((q, qi) => {
            const fb = result?.grade?.results.find((r) => r.id === q.id);
            return (
              <fieldset key={q.id} aria-describedby={fb ? `labfb-${q.id}` : undefined}>
                <legend>
                  {qi + 1}. {q.prompt}
                </legend>
                {q.options.map((o) => (
                  <label className="option" key={o.id}>
                    <input type="radio" name={`lab-${q.id}`} value={o.id} checked={answers[q.id] === o.id} onChange={() => setAnswers((a) => ({ ...a, [q.id]: o.id }))} />
                    <span>{o.text}</span>
                  </label>
                ))}
                {fb ? (
                  <div id={`labfb-${q.id}`} className={`feedback ${fb.correct ? "feedback--ok" : "feedback--no"}`}>
                    {fb.correct ? (
                      <>
                        <strong>Correct.</strong> {fb.explanation}
                      </>
                    ) : (
                      <>
                        <strong>Not quite.</strong> Look at the output again and choose again.
                      </>
                    )}
                  </div>
                ) : null}
              </fieldset>
            );
          })
        : null}

      <div aria-live="polite">
        {error ? <p className="field__error">{error}</p> : null}
        {result && !result.completed && result.grade ? (
          <p>
            {result.grade.correct} of {result.grade.total} correct.
          </p>
        ) : null}
      </div>
      {progress ? null : user ? (
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? "Recording…" : lab.mode === "read-through" ? "Check answers" : lab.mode === "simulation" ? "Record the lab as done" : "Mark the lab as done"}
        </button>
      ) : (
        signIn
      )}
    </form>
  );
}
