import { levelLabel } from "../lib/format.ts";

export function LevelTag({ level }: { level: string }) {
  return <span className={`tag tag--${level}`}>{levelLabel(level)}</span>;
}

const MODE_LABEL: Record<string, string> = {
  local: "Runs on your machine",
  simulation: "Browser simulation",
  "read-through": "Read-through",
};

export function ModeTag({ mode }: { mode: string | undefined }) {
  if (!mode) return null;
  return <span className={`tag${mode === "simulation" ? " tag--sim" : ""}`}>{MODE_LABEL[mode] ?? mode}</span>;
}
