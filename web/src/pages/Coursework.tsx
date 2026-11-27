/**
 * Institutional pages (REMAINING_WORK.md §6.3): cohorts and assignments, faculty review against rubrics,
 * submissions, opt-in public portfolios and verifiable certificates — plus the panels other pages embed.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Crumbs } from "../components/Crumbs.tsx";
import { ErrorState, Loading } from "../components/States.tsx";
import { api, ApiError } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import { formatDate } from "../lib/format.ts";
import { Link, navigate, useLocation } from "../lib/router.tsx";
import { useApi, useTitle } from "../lib/useApi.ts";

// ---- Types (API shapes from server/src/routes/institution.ts) ----------------------------------------------

type Kind = "lesson" | "lab" | "quiz" | "project" | "capstone" | "architecture";
interface ItemRef { title: string; track: string | null; href: string | null }
interface Status { state: "not_started" | "in_progress" | "done"; completedAt: string | null; detail: string | null; late: boolean }
interface Assignment { id: string; kind: Kind; itemId: string; instructions: string; dueAt: string; item: ItemRef; status?: Status; cohort?: { id: string; name: string } }
interface CohortSummary { id: string; name: string; description: string; role: "learner" | "faculty"; learners: number; assignments: number; joinCode?: string }
interface LearnerRow { userId: string; name: string; email: string; joinedAt: string; lessonsCompleted: number; labsVerified: number; quizzesPassed: number; assignments: (Status & { assignmentId: string })[] }
interface CohortDetail {
  cohort: { id: string; name: string; description: string; role: "learner" | "faculty"; joinCode?: string };
  assignments: Assignment[];
  learners?: LearnerRow[];
  faculty?: { userId: string; name: string }[];
}
interface Review { id: string; scores: Record<string, string>; feedback: string; outcome: "accepted" | "changes_requested"; reviewer: string | null; createdAt: string }
interface Submission { id: string; kind: "project" | "capstone"; itemId: string; repositoryUrl: string; notes: string; status: "submitted" | "accepted" | "changes_requested"; submittedAt: string; review: Review | null }
interface RubricRow { criterion: string; excellent: string; good: string; needs_work: string }
interface QueueItem { type: "submission" | "decision"; id: string; kind: string; learner: string; item: ItemRef | null; updatedAt: string; reviewed: boolean; outcome: string | null }

const KIND_LABEL: Record<Kind, string> = { lesson: "Lesson", lab: "Lab", quiz: "Quiz", project: "Mini-project", capstone: "Capstone", architecture: "Decision record" };
const LEVEL_LABEL = { excellent: "Excellent", good: "Good", needs_work: "Needs work" } as const;
const OUTCOME_LABEL = { accepted: "Accepted", changes_requested: "Changes requested", submitted: "Waiting for review" } as const;

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong. Try again.");
const formatDateTime = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function StatusTag({ status, dueAt }: { status: Status; dueAt: string }) {
  if (status.state === "done") {
    return <span className="tag tag--done">{status.late ? "Done late" : "Done"}{status.detail && status.detail !== "passed" ? ` · ${status.detail}` : ""}</span>;
  }
  const overdue = new Date(dueAt).getTime() < Date.now();
  const label = status.state === "in_progress" ? `In progress${status.detail ? ` · ${status.detail}` : ""}` : "Not started";
  return <span className={`tag${overdue ? " tag--advanced" : ""}`}>{overdue ? `${label} · overdue` : label}</span>;
}

/** Redirect anonymous visitors to sign in; render children once the user is known. */
function SignedIn({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  useEffect(() => {
    if (user === null) navigate(`/login?next=${encodeURIComponent(pathname)}`, { replace: true });
  }, [user, pathname]);
  if (!user) return <div className="page"><Loading /></div>;
  return <>{children}</>;
}

// ---- Cohorts -------------------------------------------------------------------------------------------

function JoinCohortForm({ onJoined }: { onJoined: () => void }) {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<{ cohort: { id: string; name: string } }>("/api/cohorts/join", { method: "POST", body: { code } });
      setCode("");
      onJoined();
      navigate(`/cohorts/${r.cohort.id}`);
    } catch (err) {
      setMessage(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="inline-form" aria-labelledby="join-h">
      <h2 id="join-h">Join a cohort</h2>
      <p className="muted small" id="join-privacy">
        The teachers of a cohort you join can see your name, e-mail address and progress (lessons, labs, quizzes and the work you submit). You can leave at any time.
      </p>
      <div className="field">
        <label htmlFor="join-code">Code from your teacher</label>
        <input id="join-code" className="input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} maxLength={10} aria-describedby="join-privacy" required />
      </div>
      <button className="btn btn--primary" disabled={busy || code.trim().length !== 10}>Join</button>
      <p role="status" className="field__error">{message}</p>
    </form>
  );
}

function CreateCohortForm() {
  const [form, setForm] = useState({ name: "", description: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<{ cohort: { id: string } }>("/api/cohorts", { method: "POST", body: form });
      navigate(`/cohorts/${r.cohort.id}`);
    } catch (err) {
      setMessage(errorText(err));
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} aria-labelledby="create-h">
      <h2 id="create-h">Create a cohort</h2>
      <div className="field">
        <label htmlFor="cohort-name">Name</label>
        <input id="cohort-name" className="input" value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
      </div>
      <div className="field">
        <label htmlFor="cohort-description">Description (optional)</label>
        <textarea id="cohort-description" className="input textarea" rows={3} value={form.description} maxLength={2000} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </div>
      <button className="btn btn--primary" disabled={busy || form.name.trim().length < 3}>Create cohort</button>
      <p role="status" className="field__error">{message}</p>
    </form>
  );
}

export function CohortsPage() {
  useTitle("Cohorts");
  return (
    <SignedIn>
      <CohortsContent />
    </SignedIn>
  );
}

function CohortsContent() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi<{ cohorts: CohortSummary[] }>("/api/cohorts");
  const staff = user?.role === "faculty" || user?.role === "admin";
  return (
    <div className="page page--narrow">
      <Crumbs items={[{ label: "Cohorts" }]} />
      <h1>Cohorts</h1>
      <p className="lede">A cohort is a class: its teachers set assignments with due dates and review the work you submit.</p>
      {error ? <ErrorState error={error} onRetry={reload} /> : loading || !data ? <Loading /> : data.cohorts.length === 0 ? (
        <p className="muted">You are not in a cohort yet.</p>
      ) : (
        <ul className="capstone-list">
          {data.cohorts.map((c) => (
            <li key={c.id}>
              <h2>
                <Link to={`/cohorts/${c.id}`}>{c.name}</Link>
              </h2>
              {c.description ? <p>{c.description}</p> : null}
              <p className="muted small">
                {c.role === "faculty" ? `You teach this cohort · ${c.learners} learners` : "You are a learner"} · {c.assignments} assignments
              </p>
            </li>
          ))}
        </ul>
      )}
      <div className="split" style={{ alignItems: "start" }}>
        <JoinCohortForm onJoined={reload} />
        {staff ? <CreateCohortForm /> : null}
      </div>
      {staff ? (
        <p>
          <Link to="/reviews">Work waiting for your review</Link>
        </p>
      ) : null}
    </div>
  );
}

