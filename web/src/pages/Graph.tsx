import { useMemo, useState } from "react";
import { Crumbs } from "../components/Crumbs.tsx";
import { ErrorState, Loading } from "../components/States.tsx";
import { Link, navigate } from "../lib/router.tsx";
import type { GraphResponse, PublicIntegration } from "../lib/types.ts";
import { useApi, useTitle } from "../lib/useApi.ts";

const SIZE = 720;
const R = 280;

/** All 18 tools on a circle, grouped by category, with a line for every pair of related tools. */
export function GraphPage() {
  const { data, error, loading, reload } = useApi<GraphResponse>("/api/graph", { cache: true });
  const [pathSlug, setPathSlug] = useState("");
  const [focus, setFocus] = useState("");
  useTitle("How the tools connect");

  const positions = useMemo(() => {
    const nodes = [...(data?.nodes ?? [])].sort((a, b) => (a.category === b.category ? a.number - b.number : a.category.localeCompare(b.category)));
    return new Map(nodes.map((n, i) => {
      const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
      return [n.slug, { x: SIZE / 2 + R * Math.cos(angle), y: SIZE / 2 + R * Math.sin(angle) }];
    }));
  }, [data]);

  if (error) return <div className="page"><ErrorState error={error} onRetry={reload} /></div>;
  if (loading || !data) return <div className="page"><Loading label="Loading the relationship graph" /></div>;
  const inPath = new Set(data.paths.find((p) => p.slug === pathSlug)?.tracks ?? []);
  const active = (slug: string) => (!pathSlug || inPath.has(slug)) && (!focus || focus === slug || data.edges.some((e) => (e.a === focus && e.b === slug) || (e.b === focus && e.a === slug)));
  const edgeActive = (a: string, b: string) => (!pathSlug || (inPath.has(a) && inPath.has(b))) && (!focus || a === focus || b === focus);
  const title = (slug: string) => data.nodes.find((n) => n.slug === slug)?.shortTitle ?? slug;
  const withGuide = data.edges.filter((e) => e.integration).length;

  return (
    <div className="page graph">
      <Crumbs items={[{ label: "How the tools connect" }]} />
      <h1>How the tools connect</h1>
      <p className="lede">
        Each line joins two tools that are used together. {withGuide} of the {data.edges.length} connections have an integration guide with
        lessons that practise both tools — the solid lines.
      </p>
      <div className="graph__filters">
        <div className="field">
          <label className="field__label" htmlFor="graph-path">Highlight a learning path</label>
          <select id="graph-path" value={pathSlug} onChange={(e) => setPathSlug(e.target.value)}>
            <option value="">All tools</option>
            {data.paths.map((p) => (
              <option key={p.slug} value={p.slug}>{p.title}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="graph-focus">Show one tool's connections</label>
          <select id="graph-focus" value={focus} onChange={(e) => setFocus(e.target.value)}>
            <option value="">All tools</option>
            {data.nodes.map((n) => (
              <option key={n.slug} value={n.slug}>{n.shortTitle}</option>
            ))}
          </select>
        </div>
      </div>
      <svg className="graph__svg" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-labelledby="graph-desc">
        <desc id="graph-desc">
          {data.nodes.length} tools arranged in a circle with {data.edges.length} lines between related tools. The same information is in the list
          below the picture.
        </desc>
        {data.edges.map((e) => {
          const p = positions.get(e.a);
          const q = positions.get(e.b);
          if (!p || !q) return null;
          const on = edgeActive(e.a, e.b);
          const line = <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} className={`graph__edge${e.integration ? " graph__edge--guide" : ""}${on ? "" : " is-dim"}`} />;
          return e.integration ? (
            <a key={`${e.a}-${e.b}`} href={`/integrations/${e.integration.id}`} onClick={(ev) => { ev.preventDefault(); navigate(`/integrations/${e.integration?.id}`); }}>
              <title>{e.integration.title}</title>
              {line}
            </a>
          ) : (
            <g key={`${e.a}-${e.b}`}>
              <title>{`${title(e.a)} and ${title(e.b)}`}</title>
              {line}
            </g>
          );
        })}
        {data.nodes.map((n) => {
          const p = positions.get(n.slug);
          if (!p) return null;
          return (
            <a key={n.slug} href={`/tracks/${n.slug}`} onClick={(ev) => { ev.preventDefault(); navigate(`/tracks/${n.slug}`); }} className={active(n.slug) ? "" : "is-dim"}>
              <rect x={p.x - 62} y={p.y - 16} width={124} height={32} rx={8} className="graph__node" />
              <text x={p.x} y={p.y + 5} textAnchor="middle" className="graph__label">{n.shortTitle}</text>
            </a>
          );
        })}
      </svg>
      <h2 id="connections">All connections</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Tools</th>
              <th scope="col">Why they are used together</th>
              <th scope="col">Integration guide</th>
            </tr>
          </thead>
          <tbody>
            {data.edges.filter((e) => edgeActive(e.a, e.b)).map((e) => (
              <tr key={`${e.a}-${e.b}`}>
                <th scope="row">
                  <Link to={`/tracks/${e.a}`}>{title(e.a)}</Link> and <Link to={`/tracks/${e.b}`}>{title(e.b)}</Link>
                </th>
                <td>{e.reasons.map((r) => r.why).join(" ")}</td>
                <td>{e.integration ? <Link to={`/integrations/${e.integration.id}`}>{e.integration.title}</Link> : <span className="muted">Not yet</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const KIND = { lesson: "Lesson", lab: "Lab", project: "Mini-project" } as const;

export function IntegrationPage({ id }: { id: string }) {
  const { data, error, loading, reload } = useApi<{ integration: PublicIntegration }>(`/api/integrations/${encodeURIComponent(id)}`);
  useTitle(data?.integration.title);
  if (error) return <div className="page"><ErrorState error={error} onRetry={reload} /></div>;
  if (loading || !data) return <div className="page"><Loading label="Loading the integration" /></div>;
  const i = data.integration;
  return (
    <div className="page page--narrow">
      <Crumbs items={[{ to: "/graph", label: "How the tools connect" }, { label: `${i.fromTitle} and ${i.toTitle}` }]} />
      <h1>{i.title}</h1>
      <p className="muted">
        <Link to={`/tracks/${i.from}`}>{i.fromTitle}</Link> → <Link to={`/tracks/${i.to}`}>{i.toTitle}</Link> · reviewed {i.last_reviewed}
      </p>
      <p className="lede">{i.summary}</p>
      <p>
        <strong>What passes between them:</strong> {i.flow}
      </p>
      <h2 id="steps">How it fits together</h2>
      <ol>
        {i.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <h2 id="pitfalls">Common mistakes</h2>
      <ul>
        {i.pitfalls.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      <h2 id="practise">Practise it</h2>
      <ul>
        {i.practise.map((r) => (
          <li key={`${r.kind}-${r.id}`}>
            {KIND[r.kind]}: <Link to={`/tracks/${r.track}/${r.kind === "project" ? "projects" : r.kind === "lab" ? "labs" : "lessons"}/${r.id}`}>{r.title}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
