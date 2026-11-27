import { useState, type FormEvent } from "react";
import { Crumbs } from "../components/Crumbs.tsx";
import { ErrorState, Loading } from "../components/States.tsx";
import { api, ApiError } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import { Link, useLocation } from "../lib/router.tsx";
import type { PublicQuiz, PublicQuizQuestion, QuizAnswer, QuizGradeResponse, TrackResponse } from "../lib/types.ts";
import { useApi, useTitle } from "../lib/useApi.ts";

const LEVEL_LABEL = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" } as const;

function isAnswered(q: PublicQuizQuestion, a: QuizAnswer | undefined): boolean {
  if (a === undefined) return false;
  switch (q.type) {
    case "single":
    case "output":
      return typeof a === "string";
    case "multiple":
      return Array.isArray(a) && a.length > 0;
    case "ordering":
      return Array.isArray(a) && a.length === q.items.length;
    case "matching":
      return typeof a === "object" && !Array.isArray(a) && q.left.every((l) => a[l.id]);
    case "diagram":
      return typeof a === "object" && !Array.isArray(a) && q.targets.every((t) => a[t.id]);
  }
}

/** One question, in the control that suits its type. Every control works with the keyboard alone. */
function QuestionInput({ q, value, onChange }: { q: PublicQuizQuestion; value: QuizAnswer | undefined; onChange: (v: QuizAnswer) => void }) {
  switch (q.type) {
    case "output":
    case "single":
      return (
        <>
          {q.type === "output" ? (
            <pre className="quiz__output" aria-label="Command and its output">
              <code>{`$ ${q.command}\n${q.output}`}</code>
            </pre>
          ) : null}
          {q.options.map((o) => (
            <label className="option" key={o.id}>
              <input type="radio" name={q.id} value={o.id} checked={value === o.id} onChange={() => onChange(o.id)} />
              <span>{o.text}</span>
            </label>
          ))}
        </>
      );
    case "multiple": {
      const chosen = Array.isArray(value) ? value : [];
      return (
        <>
          <p className="muted quiz__hint">Select all that apply.</p>
          {q.options.map((o) => (
            <label className="option" key={o.id}>
              <input
                type="checkbox"
                name={`${q.id}-${o.id}`}
                checked={chosen.includes(o.id)}
                onChange={(e) => onChange(e.target.checked ? [...chosen, o.id] : chosen.filter((x) => x !== o.id))}
              />
              <span>{o.text}</span>
            </label>
          ))}
        </>
      );
    }
    case "ordering": {
      const order = Array.isArray(value) && value.length === q.items.length ? value : q.items.map((i) => i.id);
      const text = (id: string) => q.items.find((i) => i.id === id)?.text ?? id;
      const move = (from: number, to: number) => {
        const next = [...order];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item ?? "");
        onChange(next);
      };
      return (
        <>
          <p className="muted quiz__hint">Put these in order, first at the top, with the buttons.</p>
          <ol className="quiz__order">
            {order.map((id, n) => (
              <li key={id}>
                <span>{text(id)}</span>
                <span className="quiz__order-buttons">
                  <button type="button" className="btn btn--small" disabled={n === 0} onClick={() => move(n, n - 1)} aria-label={`Move "${text(id)}" up`}>
                    ↑
                  </button>
                  <button type="button" className="btn btn--small" disabled={n === order.length - 1} onClick={() => move(n, n + 1)} aria-label={`Move "${text(id)}" down`}>
                    ↓
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </>
      );
    }
    case "matching":
    case "diagram": {
      const pairs = value && typeof value === "object" && !Array.isArray(value) ? value : {};
      const rows = q.type === "matching" ? q.left : q.targets;
      const choices = q.type === "matching" ? q.right : q.labels;
      return (
        <>
          {q.type === "diagram" ? <div className="quiz__figure" dangerouslySetInnerHTML={{ __html: q.figureHtml }} /> : null}
          <div className="quiz__pairs">
            {rows.map((row) => (
              <div className="field quiz__pair" key={row.id}>
                <label className="field__label" htmlFor={`${q.id}-${row.id}`}>
                  {row.text}
                </label>
                <select id={`${q.id}-${row.id}`} value={pairs[row.id] ?? ""} onChange={(e) => onChange({ ...pairs, [row.id]: e.target.value })}>
                  <option value="">Choose…</option>
                  {choices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.text}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </>
      );
    }
  }
}

export function QuizPage({ trackSlug }: { trackSlug: string }) {
  const quiz = useApi<{ quiz: PublicQuiz }>(`/api/tracks/${trackSlug}/quiz`);
  const track = useApi<TrackResponse>(`/api/tracks/${trackSlug}`, { cache: true });
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [answers, setAnswers] = useState<Record<string, QuizAnswer>>({});
  const [result, setResult] = useState<QuizGradeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useTitle(quiz.data?.quiz.title);

  if (quiz.error) return <div className="page"><ErrorState error={quiz.error} onRetry={quiz.reload} /></div>;
  if (quiz.loading || !quiz.data) return <div className="page"><Loading label="Loading quiz" /></div>;
  const q = quiz.data.quiz;
  const unanswered = q.questions.filter((x) => !isAnswered(x, answers[x.id])).length;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // Ordering questions start in the served order; count an untouched one as answered with that order.
    const filled = { ...answers };
    for (const x of q.questions) if (x.type === "ordering" && !filled[x.id]) filled[x.id] = x.items.map((i) => i.id);
    const missing = q.questions.filter((x) => !isAnswered(x, filled[x.id])).length;
    if (missing > 0) {
      setError(`Answer all ${q.questions.length} questions first (${missing} left).`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await api<QuizGradeResponse>(`/api/tracks/${trackSlug}/quiz/grade`, { method: "POST", body: { answers: filled } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not grade the quiz. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page--narrow">
      <Crumbs items={[{ to: "/tracks", label: "Tracks" }, { to: `/tracks/${trackSlug}`, label: track.data?.summary.shortTitle ?? trackSlug }, { label: "Quiz" }]} />
      <h1>{q.title}</h1>
      <p className="lead">{q.description}</p>
      <p className="muted">
        {q.questions.length} questions · pass mark {Math.round(q.passMark * 100)}% · reviewed {q.lastReviewed}
      </p>
      <form className="check quiz" onSubmit={submit} noValidate aria-label={q.title}>
        {q.questions.map((x, n) => {
          const fb = result?.results.find((r) => r.id === x.id);
          return (
            <fieldset key={x.id} className="quiz__question" aria-describedby={fb ? `fb-${x.id}` : undefined}>
              <legend>
                {n + 1}. {x.prompt} <span className="tag">{LEVEL_LABEL[x.level]}</span>
              </legend>
              <QuestionInput
                q={x}
                value={answers[x.id]}
                onChange={(v) => {
                  setAnswers((a) => ({ ...a, [x.id]: v }));
                  if (result) setResult({ ...result, results: result.results.filter((r) => r.id !== x.id) });
                }}
              />
              {fb ? (
                <div id={`fb-${x.id}`} className={`feedback ${fb.correct ? "feedback--ok" : "feedback--no"}`}>
                  {fb.correct ? (
                    <>
                      <strong>Correct.</strong> {fb.explanation}
                    </>
                  ) : (
                    <>
                      <strong>Not quite.</strong> Revisit{" "}
                      {fb.review ? <Link to={`/tracks/${trackSlug}/lessons/${fb.review.id}`}>{fb.review.title}</Link> : "the lesson"} and try again.
                    </>
                  )}
                </div>
              ) : null}
            </fieldset>
          );
        })}
        <div aria-live="polite">
          {error ? <p className="field__error">{error}</p> : null}
          {result ? (
            <div className={`notice ${result.passed ? "notice--ok" : "notice--warn"}`}>
              <p>
                <strong>
                  {result.correct} of {result.total} correct ({Math.round(result.score * 100)}%) — {result.passed ? "passed" : "not passed yet"}.
                </strong>{" "}
                {result.saved
                  ? result.passed
                    ? "On learning paths this track now shows as skippable."
                    : "Your attempt is saved; revisit the lessons linked above and try again."
                  : user
                    ? null
                    : (
                        <>
                          <Link to={`/login?next=${encodeURIComponent(pathname)}`}>Sign in</Link> to save your result.
                        </>
                      )}
              </p>
            </div>
          ) : unanswered > 0 && Object.keys(answers).length > 0 ? (
            <p className="muted">{unanswered} question(s) left.</p>
          ) : null}
        </div>
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? "Grading…" : result ? "Grade again" : "Grade my answers"}
        </button>
      </form>
    </div>
  );
}
