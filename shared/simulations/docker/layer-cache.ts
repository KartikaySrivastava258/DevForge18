/**
 * Simulation: layer cake and cache (REMAINING_WORK.md §5.2).
 *
 * A Dockerfile is a list of steps the learner can switch on and off and
 * reorder. Building walks the steps in order and reuses a cached result
 * while the step and everything it depends on are unchanged; from the
 * first change on, every later step is rebuilt. The learner edits the
 * source code or the dependency list, rebuilds, and sees which steps were
 * reused, how long the build took, how big the image is and which files
 * ended up in it.
 *
 * Follows Docker's documentation: "Once a layer changes, then all
 * downstream layers need to be rebuilt as well"; order instructions from
 * less to more frequently changed; COPY's cache depends on the files
 * copied; .dockerignore removes files from the build context.
 *
 * Simplified (shown to learners): times and sizes are invented round
 * numbers; the base image is always cached; only three files exist.
 */
import type { SimulationModel, StepResult } from "../types.ts";

export type StepId = "from" | "copyAll" | "copyDeps" | "install" | "copySrc" | "cmd";
export interface StepDef {
  id: StepId;
  text: string;
  /** Files this step copies into the image (COPY steps). */
  copies?: ("deps" | "src" | "secrets")[];
  seconds: number;
  sizeMb: number;
}

export const STEPS: Record<StepId, StepDef> = {
  from: { id: "from", text: "FROM alpine:3.20", seconds: 0, sizeMb: 8 },
  copyAll: { id: "copyAll", text: "COPY . /app/", copies: ["deps", "src", "secrets"], seconds: 1, sizeMb: 2 },
  copyDeps: { id: "copyDeps", text: "COPY requirements.txt /app/", copies: ["deps"], seconds: 1, sizeMb: 0 },
  install: { id: "install", text: "RUN pip install -r /app/requirements.txt", seconds: 45, sizeMb: 120 },
  copySrc: { id: "copySrc", text: "COPY src/ /app/src/", copies: ["src"], seconds: 1, sizeMb: 2 },
  cmd: { id: "cmd", text: 'CMD ["python", "/app/src/main.py"]', seconds: 0, sizeMb: 0 },
};
export const FILE_NAMES = { deps: "requirements.txt", src: "src/", secrets: "secrets.env" } as const;
type FileKey = keyof typeof FILE_NAMES;

export interface Line {
  id: StepId;
  on: boolean;
}

export interface BuildResult {
  ok: boolean;
  error?: string;
  /** Per enabled step: reused from the cache or rebuilt. */
  steps: { id: StepId; cached: boolean }[];
  seconds: number;
  sizeMb: number;
  files: string[];
  /** What was edited since the previous build. */
  changed: FileKey[];
}

export interface LayerState {
  lines: Line[];
  ignoreSecrets: boolean;
  versions: Record<FileKey, number>;
  /** Files edited since the last build. */
  pending: FileKey[];
  /** Cache keys of every step result built so far. */
  cache: string[];
  last: BuildResult | null;
  builds: number;
}

export type LayerAction =
  | { type: "toggle"; id: StepId }
  | { type: "moveUp"; id: StepId }
  | { type: "moveDown"; id: StepId }
  | { type: "setIgnore"; on: boolean }
  | { type: "edit"; file: "src" | "deps" }
  | { type: "build" };

export interface LayerScenario {
  lines: Line[];
  ignoreSecrets: boolean;
  /** Build once before the learner starts (so the cache is warm). */
  prebuilt: boolean;
}

function build(s: LayerState): { state: LayerState; result: BuildResult } {
  const steps: BuildResult["steps"] = [];
  const files = new Set<FileKey>();
  const cache = new Set(s.cache);
  let key = "";
  let broken = false;
  let seconds = 0;
  let sizeMb = 0;
  let error: string | undefined;
  for (const line of s.lines.filter((l) => l.on)) {
    const def = STEPS[line.id];
    const copied = (def.copies ?? []).filter((f) => !(f === "secrets" && s.ignoreSecrets));
    if (line.id === "install" && !files.has("deps")) {
      error = `${def.text} failed: /app/requirements.txt does not exist yet — copy it first.`;
      break;
    }
    key += `|${line.id}:${copied.map((f) => `${f}@${s.versions[f]}`).join(",")}`;
    const cached = !broken && cache.has(key);
    if (!cached) broken = true;
    cache.add(key);
    copied.forEach((f) => files.add(f));
    steps.push({ id: line.id, cached });
    if (!cached) seconds += def.seconds;
    sizeMb += def.sizeMb;
  }
  if (!error && !s.lines.some((l) => l.on && l.id === "from")) error = "A Dockerfile must start FROM a base image.";
  if (!error && s.lines.find((l) => l.on)?.id !== "from") error = "FROM must be the first instruction.";
  if (!error && !files.has("src")) error = "The image has no source code: CMD would fail when the container starts.";
  const result: BuildResult = error
    ? { ok: false, error, steps, seconds, sizeMb, files: [], changed: s.pending }
    : { ok: true, steps, seconds, sizeMb, files: [...files].map((f) => FILE_NAMES[f]).sort(), changed: s.pending };
  return { state: { ...s, cache: [...cache], last: result, builds: s.builds + 1, pending: [] }, result };
}

