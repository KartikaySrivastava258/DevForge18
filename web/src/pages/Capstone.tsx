import { SubmissionPanel } from "./Coursework.tsx";
import { Crumbs } from "../components/Crumbs.tsx";
import { ErrorState, Loading } from "../components/States.tsx";
import { Link } from "../lib/router.tsx";
import type { CapstoneReuse, CapstoneSummary, PublicCapstone } from "../lib/types.ts";
import { useApi, useTitle } from "../lib/useApi.ts";

const KIND = { lesson: "Lesson", lab: "Lab", project: "Mini-project" } as const;

function reuseLink(r: CapstoneReuse): string {
  return `/tracks/${r.track}/${r.kind === "project" ? "projects" : r.kind === "lab" ? "labs" : "lessons"}/${r.id}`;
}

export function CapstonesPage() {
  const { data, error, loading, reload } = useApi<{ capstones: CapstoneSummary[] }>("/api/capstones");
  useTitle("Capstone projects");
  if (error) return <div className="page"><ErrorState error={error} onRetry={reload} /></div>;
  if (loading || !data) return <div className="page"><Loading label="Loading capstones" /></div>;
  return (
    <div className="page page--narrow">
      <Crumbs items={[{ label: "Capstones" }]} />
      <h1>Capstone projects</h1>
      <p className="lede">Larger team projects that combine several tracks into one working system, milestone by milestone.</p>
      <ul className="capstone-list">
        {data.capstones.map((c) => (
          <li key={c.id}>
            <h2>
              <Link to={`/capstones/${c.id}`}>
                Project {c.letter} — {c.title}
              </Link>
            </h2>
            <p>{c.summary}</p>
            <p className="muted small">
              {c.level} · about {c.estimatedHours} hours · {c.tracks.length} tracks
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CapstonePage({ id }: { id: string }) {
  const { data, error, loading, reload } = useApi<{ capstone: PublicCapstone }>(`/api/capstones/${encodeURIComponent(id)}`);
  useTitle(data ? `Project ${data.capstone.letter} — ${data.capstone.title}` : undefined);
  if (error) return <div className="page"><ErrorState error={error} onRetry={reload} /></div>;
  if (loading || !data) return <div className="page"><Loading label="Loading capstone" /></div>;
  const c = data.capstone;
  return (
    <div className="page page--narrow capstone">
      <Crumbs items={[{ to: "/capstones", label: "Capstones" }, { label: `Project ${c.letter}` }]} />
      <h1>
        Project {c.letter} — {c.title}
      </h1>
      <p className="lede">{c.summary}</p>
      <p className="muted">
        Capstone · {c.level} · about {c.estimatedHours} hours · reviewed {c.lastReviewed}
      </p>
      <p>
        Tracks:{" "}
        {c.tracks.map((t, n) => (
          <span key={t}>
            {n ? ", " : ""}
            <Link to={`/tracks/${t}`}>{t}</Link>
          </span>
        ))}
        {c.paths.length ? (
          <>
            {" "}· the capstone of{" "}
            {c.paths.map((p, n) => (
              <span key={p}>
                {n ? ", " : ""}
                <Link to={`/paths/${p}`}>{p}</Link>
              </span>
            ))}
          </>
        ) : null}
      </p>

      <h2 id="architecture-figure">Target architecture</h2>
      <div className="capstone__architecture" dangerouslySetInnerHTML={{ __html: c.architectureHtml }} />
      <div className="article" dangerouslySetInnerHTML={{ __html: c.html }} />

      <h2 id="stories">User stories</h2>
      <ul>
        {c.userStories.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>

      <h2 id="milestones">Milestones</h2>
      <ol className="capstone__milestones">
        {c.milestones.map((m) => (
          <li key={m.id} id={`milestone-${m.id}`}>
            <h3>{m.title}</h3>
            <p>{m.goal}</p>
            <h4>Deliverables</h4>
            <ul>
              {m.deliverables.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
            <h4>Done when</h4>
            <ul className="project__criteria">
              {m.acceptance.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            {m.reuses.length ? (
              <>
                <h4>Builds on</h4>
                <ul>
                  {m.reuses.map((r) => (
                    <li key={`${r.kind}-${r.id}`}>
                      {KIND[r.kind]}: <Link to={reuseLink(r)}>{r.title}</Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </li>
        ))}
      </ol>

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
            {c.rubric.map((r) => (
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

      <h2 id="stretch">Stretch goals</h2>
      <ul>
        {c.stretchGoals.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      <SubmissionPanel kind="capstone" itemId={c.id} />
    </div>
  );
}
