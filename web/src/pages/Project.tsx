import { useState } from "react";
import { Crumbs } from "../components/Crumbs.tsx";
import { ErrorState, Loading } from "../components/States.tsx";
import { api, ApiError } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import { Link } from "../lib/router.tsx";
import type { ProjectFile, PublicProject, TrackResponse } from "../lib/types.ts";
import { useApi, useTitle } from "../lib/useApi.ts";

function Files({ files, label }: { files: ProjectFile[]; label: string }) {
  return (
    <div className="project__files" aria-label={label}>
      {files.map((f) => (
        <details key={f.path}>
          <summary>
            <code>{f.path}</code>
          </summary>
          <pre>
            <code>{f.content}</code>
          </pre>
        </details>
      ))}
    </div>
  );
}

export function ProjectPage({ trackSlug, projectId }: { trackSlug: string; projectId: string }) {
  const { data, error, loading, reload } = useApi<{ project: PublicProject }>(`/api/projects/${encodeURIComponent(projectId)}`);
  const track = useApi<TrackResponse>(`/api/tracks/${trackSlug}`, { cache: true });
  const { user } = useAuth();
  const [hintsShown, setHintsShown] = useState(0);
  const [solution, setSolution] = useState<ProjectFile[] | null>(null);
  const [solutionError, setSolutionError] = useState<string | null>(null);
  useTitle(data?.project.title);

  if (error) return <div className="page"><ErrorState error={error} onRetry={reload} /></div>;
  if (loading || !data) return <div className="page"><Loading label="Loading project" /></div>;
  const p = data.project;
  const canSeeSolution = user?.role === "faculty" || user?.role === "admin";

  const loadSolution = async () => {
    setSolutionError(null);
    try {
      const r = await api<{ solution: { files: ProjectFile[] } }>(`/api/projects/${encodeURIComponent(p.id)}/solution`);
      setSolution(r.solution.files);
    } catch (err) {
      setSolutionError(err instanceof ApiError ? err.message : "Could not load the reference solution.");
    }
  };

  return (
    <div className="page page--narrow project">
      <Crumbs items={[{ to: "/tracks", label: "Tracks" }, { to: `/tracks/${trackSlug}`, label: track.data?.summary.shortTitle ?? trackSlug }, { label: "Project" }]} />
      <h1>{p.title}</h1>
      <p className="muted">
        Mini-project · {p.level} · about {p.estimatedHours} hours · reviewed {p.lastReviewed}
      </p>
      {p.prerequisites.length ? (
        <p>
          Before you start:{" "}
          {p.prerequisites.map((l, n) => (
            <span key={l.id}>
              {n ? ", " : ""}
              <Link to={`/tracks/${l.track}/lessons/${l.id}`}>{l.title}</Link>
            </span>
          ))}
        </p>
      ) : null}
      <div className="article" dangerouslySetInnerHTML={{ __html: p.html }} />

      <h2 id="stories">User stories</h2>
      <ul>
        {p.userStories.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>

      <h2 id="acceptance">Acceptance criteria</h2>
      <p className="muted">Each one is a statement you can check. Your project is done when all of them are true.</p>
      <ul className="project__criteria">
        {p.acceptanceCriteria.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>

      <h2 id="rubric">Rubric</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Criterion</th>
              <th scope="col">Excellent</th>
              <th scope="col">Good</th>
              <th scope="col">Needs work</th>
            </tr>
          </thead>
          <tbody>
            {p.rubric.map((r) => (
              <tr key={r.criterion}>
                <th scope="row">{r.criterion}</th>
                <td>{r.excellent}</td>
                <td>{r.good}</td>
                <td>{r.needs_work}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="starter">Starter files</h2>
      <p className="muted">
        Copy these into a new folder (or repository) and work from there. They are in the DevForge repository under{" "}
        <code>
          content/projects/{p.track}/{p.id}/starter
        </code>
        .
      </p>
      <Files files={p.starterFiles} label="Starter files" />

      {p.checkScript ? (
        <>
          <h2 id="check">Check your work</h2>
          <p className="muted">
            This script tests the acceptance criteria. Save it as <code>check.sh</code> next to your project folder and run{" "}
            <code>bash check.sh path/to/your/project</code>; it prints PASS or FAIL for each criterion. DevForge's own tests run it
            against the reference solution (all PASS) and the starter (FAIL).
          </p>
          <Files files={[{ path: "check.sh", content: p.checkScript }]} label="Check script" />
        </>
      ) : null}

      <h2 id="hints">Hints</h2>
      <p className="muted">Stuck? Reveal one hint at a time — try on your own after each.</p>
      <ol aria-live="polite">
        {p.hints.slice(0, hintsShown).map((h) => (
          <li key={h}>{h}</li>
        ))}
      </ol>
      {hintsShown < p.hints.length ? (
        <button type="button" className="btn" onClick={() => setHintsShown((n) => n + 1)}>
          Show hint {hintsShown + 1} of {p.hints.length}
        </button>
      ) : (
        <p className="muted">That was the last hint.</p>
      )}

      <h2 id="stretch">Stretch goals</h2>
      <ul>
        {p.stretchGoals.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>

      {canSeeSolution ? (
        <section aria-labelledby="solution">
          <h2 id="solution">Reference solution (faculty)</h2>
          <p className="muted">Visible to faculty and admins only, for marking and feedback.</p>
          {solution ? (
            <Files files={solution} label="Reference solution" />
          ) : (
            <button type="button" className="btn" onClick={loadSolution}>
              Show the reference solution
            </button>
          )}
          {solutionError ? <p className="field__error">{solutionError}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