const refuse = (state: LayerState, error: string): StepResult<LayerState> => ({ state, events: [], error });

function step(s: LayerState, a: LayerAction): StepResult<LayerState> {
  switch (a.type) {
    case "toggle": {
      if (a.id === "from") return refuse(s, "Every Dockerfile needs its FROM line.");
      const lines = s.lines.map((l) => (l.id === a.id ? { ...l, on: !l.on } : l));
      const on = lines.find((l) => l.id === a.id)?.on;
      return { state: { ...s, lines }, events: [`${on ? "Added" : "Removed"} ${STEPS[a.id].text}.`] };
    }
    case "moveUp":
    case "moveDown": {
      const i = s.lines.findIndex((l) => l.id === a.id);
      const j = a.type === "moveUp" ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= s.lines.length) return refuse(s, "It cannot move further.");
      const lines = [...s.lines];
      [lines[i], lines[j]] = [lines[j]!, lines[i]!];
      return { state: { ...s, lines }, events: [`Moved ${STEPS[a.id].text} ${a.type === "moveUp" ? "up" : "down"}.`] };
    }
    case "setIgnore":
      return { state: { ...s, ignoreSecrets: a.on }, events: [a.on ? ".dockerignore now lists secrets.env." : ".dockerignore no longer lists secrets.env."] };
    case "edit":
      return {
        state: { ...s, versions: { ...s.versions, [a.file]: s.versions[a.file] + 1 }, pending: [...new Set([...s.pending, a.file])] as FileKey[] },
        events: [a.file === "src" ? "Edited a line of source code in src/." : "Added a package to requirements.txt."],
      };
    case "build": {
      const { state, result } = build(s);
      if (!result.ok) return { state, events: [`Build ${state.builds} failed: ${result.error}`] };
      const rebuilt = result.steps.filter((x) => !x.cached).map((x) => STEPS[x.id].text);
      return {
        state,
        events: [
          `Build ${state.builds}: ${rebuilt.length ? `rebuilt ${rebuilt.join("; ")}` : "everything reused from the cache"} — ${result.seconds} s, image ${result.sizeMb} MB, files: ${result.files.join(", ")}.${result.files.includes("secrets.env") ? " The image contains secrets.env!" : ""}`,
        ],
      };
    }
  }
}

function init(p: LayerScenario): StepResult<LayerState> {
  let state: LayerState = { lines: p.lines, ignoreSecrets: p.ignoreSecrets, versions: { deps: 1, src: 1, secrets: 1 }, pending: [], cache: [], last: null, builds: 0 };
  if (p.prebuilt) state = build(state).state;
  return { state, events: [`The Dockerfile has ${p.lines.filter((l) => l.on).length} instructions${p.prebuilt ? " and has been built once, so the cache is warm" : ""}.`] };
}

function describe(s: LayerState): string[] {
  const lines = s.lines.map((l, i) => `${i + 1}. ${l.on ? "" : "(off) "}${STEPS[l.id].text}`);
  const last = s.last;
  return [
    "Dockerfile:",
    ...lines,
    `.dockerignore lists secrets.env: ${s.ignoreSecrets ? "yes" : "no"}. Edited since the last build: ${s.pending.length ? s.pending.map((f) => FILE_NAMES[f]).join(", ") : "nothing"}.`,
    last
      ? last.ok
        ? `Last build: ${last.steps.map((x) => `${STEPS[x.id].text} ${x.cached ? "reused" : "rebuilt"}`).join("; ")}. ${last.seconds} s; ${last.sizeMb} MB; files ${last.files.join(", ")}.`
        : `Last build failed: ${last.error}`
      : "Not built yet.",
  ];
}

export const layerCache: SimulationModel<LayerState, LayerAction, LayerScenario> = {
  id: "docker-layer-cache",
  track: "docker",
  init,
  step,
  invariants: [
    { name: "the Dockerfile keeps one line per known step", check: (s) => (new Set(s.lines.map((l) => l.id)).size === s.lines.length ? null : "duplicate steps") },
    {
      name: "after a cache miss, every later step is rebuilt",
      check: (s) => {
        const steps = s.last?.steps ?? [];
        const firstMiss = steps.findIndex((x) => !x.cached);
        return firstMiss < 0 || steps.slice(firstMiss).every((x) => !x.cached) ? null : "a step after a rebuild was reused";
      },
    },
  ],
  checks: {
    /** The last build followed a source-code change only, succeeded, and reused the dependency install. */
    "fast-code-change": (s) =>
      !!s.last?.ok && s.last.changed.length === 1 && s.last.changed[0] === "src" && s.last.steps.some((x) => x.id === "install" && x.cached),
    /** The last build succeeded and the image has the app and its dependencies but no secrets. */
    "no-secrets": (s) => !!s.last?.ok && !s.last.files.includes("secrets.env") && s.last.steps.some((x) => x.id === "install"),
  },
  describe,
};
