/**
 * The system map: all 18 tracks arranged by where they sit in a software
 * system, with edges drawn from each track's `related` content. Every edge
 * shown has an authored explanation ("why"), so nothing on the map is
 * decorative. Nodes are real links (keyboard focusable); narrow screens get
 * a plain grouped list instead of the diagram.
 */
import { useMemo, useState } from "react";
import { Link, navigate } from "../lib/router.tsx";
import type { TrackSummary } from "../lib/types.ts";

const COLUMNS: { id: string; label: string }[] = [
  { id: "source-planning", label: "Plan & code" },
  { id: "ci-cd", label: "Build & deliver" },
  { id: "containers-infra", label: "Run & route" },
  { id: "data-messaging", label: "Data & events" },
  { id: "apis-automation", label: "APIs & automation" },
  { id: "ai-ml", label: "AI & ML" },
  { id: "observability", label: "Observe" },
];

const COL_W = 138;
const NODE_W = 124;
const NODE_H = 42;
const ROW_H = 58;
const TOP = 42;
const LEFT = 10;

interface Placed {
  track: TrackSummary;
  x: number;
  y: number;
}

interface Edge {
  a: string;
  b: string;
}

export function SystemMap({ tracks }: { tracks: TrackSummary[] }) {
  const [active, setActive] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const focus = active ?? pinned;

  const { placed, edges, height, bySlug } = useMemo(() => {
    const placedNodes: Placed[] = [];
    let maxRows = 0;
    COLUMNS.forEach((col, ci) => {
      const members = tracks.filter((t) => t.category === col.id).sort((a, b) => a.number - b.number);
      maxRows = Math.max(maxRows, members.length);
      members.forEach((track, ri) => placedNodes.push({ track, x: LEFT + ci * COL_W, y: TOP + ri * ROW_H }));
    });
    const seen = new Set<string>();
    const edgeList: Edge[] = [];
    for (const t of tracks) {
      for (const r of t.related) {
        const k = [t.slug, r.slug].sort().join("|");
        if (seen.has(k)) continue;
        seen.add(k);
        edgeList.push({ a: t.slug, b: r.slug });
      }
    }
    return {
      placed: placedNodes,
      edges: edgeList,
      height: TOP + maxRows * ROW_H,
      bySlug: new Map(placedNodes.map((p) => [p.track.slug, p])),
    };
  }, [tracks]);

  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!m.has(e.a)) m.set(e.a, new Set());
      if (!m.has(e.b)) m.set(e.b, new Set());
      m.get(e.a)?.add(e.b);
      m.get(e.b)?.add(e.a);
    }
    return m;
  }, [edges]);

  const pathFor = (e: Edge): string => {
    const p = bySlug.get(e.a);
    const q = bySlug.get(e.b);
    if (!p || !q) return "";
    const [s, t] = p.x <= q.x ? [p, q] : [q, p];
    const sy = s.y + NODE_H / 2;
    const ty = t.y + NODE_H / 2;
    if (s.x === t.x) {
      const x = s.x;
      const bulge = 22 + Math.abs(ty - sy) * 0.15;
      return `M ${x} ${sy} C ${x - bulge} ${sy}, ${x - bulge} ${ty}, ${x} ${ty}`;
    }
    const sx = s.x + NODE_W;
    const tx = t.x;
    const mid = (sx + tx) / 2;
    return `M ${sx} ${sy} C ${mid} ${sy}, ${mid} ${ty}, ${tx} ${ty}`;
  };

  const focusTrack = focus ? bySlug.get(focus)?.track : undefined;
  const connections = focusTrack
    ? [...(neighbours.get(focusTrack.slug) ?? [])]
        .map((slug) => {
          const other = bySlug.get(slug)?.track;
          const why =
            focusTrack.related.find((r) => r.slug === slug)?.why ?? other?.related.find((r) => r.slug === focusTrack.slug)?.why ?? "";
          return other ? { track: other, why } : null;
        })
        .filter((c): c is { track: TrackSummary; why: string } => c !== null)
        .sort((x, y) => x.track.number - y.track.number)
    : [];
  const width = LEFT + COLUMNS.length * COL_W;

  return (
    <div className="map" data-active={focus ?? undefined}>
      <div className="map__canvas">
        <p className="sr-only">
          Diagram of the 18 tracks grouped by role. Each technology is a link; focusing one lists how it connects to the others in
          the panel beside the diagram.
        </p>
        <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label="How the 18 tracks connect">
          {COLUMNS.map((col, ci) => (
            <text key={col.id} className="map-col-label" x={LEFT + ci * COL_W} y={18}>
              {col.label}
            </text>
          ))}
          <g>
            {edges.map((e) => (
              <path
                key={`${e.a}|${e.b}`}
                className="map-edge"
                d={pathFor(e)}
                data-on={focus !== null && (e.a === focus || e.b === focus) ? "true" : undefined}
              />
            ))}
          </g>
          {placed.map(({ track, x, y }) => {
            const on = track.slug === focus;
            const linked = focus ? neighbours.get(focus)?.has(track.slug) : false;
            return (
              <a
                key={track.slug}
                className="map-node"
                href={`/tracks/${track.slug}`}
                aria-label={`Track ${track.number}: ${track.shortTitle}`}
                data-on={on ? "true" : undefined}
                data-dim={focus && !on && !linked ? "true" : undefined}
                onMouseEnter={() => setActive(track.slug)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setPinned(track.slug)}
                onClick={(ev) => {
                  if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
                  ev.preventDefault();
                  navigate(`/tracks/${track.slug}`);
                }}
              >
                <rect x={x} y={y} width={NODE_W} height={NODE_H} rx={6} />
                {/* The trailing spaces keep the visible words apart ("1 Git + GitHub"), so the link's name,
                    "Track 1: Git + GitHub", contains its visible label in order (WCAG 2.5.3 Label in Name). */}
                <text className="map-node__num" x={x + 9} y={y + 26}>
                  {`${track.number} `}
                </text>
                {track.shortTitle.includes(" + ") ? (
                  // Paired tracks name both products (e.g. "Prometheus + Grafana") on two lines rather than truncating.
                  <text className="map-node__two" x={x + 26} y={y + 18}>
                    <tspan x={x + 26}>{`${track.shortTitle.split(" + ")[0]} + `}</tspan>
                    <tspan x={x + 26} dy={14}>
                      {track.shortTitle.split(" + ")[1]}
                    </tspan>
                  </text>
                ) : (
                  <text x={x + 26} y={y + 26}>
                    {track.shortTitle}
                  </text>
                )}
              </a>
            );
          })}
        </svg>
      </div>

      <div className="map-list">
        {COLUMNS.map((col) => (
          <div key={col.id}>
            <h3>{col.label}</h3>
            <ul>
              {tracks
                .filter((t) => t.category === col.id)
                .map((t) => (
                  <li key={t.slug}>
                    <Link to={`/tracks/${t.slug}`}>{t.shortTitle}</Link>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>

      <aside className="map__panel" aria-live="polite">
        {focusTrack ? (
          <>
            <p className="small faint" style={{ margin: 0 }}>
              Track {focusTrack.number}
            </p>
            <h3>
              <Link to={`/tracks/${focusTrack.slug}`}>{focusTrack.shortTitle}</Link>
            </h3>
            <p className="muted">{focusTrack.mentalModel}</p>
            {connections.length ? (
              <>
                <p className="small faint" style={{ marginBottom: "var(--space-1)" }}>
                  Connects to
                </p>
                <ul>
                  {connections.map((c) => (
                    <li key={c.track.slug}>
                      <Link to={`/tracks/${c.track.slug}`}>{c.track.shortTitle}</Link>
                      <div className="small muted">{c.why}</div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        ) : (
          <>
            <h3>Nothing here works alone</h3>
            <p className="muted">
              Point at a technology, or tab to it, to see what it connects to and why. Every line on the map has an explanation
              behind it.
            </p>
            <p className="muted small">Select a technology to open its track.</p>
          </>
        )}
      </aside>
    </div>
  );
}
