import { useEffect, useState, type FormEvent } from "react";
import { Crumbs } from "../components/Crumbs.tsx";
import { ErrorState, Loading } from "../components/States.tsx";
import { api, ApiError } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import { Link, useLocation } from "../lib/router.tsx";
import type { ArchitectureDecision, ArchitectureSummary, PublicArchitecture } from "../lib/types.ts";
import { useApi, useTitle } from "../lib/useApi.ts";

const KIND = { lesson: "Lesson", lab: "Lab", project: "Mini-project" } as const;

export function ArchitecturesPage() {
  const { data, error, loading, reload } = useApi<{ architectures: ArchitectureSummary[] }>("/api/architectures", { cache: true });
  useTitle("Architecture studio");
  if (error) return <div className="page"><ErrorState error={error} onRetry={reload} /></div>;
  if (loading || !data) return <div className="page"><Loading label="Loading architectures" /></div>;
  return (
    <div className="page page--narrow">
      <Crumbs items={[{ label: "Architecture studio" }]} />
      <h1>Architecture studio</h1>
      <p className="lede">
        Reference architectures that combine the tracks: what each part does, how requests and data flow, what you trade, what breaks — and a
        place to write your own architecture decision record.
      </p>
      <p>
        <Link to="/graph">See how the tools connect</Link>
      </p>
      <ul className="capstone-list">
        {data.architectures.map((a) => (
          <li key={a.id}>
            <h2>
              <Link to={`/architecture/${a.id}`}>{a.title}</Link>
            </h2>
            <p>{a.summary}</p>
            <p className="muted small">{a.tracks.join(" · ")}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DecisionEditor({ architecture }: { architecture: PublicArchitecture }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [form, setForm] = useState({ title: "", context: "", decision: "", consequences: "" });
  const [saved, setSaved] = useState<ArchitectureDecision | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    void api<{ decision: ArchitectureDecision | null }>(`/api/me/decisions/${architecture.id}`).then((r) => {
      if (r.decision) {
        setSaved(r.decision);
        setForm({ title: r.decision.title, context: r.decision.context, decision: r.decision.decision, consequences: r.decision.consequences });
      } else {
        setForm((f) => ({ ...f, title: `Use ${architecture.title.toLowerCase()} for …` }));
      }
    }).catch(() => setMessage("Could not load your saved record."));
  }, [user, architecture.id, architecture.title]);

  if (!user) {
    return (
      <p>
        <Link to={`/login?next=${encodeURIComponent(pathname)}`}>Sign in</Link> to write and keep your own decision record for this architecture.
      </p>
    );
  }

  const save = async (status: "draft" | "submitted", e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<{ decision: ArchitectureDecision }>(`/api/me/decisions/${architecture.id}`, { method: "PUT", body: { ...form, status } });
      setSaved(r.decision);
      setMessage(status === "submitted" ? "Submitted for feedback." : "Draft saved.");
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const field = (key: "title" | "context" | "decision" | "consequences", label: string, hint: string, rows = 5) => (
    <div className="field">
      <label className="field__label" htmlFor={`adr-${key}`}>
        {label}
      </label>
      <p className="muted small" id={`adr-${key}-hint`}>{hint}</p>
      {key === "title" ? (
        <input id={`adr-${key}`} aria-describedby={`adr-${key}-hint`} value={form[key]} maxLength={200} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
      ) : (
        <textarea id={`adr-${key}`} aria-describedby={`adr-${key}-hint`} rows={rows} value={form[key]} maxLength={8000} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
      )}
    </div>
  );

  return (
    <form className="adr" onSubmit={(e) => save("draft", e)} noValidate aria-label="Your architecture decision record">
      {field("title", "Title", "A short statement of the decision.", 1)}
      {field("context", "Context", "The situation and the forces at play: requirements, constraints, what you know and what you assume.")}
      {field("decision", "Decision", "What you decided, and which alternatives you rejected and why.")}
      {field("consequences", "Consequences", "What becomes easier and what becomes harder; risks and how you will notice them.")}
      <div className="adr__actions">
        <button type="submit" className="btn" disabled={busy}>Save draft</button>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => save("submitted")}>Submit for feedback</button>
      </div>
      <p aria-live="polite" className="muted small">
        {message}
        {saved ? ` Status: ${saved.status}, last saved ${new Date(saved.updatedAt).toLocaleString()}.` : ""}
      </p>
    </form>
  );
}

export function ArchitecturePage({ id }: { id: string }) {
  const { data, error, loading, reload } = useApi<{ architecture: PublicArchitecture }>(`/api/architectures/${encodeURIComponent(id)}`);
  useTitle(data?.architecture.title);
  if (error) return <div className="page"><ErrorState error={error} onRetry={reload} /></div>;
  if (loading || !data) return <div className="page"><Loading label="Loading the architecture" /></div>;
  const a = data.architecture;
  return (
    <div className="page page--narrow">
      <Crumbs items={[{ to: "/architecture", label: "Architecture studio" }, { label: a.title }]} />
      <h1>{a.title}</h1>
      <p className="lede">{a.summary}</p>
      <p>
        <strong>The problem:</strong> {a.problem}
      </p>
      <div className="capstone__architecture" dangerouslySetInnerHTML={{ __html: a.diagramHtml }} />
      <div className="article" dangerouslySetInnerHTML={{ __html: a.html }} />
      <h2 id="components">The parts</h2>
      <dl className="facts">
        {a.components.map((c) => (
          <div key={c.name}>
            <dt>{c.track ? <Link to={`/tracks/${c.track}`}>{c.name}</Link> : c.name}</dt>
            <dd>{c.role}</dd>
          </div>
        ))}
      </dl>
      <h2 id="flow">How a request flows</h2>
      <ol>
        {a.flow.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <h2 id="trade-offs">Trade-offs</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Choice</th>
              <th scope="col">You gain</th>
              <th scope="col">You pay</th>
            </tr>
          </thead>
          <tbody>
            {a.tradeOffs.map((t) => (
              <tr key={t.choice}>
                <th scope="row">{t.choice}</th>
                <td>{t.gain}</td>
                <td>{t.cost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 id="failures">What breaks, and what to do</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Failure</th>
              <th scope="col">Effect</th>
              <th scope="col">Mitigation</th>
            </tr>
          </thead>
          <tbody>
            {a.failureModes.map((f) => (
              <tr key={f.failure}>
                <th scope="row">{f.failure}</th>
                <td>{f.effect}</td>
                <td>{f.mitigation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 id="alternatives">Alternatives</h2>
      <ul>
        {a.alternatives.map((x) => (
          <li key={x.consider}>
            Instead of {x.instead_of}, consider <strong>{x.consider}</strong> when {x.when.charAt(0).toLowerCase() + x.when.slice(1)}
          </li>
        ))}
      </ul>
      <h2 id="learn">Learn the parts</h2>
      <ul>
        {a.learnMore.map((r) => (
          <li key={`${r.kind}-${r.id}`}>
            {KIND[r.kind]}: <Link to={`/tracks/${r.track}/${r.kind === "project" ? "projects" : r.kind === "lab" ? "labs" : "lessons"}/${r.id}`}>{r.title}</Link>
          </li>
        ))}
        {a.capstones.map((c) => (
          <li key={c.id}>
            Capstone: <Link to={`/capstones/${c.id}`}>Project {c.letter} — {c.title}</Link>
          </li>
        ))}
      </ul>
      <h2 id="decide">Your decision record</h2>
      <p>Answer these in your own architecture decision record — for your project, your team or a design you are reviewing:</p>
      <ul>
        {a.decisionPrompts.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <DecisionEditor architecture={a} />
    </div>
  );
}
