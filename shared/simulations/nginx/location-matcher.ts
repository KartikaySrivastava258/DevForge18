/**
 * Simulation: the location matcher (REMAINING_WORK.md §5.14).
 *
 * A server block holds location blocks chosen from a fixed palette; the
 * learner adds, removes and reorders them, and sends request paths. The
 * model applies Nginx's documented matching order and explains the
 * decision: an exact "=" match ends the search; otherwise the longest
 * matching prefix is remembered; if it has "^~", regular expressions are
 * not checked; otherwise regular expressions are tried in file order and
 * the first match wins; if none matches, the remembered prefix is used.
 *
 * The model's results for the lesson's configuration are tested against
 * the answers a real Nginx 1.24 gave in the lesson.
 *
 * Simplified (shown to learners): locations come from a palette rather
 * than free text; no nested locations; no case-insensitive operating
 * systems; the newer "predicate" locations are not modelled.
 */
import type { SimulationModel, StepResult } from "../types.ts";

export type Modifier = "=" | "" | "^~" | "~" | "~*";
export type Target = "app" | "api" | "static" | "health";
export interface LocationDef {
  id: string;
  modifier: Modifier;
  pattern: string;
  target: Target;
}

/** The palette of locations a learner can add (fixed patterns: no user-supplied regular expressions). */
export const PALETTE: readonly LocationDef[] = [
  { id: "exact-root", modifier: "=", pattern: "/", target: "app" },
  { id: "root", modifier: "", pattern: "/", target: "app" },
  { id: "api", modifier: "", pattern: "/api/", target: "api" },
  { id: "api-v1", modifier: "", pattern: "/api/v1/", target: "api" },
  { id: "api-docs", modifier: "", pattern: "/api/docs/", target: "static" },
  { id: "api-docs-stop", modifier: "^~", pattern: "/api/docs/", target: "static" },
  { id: "static-stop", modifier: "^~", pattern: "/static/", target: "static" },
  { id: "static", modifier: "", pattern: "/static/", target: "static" },
  { id: "health", modifier: "=", pattern: "/health", target: "health" },
  { id: "png", modifier: "~", pattern: "\\.png$", target: "static" },
  { id: "html", modifier: "~", pattern: "\\.html$", target: "app" },
  { id: "json", modifier: "~", pattern: "\\.json$", target: "api" },
  { id: "api-json", modifier: "~", pattern: "^/api/.*\\.json$", target: "api" },
  { id: "images-ci", modifier: "~*", pattern: "\\.(gif|jpg|jpeg)$", target: "static" },
];
export const byId = (id: string) => PALETTE.find((l) => l.id === id);
export const label = (l: LocationDef) => `location ${l.modifier ? `${l.modifier} ` : ""}${l.pattern}`;

export interface Match {
  location: string | null;
  steps: string[];
}

/** Nginx's documented matching order (nginx.org, ngx_http_core_module, "location"). */
export function match(locations: readonly string[], path: string): Match {
  const defs = locations.map((id) => byId(id)!).filter(Boolean);
  const steps: string[] = [];
  const exact = defs.find((l) => l.modifier === "=" && l.pattern === path);
  if (exact) return { location: exact.id, steps: [`${label(exact)} matches exactly: the search stops.`] };
  const prefixes = defs.filter((l) => (l.modifier === "" || l.modifier === "^~") && path.startsWith(l.pattern));
  const longest = prefixes.sort((a, b) => b.pattern.length - a.pattern.length)[0];
  steps.push(longest ? `Longest matching prefix: ${label(longest)} (remembered).` : "No prefix location matches.");
  if (longest?.modifier === "^~") return { location: longest.id, steps: [...steps, "It has ^~, so regular expressions are not checked."] };
  for (const l of defs.filter((x) => x.modifier === "~" || x.modifier === "~*")) {
    if (new RegExp(l.pattern, l.modifier === "~*" ? "i" : "").test(path)) return { location: l.id, steps: [...steps, `First matching regular expression, in file order: ${label(l)} — it wins.`] };
  }
  if (longest) return { location: longest.id, steps: [...steps, "No regular expression matches, so the remembered prefix is used."] };
  return { location: null, steps: [...steps, "Nothing matches: Nginx would answer 404."] };
}

export interface MatcherState {
  locations: string[];
  /** Paths the learner has sent, with the chosen location. */
  requests: { path: string; location: string | null }[];
}