function AddAssignmentForm({ cohortId, onAdded }: { cohortId: string; onAdded: () => void }) {
  const { data } = useApi<{ items: { kind: Kind; id: string; title: string; track: string | null }[] }>("/api/assignable", { cache: true });
  const [kind, setKind] = useState<Kind>("lesson");
  const [itemId, setItemId] = useState("");
  const [due, setDue] = useState("");
  const [instructions, setInstructions] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const items = (data?.items ?? []).filter((i) => i.kind === kind);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    try {
      // The browser gives local date-time without an offset; send it as an absolute instant.
      await api(`/api/cohorts/${cohortId}/assignments`, { method: "POST", body: { kind, itemId, dueAt: new Date(due).toISOString(), instructions } });
      setItemId("");
      setInstructions("");
      setMessage("Assignment added.");
      onAdded();
    } catch (err) {
      setMessage(errorText(err));
    }
  };
  return (
    <form onSubmit={submit} aria-labelledby="assign-h" className="section">
      <h3 id="assign-h">Add an assignment</h3>
      <div className="field">
        <label htmlFor="assign-kind">Type</label>
        <select id="assign-kind" className="select" value={kind} onChange={(e) => { setKind(e.target.value as Kind); setItemId(""); }}>
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="assign-item">Item</label>
        <select id="assign-item" className="select" value={itemId} onChange={(e) => setItemId(e.target.value)} required>
          <option value="">Choose…</option>
          {items.map((i) => <option key={i.id} value={i.id}>{i.track ? `${i.track} · ` : ""}{i.title}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="assign-due">Due (your local time)</label>
        <input id="assign-due" className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="assign-instructions">Instructions (optional)</label>
        <textarea id="assign-instructions" className="input textarea" rows={3} maxLength={4000} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      </div>
      <button className="btn btn--primary" disabled={!itemId || !due}>Add assignment</button>
      <p role="status" className="small">{message}</p>
    </form>
  );
}

export function CohortPage({ id }: { id: string }) {
  return (
    <SignedIn>
      <CohortContent id={id} />
    </SignedIn>
  );
}

function CohortContent({ id }: { id: string }) {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi<CohortDetail>(`/api/cohorts/${encodeURIComponent(id)}`);
  const [message, setMessage] = useState<string | null>(null);
  useTitle(data?.cohort.name ?? "Cohort");
  if (error) return <div className="page"><ErrorState error={error} onRetry={reload} /></div>;
  if (loading || !data) return <div className="page"><Loading label="Loading the cohort" /></div>;
  const c = data.cohort;
  const leave = async () => {
    if (!user || !window.confirm(`Leave ${c.name}? Its teachers will no longer see your progress.`)) return;
    try {
      await api(`/api/cohorts/${c.id}/members/${user.id}`, { method: "DELETE" });
      navigate("/cohorts");
    } catch (err) {
      setMessage(errorText(err));
    }
  };
  return (
    <div className="page">
      <Crumbs items={[{ to: "/cohorts", label: "Cohorts" }, { label: c.name }]} />
      <h1>{c.name}</h1>
      {c.description ? <p className="lede">{c.description}</p> : null}
      {c.role === "faculty" ? <FacultyCohort data={data} reload={reload} /> : (
        <>
          <h2>Assignments</h2>
          <AssignmentTable assignments={data.assignments} />
          <p>
            <button type="button" className="btn btn--small" onClick={leave}>Leave this cohort</button>
          </p>
        </>
      )}
      <p role="status" className="field__error">{message}</p>
    </div>
  );
}

function AssignmentTable({ assignments, showCohort = false }: { assignments: Assignment[]; showCohort?: boolean }) {
  if (assignments.length === 0) return <p className="muted">No assignments yet.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Assignment</th>
            {showCohort ? <th scope="col">Cohort</th> : null}
            <th scope="col">Due</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {assignments.map((a) => (
            <tr key={a.id}>
              <th scope="row">
                <span className="small faint">{KIND_LABEL[a.kind]}</span>{" "}
                {a.item.href ? <Link to={a.item.href}>{a.item.title}</Link> : a.item.title}
                {a.instructions ? <p className="small muted">{a.instructions}</p> : null}
              </th>
              {showCohort && a.cohort ? <td><Link to={`/cohorts/${a.cohort.id}`}>{a.cohort.name}</Link></td> : null}
              <td><time dateTime={a.dueAt}>{formatDateTime(a.dueAt)}</time></td>
              <td>{a.status ? <StatusTag status={a.status} dueAt={a.dueAt} /> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FacultyCohort({ data, reload }: { data: CohortDetail; reload: () => void }) {
  const c = data.cohort;
  const [code, setCode] = useState(c.joinCode ?? "");
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => setCode(c.joinCode ?? ""), [c.joinCode]);
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setMessage(null);
    try {
      await fn();
      setMessage(done);
      reload();
    } catch (err) {
      setMessage(errorText(err));
    }
  };
  const learners = data.learners ?? [];
  return (
    <>
      <section className="notice" aria-labelledby="code-h">
        <h2 id="code-h" className="h-small">Join code</h2>
        <p>
          Give learners this code: <code className="join-code">{code}</code>{" "}
          <button type="button" className="btn btn--small" onClick={() => act(async () => setCode((await api<{ joinCode: string }>(`/api/cohorts/${c.id}/code`, { method: "POST" })).joinCode), "New code created; the old one no longer works.")}>
            New code
          </button>
        </p>
        <p className="small muted">Teachers: {(data.faculty ?? []).map((f) => f.name).join(", ")}. Another teacher joins with the same code.</p>
      </section>

      <h2>Learners ({learners.length})</h2>
      {learners.length === 0 ? <p className="muted">Nobody has joined yet.</p> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Learner</th>
                <th scope="col">Lessons completed</th>
                <th scope="col">Labs verified</th>
                <th scope="col">Quizzes passed</th>
                <th scope="col">Assignments done</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {learners.map((l) => {
                const done = l.assignments.filter((s) => s.state === "done").length;
                const late = l.assignments.filter((s) => s.state === "done" && s.late).length;
                return (
                  <tr key={l.userId}>
                    <th scope="row">{l.name}<br /><span className="small faint">{l.email}</span></th>
                    <td>{l.lessonsCompleted}</td>
                    <td>{l.labsVerified}</td>
                    <td>{l.quizzesPassed}</td>
                    <td>{done} of {l.assignments.length}{late ? ` (${late} late)` : ""}</td>
                    <td>
                      <button type="button" className="btn btn--small btn--ghost" onClick={() => window.confirm(`Remove ${l.name} from ${c.name}?`) && act(() => api(`/api/cohorts/${c.id}/members/${l.userId}`, { method: "DELETE" }), `${l.name} removed.`)}>
                        Remove<span className="sr-only"> {l.name}</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2>Assignments</h2>
      {data.assignments.length === 0 ? <p className="muted">No assignments yet.</p> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Assignment</th>
                <th scope="col">Due</th>
                <th scope="col">Done</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {data.assignments.map((a) => {
                const done = learners.filter((l) => l.assignments.find((s) => s.assignmentId === a.id)?.state === "done").length;
                return (
                  <tr key={a.id}>
                    <th scope="row"><span className="small faint">{KIND_LABEL[a.kind]}</span> {a.item.href ? <Link to={a.item.href}>{a.item.title}</Link> : a.item.title}</th>
                    <td><time dateTime={a.dueAt}>{formatDateTime(a.dueAt)}</time></td>
                    <td>{done} of {learners.length}</td>
                    <td>
                      <button type="button" className="btn btn--small btn--ghost" onClick={() => window.confirm(`Delete the assignment "${a.item.title}"?`) && act(() => api(`/api/cohorts/${c.id}/assignments/${a.id}`, { method: "DELETE" }), "Assignment deleted.")}>
                        Delete<span className="sr-only"> {a.item.title}</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <AddAssignmentForm cohortId={c.id} onAdded={reload} />
      <p role="status" className="small">{message}</p>
      <p>
        <Link to="/reviews">Work waiting for your review</Link>
      </p>
    </>
  );
}

// ---- Reviews -------------------------------------------------------------------------------------------

export function ReviewsPage() {
  useTitle("Reviews");
  return (
    <SignedIn>
      <ReviewsContent />
    </SignedIn>
  );
}

function ReviewsContent() {
  const { data, error, loading, reload } = useApi<{ items: QueueItem[] }>("/api/reviews");
  if (error) return <div className="page"><ErrorState error={error} onRetry={reload} /></div>;
  if (loading || !data) return <div className="page"><Loading label="Loading submitted work" /></div>;
  const waiting = data.items.filter((i) => !i.reviewed);
  const done = data.items.filter((i) => i.reviewed);
  const table = (items: QueueItem[]) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Work</th>
            <th scope="col">Learner</th>
            <th scope="col">Submitted</th>
            <th scope="col">State</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={`${i.type}:${i.id}`}>
              <th scope="row">
                <span className="small faint">{KIND_LABEL[i.kind as Kind] ?? i.kind}</span>{" "}
                <Link to={`/reviews/${i.type}/${i.id}`}>{i.item?.title ?? "Unavailable item"}</Link>
              </th>
              <td>{i.learner}</td>
              <td><time dateTime={i.updatedAt}>{formatDateTime(i.updatedAt)}</time></td>
              <td>{i.reviewed ? <span className="tag tag--done">{OUTCOME_LABEL[i.outcome as "accepted"] ?? "Reviewed"}</span> : <span className="tag">Waiting</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="page">
      <Crumbs items={[{ to: "/cohorts", label: "Cohorts" }, { label: "Reviews" }]} />
      <h1>Reviews</h1>
      <p className="lede">Projects, capstones and architecture decision records submitted by learners in the cohorts you teach.</p>
      <h2>Waiting for review ({waiting.length})</h2>
      {waiting.length ? table(waiting) : <p className="muted">Nothing is waiting.</p>}
      <h2>Reviewed</h2>
      {done.length ? table(done) : <p className="muted">No reviews yet.</p>}
    </div>
  );
}

export function ReviewPage({ type, id }: { type: string; id: string }) {
  return (
    <SignedIn>
      <ReviewContent type={type} id={id} />
    </SignedIn>
  );
}

interface ReviewTarget {
  target: { type: "submission" | "decision"; id: string; kind: string; learner: string; item: ItemRef | null; updatedAt: string; work: Record<string, string> };
  rubric: RubricRow[];
  reviews: Review[];
}

function ReviewContent({ type, id }: { type: string; id: string }) {
  const { data, error, loading, reload } = useApi<ReviewTarget>(`/api/reviews/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useTitle(data ? `Review: ${data.target.item?.title ?? "work"}` : "Review");
  if (error) return <div className="page"><ErrorState error={error} onRetry={reload} /></div>;
  if (loading || !data) return <div className="page"><Loading label="Loading the work" /></div>;
  const t = data.target;
  const complete = data.rubric.every((r) => scores[r.criterion]);
  const send = async (outcome: "accepted" | "changes_requested") => {
    setBusy(true);
    setMessage(null);
    try {
      await api(`/api/reviews/${t.type}/${t.id}`, { method: "POST", body: { scores, feedback, outcome } });
      setScores({});
      setFeedback("");
      setMessage(outcome === "accepted" ? "Review saved: accepted." : "Review saved: changes requested.");
      reload();
    } catch (err) {
      setMessage(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page page--narrow">
      <Crumbs items={[{ to: "/reviews", label: "Reviews" }, { label: t.item?.title ?? "Work" }]} />
      <h1>{t.item?.title ?? "Submitted work"}</h1>
      <p className="lede">By {t.learner}, submitted {formatDateTime(t.updatedAt)}. {t.item?.href ? <Link to={t.item.href}>Open the brief</Link> : null}</p>
      <section aria-labelledby="work-h">
        <h2 id="work-h">The work</h2>
        {t.type === "submission" ? (
          <dl className="facts">
            <div><dt>Repository</dt><dd><a href={t.work.repositoryUrl} rel="noopener noreferrer" target="_blank">{t.work.repositoryUrl}</a></dd></div>
            <div><dt>Notes</dt><dd className="pre-wrap">{t.work.notes || "—"}</dd></div>
          </dl>
        ) : (
          <dl className="facts">
            <div><dt>Title</dt><dd>{t.work.title}</dd></div>
            <div><dt>Context</dt><dd className="pre-wrap">{t.work.context}</dd></div>
            <div><dt>Decision</dt><dd className="pre-wrap">{t.work.decision}</dd></div>
            <div><dt>Consequences</dt><dd className="pre-wrap">{t.work.consequences}</dd></div>
          </dl>
        )}
      </section>
      <form onSubmit={(e) => e.preventDefault()} aria-labelledby="rubric-h" className="section">
        <h2 id="rubric-h">Score against the rubric</h2>
        {data.rubric.map((r, i) => (
          <fieldset key={r.criterion} className="rubric-row">
            <legend>{r.criterion}</legend>
            {(["excellent", "good", "needs_work"] as const).map((level) => (
              <label key={level} className="rubric-option">
                <input type="radio" name={`criterion-${i}`} value={level} checked={scores[r.criterion] === level} onChange={() => setScores({ ...scores, [r.criterion]: level })} />
                <span><strong>{LEVEL_LABEL[level]}</strong> — {r[level]}</span>
              </label>
            ))}
          </fieldset>
        ))}
        <div className="field">
          <label htmlFor="review-feedback">Feedback for the learner</label>
          <textarea id="review-feedback" className="input textarea" rows={6} maxLength={8000} value={feedback} onChange={(e) => setFeedback(e.target.value)} required />
        </div>
        <div className="adr__actions">
          <button type="button" className="btn btn--primary" disabled={busy || !complete || !feedback.trim()} onClick={() => send("accepted")}>Accept</button>
          <button type="button" className="btn" disabled={busy || !complete || !feedback.trim()} onClick={() => send("changes_requested")}>Request changes</button>
        </div>
        {!complete ? <p className="small muted">Score every criterion to save the review.</p> : null}
        <p role="status" className="small">{message}</p>
      </form>
      {data.reviews.length ? (
        <section aria-labelledby="history-h">
          <h2 id="history-h">Earlier reviews</h2>
          {data.reviews.map((r) => <ReviewView key={r.id} review={r} />)}
        </section>
      ) : null}
    </div>
  );
}

function ReviewView({ review, heading }: { review: Review; heading?: string }) {
  return (
    <div className={`notice ${review.outcome === "accepted" ? "notice--ok" : "notice--warn"}`}>
      <p>
        <strong>{heading ?? OUTCOME_LABEL[review.outcome]}</strong>
        {review.reviewer ? ` by ${review.reviewer}` : ""}, {formatDateTime(review.createdAt)}
      </p>
      <p className="pre-wrap">{review.feedback}</p>
      <ul className="small">
        {Object.entries(review.scores).map(([criterion, level]) => (
          <li key={criterion}>{criterion}: {LEVEL_LABEL[level as keyof typeof LEVEL_LABEL] ?? level}</li>
        ))}
      </ul>
    </div>
  );
}

// ---- Panels embedded in other pages --------------------------------------------------------------------

/** "Submit your work" on a project or capstone page. */
export function SubmissionPanel({ kind, itemId }: { kind: "project" | "capstone"; itemId: string }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [form, setForm] = useState({ repositoryUrl: "", notes: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!user) return;
    void api<{ submission: Submission | null }>(`/api/me/submissions/${kind}/${itemId}`).then((r) => {
      setSubmission(r.submission);
      if (r.submission) setForm({ repositoryUrl: r.submission.repositoryUrl, notes: r.submission.notes });
    }).catch(() => undefined);
  }, [user, kind, itemId]);
  if (!user) {
    return (
      <section className="section" aria-labelledby="submit-h">
        <h2 id="submit-h">Submit your work</h2>
        <p><Link to={`/login?next=${encodeURIComponent(pathname)}`}>Sign in</Link> to submit a link to your work for review.</p>
      </section>
    );
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<{ submission: Submission }>(`/api/me/submissions/${kind}/${itemId}`, { method: "PUT", body: form });
      setSubmission(r.submission);
      setMessage("Submitted. Your teacher will review it against the rubric.");
    } catch (err) {
      setMessage(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="section" aria-labelledby="submit-h">
      <h2 id="submit-h">Submit your work</h2>
      {submission ? (
        <p>
          Status: <span className={`tag${submission.status === "accepted" ? " tag--done" : ""}`}>{OUTCOME_LABEL[submission.status]}</span>{" "}
          <span className="small muted">submitted {formatDateTime(submission.submittedAt)}</span>
        </p>
      ) : null}
      {submission?.review ? <ReviewView review={submission.review} heading={`Review: ${OUTCOME_LABEL[submission.review.outcome].toLowerCase()}`} /> : null}
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="sub-url">Link to your repository (https)</label>
          <input id="sub-url" className="input" type="url" inputMode="url" placeholder="https://" value={form.repositoryUrl} maxLength={500} onChange={(e) => setForm({ ...form, repositoryUrl: e.target.value })} required />
        </div>
        <div className="field">
          <label htmlFor="sub-notes">Notes for the reviewer (optional)</label>
          <textarea id="sub-notes" className="input textarea" rows={3} maxLength={4000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        <button className="btn btn--primary" disabled={busy || !form.repositoryUrl.startsWith("https://")}>{submission ? "Submit again" : "Submit for review"}</button>
        <p role="status" className="small">{message}</p>
      </form>
    </section>
  );
}

/** The latest faculty review of the learner's decision record, on an architecture page. */
export function DecisionReviewPanel({ architectureId }: { architectureId: string }) {
  const { user } = useAuth();
  const { data } = useApi<{ review: (Review & { current: boolean }) | null }>(user ? `/api/me/decisions/${encodeURIComponent(architectureId)}/review` : null);
  if (!data?.review) return null;
  return <ReviewView review={data.review} heading={`${data.review.current ? "Review" : "Review of an earlier version"}: ${OUTCOME_LABEL[data.review.outcome].toLowerCase()}`} />;
}

interface CertificateTrack {
  track: string; title: string; shortTitle: string; eligible: boolean;
  quiz: { passed: boolean; bestScore: number | null } | null;
  labs: { id: string; title: string; verified: boolean }[];
  certificate: { id: string; issuedAt: string; revoked: boolean } | null;
}

/** Dashboard: assignments, certificates and portfolio settings. */
export function CourseworkPanels() {
  const assignments = useApi<{ assignments: Assignment[] }>("/api/me/assignments");
  const certs = useApi<{ tracks: CertificateTrack[] }>("/api/me/certificates");
  const [message, setMessage] = useState<string | null>(null);
  const issue = async (track: string) => {
    setMessage(null);
    try {
      const r = await api<{ certificate: { id: string } }>(`/api/me/certificates/${track}`, { method: "POST" });
      navigate(`/certificates/${r.certificate.id}`);
    } catch (err) {
      setMessage(errorText(err));
    }
  };
  const started = (certs.data?.tracks ?? []).filter((t) => t.certificate || t.quiz?.bestScore != null || t.labs.some((l) => l.verified));
  return (
    <>
      <section className="section" aria-labelledby="assignments-h">
        <h2 id="assignments-h">Assignments</h2>
        {assignments.data ? (
          assignments.data.assignments.length ? <AssignmentTable assignments={assignments.data.assignments} showCohort /> : (
            <p className="muted">No assignments. <Link to="/cohorts">Join a cohort</Link> with the code from your teacher.</p>
          )
        ) : <Loading />}
      </section>
      <section className="section" aria-labelledby="certs-h">
        <h2 id="certs-h">Certificates</h2>
        <p className="muted small">
          A track certificate needs the track quiz passed and the track&apos;s server-verified practice done (simulation and read-through labs; for Git, the
          commit-graph simulation&apos;s challenges). Self-reported work does not count.
        </p>
        {started.length === 0 ? <p className="muted">Pass a track quiz to start working towards a certificate.</p> : (
          <ul className="link-list">
            {started.map((t) => (
              <li key={t.track}>
                <span>{t.shortTitle}</span>
                {t.certificate ? (
                  t.certificate.revoked ? <span className="tag">Revoked</span> : <Link to={`/certificates/${t.certificate.id}`}>View certificate</Link>
                ) : t.eligible ? (
                  <button type="button" className="btn btn--small btn--primary" onClick={() => issue(t.track)}>Get certificate</button>
                ) : (
                  <span className="small muted">
                    Quiz {t.quiz?.passed ? "passed" : "not passed yet"} · {t.labs.filter((l) => l.verified).length} of {t.labs.length} verified
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p role="status" className="field__error">{message}</p>
      </section>
      <PortfolioSettings />
      <YourData />
    </>
  );
}

function YourData() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const remove = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api("/api/me/delete", { method: "POST", body: { password, confirm } });
      window.location.assign("/"); // a full load resets the signed-in state everywhere
    } catch (err) {
      setMessage(errorText(err));
      setBusy(false);
    }
  };
  return (
    <section className="section" aria-labelledby="data-h">
      <h2 id="data-h">Your data</h2>
      <p>
        <a className="btn btn--small" href="/api/me/export" download="devforge-my-data.json">Download my data (JSON)</a>
      </p>
      <details>
        <summary>Delete my account</summary>
        <form onSubmit={remove}>
          <p className="small muted">
            This removes your account, progress, decision records, submissions, the reviews of them, your portfolio and certificates. It cannot be undone.
          </p>
          <div className="field">
            <label htmlFor="del-password">Your password</label>
            <input id="del-password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="del-confirm">Type “delete my account” to confirm</label>
            <input id="del-confirm" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" required />
          </div>
          <button className="btn" disabled={busy || confirm !== "delete my account" || !password}>Delete my account permanently</button>
          <p role="status" className="field__error">{message}</p>
        </form>
      </details>
    </section>
  );
}

function PortfolioSettings() {
  const { data } = useApi<{ portfolio: { slug: string; headline: string; isPublic: boolean } | null }>("/api/me/portfolio");
  const [form, setForm] = useState({ slug: "", headline: "", isPublic: false });
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (data?.portfolio) setForm(data.portfolio);
  }, [data]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    try {
      await api("/api/me/portfolio", { method: "PUT", body: form });
      setMessage(form.isPublic ? "Saved. Your portfolio is public." : "Saved. Your portfolio is private.");
    } catch (err) {
      setMessage(errorText(err));
    }
  };
  return (
    <section className="section" aria-labelledby="portfolio-h">
      <h2 id="portfolio-h">Public portfolio</h2>
      <p className="muted small">
        Off by default. When public, it shows your display name, headline, accepted projects and capstones (with their repository links) and valid
        certificates — never your e-mail address.
      </p>
      <form onSubmit={save}>
        <div className="field">
          <label htmlFor="pf-slug">Address</label>
          <p className="field__hint" id="pf-slug-hint">3–40 lowercase letters, digits and hyphens: /portfolio/{form.slug || "your-name"}</p>
          <input id="pf-slug" className="input" value={form.slug} maxLength={40} aria-describedby="pf-slug-hint" onChange={(e) => setForm({ ...form, slug: e.target.value })} required />
        </div>
        <div className="field">
          <label htmlFor="pf-headline">Headline (optional)</label>
          <input id="pf-headline" className="input" value={form.headline} maxLength={200} onChange={(e) => setForm({ ...form, headline: e.target.value })} />
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={form.isPublic} onChange={(e) => setForm({ ...form, isPublic: e.target.checked })} /> Make my portfolio public
        </label>
        <p>
          <button className="btn btn--primary">Save portfolio settings</button>{" "}
          {data?.portfolio?.isPublic ? <Link to={`/portfolio/${data.portfolio.slug}`}>View it</Link> : null}
        </p>
        <p role="status" className="small">{message}</p>
      </form>
    </section>
  );
}

// ---- Public pages --------------------------------------------------------------------------------------

interface PublicPortfolio {
  name: string; headline: string;
  work: { kind: "project" | "capstone"; item: ItemRef; repositoryUrl: string; acceptedAt: string }[];
  certificates: { id: string; track: string; trackTitle: string; issuedAt: string }[];
}

export function PortfolioPage({ slug }: { slug: string }) {
  const { data, error, loading, reload } = useApi<{ portfolio: PublicPortfolio }>(`/api/portfolio/${encodeURIComponent(slug)}`);
  useTitle(data ? `${data.portfolio.name}'s portfolio` : "Portfolio");
  if (error) return <div className="page"><ErrorState error={error} onRetry={reload} /></div>;
  if (loading || !data) return <div className="page"><Loading /></div>;
  const p = data.portfolio;
  return (
    <div className="page page--narrow">
      <h1>{p.name}</h1>
      {p.headline ? <p className="lede">{p.headline}</p> : null}
      <h2>Reviewed work</h2>
      {p.work.length === 0 ? <p className="muted">No accepted projects yet.</p> : (
        <ul className="capstone-list">
          {p.work.map((w) => (
            <li key={w.repositoryUrl + w.item.title}>
              <h3>{w.item.href ? <Link to={w.item.href}>{w.item.title}</Link> : w.item.title}</h3>
              <p className="small muted">{w.kind === "capstone" ? "Capstone" : "Mini-project"} · accepted {formatDate(w.acceptedAt)} by a DevForge teacher</p>
              <p><a href={w.repositoryUrl} rel="noopener noreferrer nofollow">{w.repositoryUrl}</a></p>
            </li>
          ))}
        </ul>
      )}
      <h2>Certificates</h2>
      {p.certificates.length === 0 ? <p className="muted">None yet.</p> : (
        <ul className="link-list">
          {p.certificates.map((c) => (
            <li key={c.id}><Link to={`/certificates/${c.id}`}>{c.trackTitle}</Link><span className="small faint">{formatDate(c.issuedAt)}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface PublicCertificate {
  id: string; holder: string; track: string; trackTitle: string; issuedAt: string; revokedAt: string | null;
  criteria: { quizBestScore: number | null; verifiedLabs: string[] };
}

export function CertificatePage({ id }: { id: string }) {
  const { data, error, loading, reload } = useApi<{ certificate: PublicCertificate }>(`/api/certificates/${encodeURIComponent(id)}`);
  useTitle("Certificate");
  if (error) return <div className="page"><ErrorState error={error} onRetry={reload} /></div>;
  if (loading || !data) return <div className="page"><Loading /></div>;
  const c = data.certificate;
  return (
    <div className="page page--narrow">
      <div className={`notice ${c.revokedAt ? "notice--danger" : "notice--ok"}`} role="status">
        <p>
          <strong>{c.revokedAt ? `This certificate was revoked on ${formatDate(c.revokedAt)}.` : "This certificate is valid."}</strong> It was checked against DevForge&apos;s
          records just now.
        </p>
      </div>
      <h1>{c.trackTitle}</h1>
      <p className="lede">Awarded to <strong>{c.holder}</strong> on {formatDate(c.issuedAt)}.</p>
      <h2>What it certifies</h2>
      <ul>
        <li>Passed the track quiz{c.criteria.quizBestScore != null ? ` (best score ${Math.round(c.criteria.quizBestScore * 100)}%)` : ""}; every quiz is graded on the server.</li>
        <li>Completed the practice the server verified: {c.criteria.verifiedLabs.join("; ")}.</li>
      </ul>
      <p className="small muted">Certificate id: <code>{c.id}</code>. Learn about the track: <Link to={`/tracks/${c.track}`}>{c.trackTitle}</Link>.</p>
    </div>
  );
}
