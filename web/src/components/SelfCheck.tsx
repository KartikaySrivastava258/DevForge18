import { useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import { Link, useLocation } from "../lib/router.tsx";
import type { CheckResponse, PublicLesson } from "../lib/types.ts";

export function SelfCheck({ lesson, onCompleted }: { lesson: PublicLesson; onCompleted?: () => void }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<CheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const unanswered = lesson.selfCheck.filter((q) => !answers[q.id]).length;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (unanswered > 0) {
      setError(`Answer all ${lesson.selfCheck.length} questions first (${unanswered} left).`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api<CheckResponse>(`/api/lessons/${lesson.id}/check`, { method: "POST", body: { answers } });
      setResult(r);
      if (r.passed && r.saved) onCompleted?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not check your answers. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const feedbackFor = (id: string) => result?.results.find((r) => r.id === id);

  return (
    <form className="check" onSubmit={submit} aria-labelledby="check-title" noValidate>
      <h2 id="check-title">Check your understanding</h2>
      <p className="muted">
        Answer every question. The lesson counts as complete only when all answers are right. A wrong answer shows no hint, so
        re-read the relevant section and try again.
      </p>
      {lesson.selfCheck.map((q, qi) => {
        const fb = feedbackFor(q.id);
        return (
          <fieldset key={q.id} aria-describedby={fb ? `fb-${q.id}` : undefined}>
            <legend>
              {qi + 1}. {q.prompt}
            </legend>
            {q.options.map((o) => (
              <label className="option" key={o.id}>
                <input
                  type="radio"
                  name={q.id}
                  value={o.id}
                  checked={answers[q.id] === o.id}
                  onChange={() => {
                    setAnswers((a) => ({ ...a, [q.id]: o.id }));
                    if (result) setResult({ ...result, results: result.results.filter((r) => r.id !== q.id) });
                  }}
                />
                <span>{o.text}</span>
              </label>
            ))}
            {fb ? (
              <div id={`fb-${q.id}`} className={`feedback ${fb.correct ? "feedback--ok" : "feedback--no"}`}>
                {fb.correct ? (
                  <>
                    <strong>Correct.</strong> {fb.explanation}
                  </>
                ) : (
                  <>
                    <strong>Not quite.</strong> Revisit the lesson and choose again.
                  </>
                )}
              </div>
            ) : null}
          </fieldset>
        );
      })}

      <div aria-live="polite">
        {error ? <p className="field__error">{error}</p> : null}
        {result?.passed ? (
          <div className="notice notice--ok">
            {result.saved ? (
              <p>
                <strong>Lesson complete.</strong> It now counts towards your progress.{" "}
                <Link to="/dashboard">See your progress</Link>
              </p>
            ) : (
              <p>
                <strong>All correct.</strong> <Link to={`/login?next=${encodeURIComponent(pathname)}`}>Sign in</Link> or{" "}
                <Link to={`/register?next=${encodeURIComponent(pathname)}`}>create an account</Link> to record completed lessons.
              </p>
            )}
          </div>
        ) : result ? (
          <p>
            {result.correct} of {result.total} correct. {user ? "Your best score is saved." : ""}
          </p>
        ) : null}
      </div>
      <button type="submit" className="btn btn--primary" disabled={busy}>
        {busy ? "Checking…" : result ? "Check again" : "Check answers"}
      </button>
    </form>
  );
}