export type MatcherAction =
  | { type: "add"; id: string }
  | { type: "remove"; id: string }
  | { type: "moveUp"; id: string }
  | { type: "request"; path: string };

export interface MatcherScenario {
  locations: string[];
}

const refuse = (state: MatcherState, error: string): StepResult<MatcherState> => ({ state, events: [], error });
export const PATH = /^\/[A-Za-z0-9._\/-]{0,60}$/;

function step(s: MatcherState, a: MatcherAction): StepResult<MatcherState> {
  switch (a.type) {
    case "add": {
      const def = byId(a.id);
      if (!def) return refuse(s, "That location is not in the palette.");
      if (s.locations.includes(a.id)) return refuse(s, `${label(def)} is already in the server block.`);
      const clash = s.locations.map((x) => byId(x)!).find((l) => l.pattern === def.pattern && (l.modifier === "" || l.modifier === "^~") === (def.modifier === "" || def.modifier === "^~") && l.modifier !== "=" && def.modifier !== "=");
      if (clash) return refuse(s, `Nginx refuses two prefix locations for the same path (${label(clash)}): duplicate location.`);
      if (s.locations.length >= 10) return refuse(s, "This simulation allows at most 10 locations.");
      return { state: { ...s, locations: [...s.locations, a.id] }, events: [`Added ${label(def)} → ${def.target}.`] };
    }
    case "remove":
      if (!s.locations.includes(a.id)) return refuse(s, "That location is not in the server block.");
      return { state: { ...s, locations: s.locations.filter((x) => x !== a.id) }, events: [`Removed ${label(byId(a.id)!)}.`] };
    case "moveUp": {
      const i = s.locations.indexOf(a.id);
      if (i <= 0) return refuse(s, "It is already first.");
      const locations = [...s.locations];
      [locations[i - 1], locations[i]] = [locations[i]!, locations[i - 1]!];
      return { state: { ...s, locations }, events: [`Moved ${label(byId(a.id)!)} up.`] };
    }
    case "request": {
      if (!PATH.test(a.path)) return refuse(s, "Send a path such as /api/v1/users (letters, digits, . _ - /).");
      const m = match(s.locations, a.path);
      const def = m.location ? byId(m.location)! : null;
      return {
        state: { ...s, requests: [...s.requests.slice(-19), { path: a.path, location: m.location }] },
        events: [`GET ${a.path} → ${def ? `${label(def)} (${def.target})` : "404"}. ${m.steps.join(" ")}`],
      };
    }
  }
}

function init(p: MatcherScenario): StepResult<MatcherState> {
  return { state: { locations: p.locations, requests: [] }, events: [`The server block has ${p.locations.length} locations. Send a request path to see which one answers.`] };
}

function describe(s: MatcherState): string[] {
  return [
    "server {",
    ...s.locations.map((id) => `  ${label(byId(id)!)} → ${byId(id)!.target}`),
    "}",
    ...s.requests.map((r) => `GET ${r.path} → ${r.location ? `${label(byId(r.location)!)} (${byId(r.location)!.target})` : "404"}`),
  ];
}

const targetFor = (s: MatcherState, path: string) => {
  const m = match(s.locations, path);
  return m.location ? byId(m.location)!.target : null;
};

export const locationMatcher: SimulationModel<MatcherState, MatcherAction, MatcherScenario> = {
  id: "nginx-location-matcher",
  track: "nginx",
  init,
  step,
  invariants: [
    { name: "every location is from the palette and appears once", check: (s) => (s.locations.every((id) => byId(id)) && new Set(s.locations).size === s.locations.length ? null : "bad location list") },
  ],
  checks: {
    /** /api/v1/ requests reach the API, but /api/docs/ pages are served statically. */
    "docs-static": (s) =>
      targetFor(s, "/api/v1/users") === "api" && targetFor(s, "/api/v1/report.json") === "api" && targetFor(s, "/api/docs/index.html") === "static" && targetFor(s, "/api/docs/logo.png") === "static" && targetFor(s, "/") === "app",
    /** /health is answered by its own exact location, and every other path still goes where it did. */
    "health-exact": (s) => targetFor(s, "/health") === "health" && targetFor(s, "/healthz") === "app" && targetFor(s, "/api/v1/users") === "api",
  },
  describe,
};
