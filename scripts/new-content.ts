/**
 * Scaffolds a new lesson or lab so writing can start immediately:
 *
 *   npm run new:lesson -- <track> <id>
 *   npm run new:lab -- <track> <id> [local|simulation|read-through]
 *   npm run new:quiz -- <track> <id>
 *   npm run new:project -- <track> <id> [beginner|intermediate|advanced]
 *
 * The file has schema-shaped front matter, the standard section headings, a figure reference and a figure
 * script stub (scripts/figures/<track>/<id>.py), and verification "pending". Every placeholder is marked
 * TODO(scaffold), and the content build rejects any file that still contains that marker, so an unfinished
 * scaffold can never be published. Projects also get starter/ and solution/ folders with a README each.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadContent } from "./lib/content-loader.ts";

const [kind, track, id, mode = "local"] = process.argv.slice(2);
const root = join(import.meta.dirname, "..");
const usage =
  "usage: npm run new:lesson -- <track> <id> | new:lab -- <track> <id> [local|simulation|read-through] | new:quiz -- <track> <id> | new:project -- <track> <id> [beginner|intermediate|advanced]";
if (!kind || !track || !id || !["lesson", "lab", "quiz", "project"].includes(kind)) {
  console.error(usage);
  process.exit(2);
}
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
  console.error(`id must be lowercase words joined by hyphens: ${id}`);
  process.exit(2);
}
const { bundle } = loadContent(join(root, "content"));
if (!bundle.tracks.some((t) => t.slug === track)) {
  console.error(`unknown track "${track}"; tracks: ${bundle.tracks.map((t) => t.slug).join(", ")}`);
  process.exit(2);
}
const today = new Date().toISOString().slice(0, 10);
const trackLessons = bundle.lessons.filter((l) => l.track === track).sort((a, b) => a.order - b.order);
const last = trackLessons.at(-1);
const T = "TODO(scaffold)";

const resource = `resources:
  - title: ${T} official page title
    url: https://example.org/${T}
    publisher: ${T}
    type: documentation
    level: intermediate
    official: true
    why: ${T} what this source confirms
    verification: { status: verified, checked_on: ${today} }`;
const question = (n: number) => `  - id: question-${n}
    prompt: ${T} a question about a real situation?
    options:
      - { id: a, text: "${T} a plausible wrong answer" }
      - { id: b, text: "${T} the right answer" }
      - { id: c, text: "${T} another plausible wrong answer" }
    answer: b
    explanation: ${T} why b is right and the others are not.`;

let file: string;
let text: string;
if (kind === "lesson") {
  file = join(root, "content", "lessons", track, `${id}.md`);
  text = `---
id: ${id}
title: ${T} title
track: ${track}
order: ${(last?.order ?? 0) + 1}
level: intermediate
estimated_minutes: 40
prerequisites: [${last?.id ?? ""}]
learning_objectives:
  - ${T} what the learner will be able to do, as a verb phrase.
${resource}
self_check:
${question(1)}
${question(2)}
${question(3)}
verification:
  method: pending
  details: ${T} how the commands are run (tool versions) and which claims were checked against which sources.
owner: content-team
last_reviewed: ${today}
content_version: 1
---

## The idea in one sentence

${T}

## Explain it like I'm twelve

${T}

Where the analogy breaks: ${T}

## What problem it solves

${T}

## How it works

![](media:${track}/${id}.svg)

- ${T}

## Try it yourself

> **Local lab** — ${T} what is needed. Every command is run automatically in DevForge's tests.

### 1. ${T}

\`\`\`bash run
echo "${T}"
\`\`\`

## Common mistakes

- ${T}

## Where this fits in a real system

${T}
`;
} else if (kind === "quiz") {
  file = join(root, "content", "quizzes", track, `${id}.yaml`);
  const q = (n: number, level: string) => `  - id: question-${n}
    type: single
    level: ${level}
    lesson: ${trackLessons.find((l) => l.level === level)?.id ?? last?.id ?? T}
    prompt: ${T} question ${n}?
    options:
      - { id: a, text: "${T}" }
      - { id: b, text: "${T}" }
    answer: a
    explanation: ${T} why the answer is right.`;
  text = `id: ${id}
track: ${track}
title: ${T} title
description: ${T} one or two sentences on what the quiz covers.
pass_mark: 0.75
owner: content-team
last_reviewed: ${today}
content_version: 1
# Types: single, multiple (answers: [..]), ordering (items + order), matching (left, right, pairs),
# output (command + output + options + answer), diagram (media + targets + labels + answers). See git-github-quiz.yaml.
questions:
${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => q(n, ["beginner", "intermediate", "advanced"][(n - 1) % 3] ?? "beginner")).join("\n")}
`;
} else if (kind === "project") {
  const level = ["beginner", "intermediate", "advanced"].includes(mode) ? mode : "intermediate";
  file = join(root, "content", "projects", track, `${id}.md`);
  text = `---
id: ${id}
track: ${track}
title: ${T} title (must equal the planned project's title in track.yaml)
level: ${level}
estimated_hours: 6
prerequisites: [${last?.id ?? ""}]
related_tracks: []
user_stories:
  - As a ${T}, I want ${T} so that ${T}.
  - As a ${T}, I want ${T} so that ${T}.
acceptance_criteria:
  - ${T} a statement someone can check.
  - ${T} a statement someone can check.
  - ${T} a statement someone can check.
rubric:
  - { criterion: "${T}", excellent: "${T} what excellent looks like", good: "${T} what good looks like", needs_work: "${T} what needs work looks like" }
  - { criterion: "${T}", excellent: "${T} what excellent looks like", good: "${T} what good looks like", needs_work: "${T} what needs work looks like" }
  - { criterion: "${T}", excellent: "${T} what excellent looks like", good: "${T} what good looks like", needs_work: "${T} what needs work looks like" }
hints:
  - ${T} a first, gentle hint.
  - ${T} a more specific hint.
stretch_goals:
  - ${T} something extra.
starter: starter
solution: solution
owner: content-team
last_reviewed: ${today}
content_version: 1
---

## Brief

${T}

## Getting started

${T}
`;
  for (const folder of ["starter", "solution"]) {
    const dir = join(root, "content", "projects", track, id, folder);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "README.md"), `# ${T} ${folder} for ${id}\n`);
      console.log(`created content/projects/${track}/${id}/${folder}/README.md`);
    }
  }
} else {
  if (!["local", "simulation", "read-through"].includes(mode)) {
    console.error(usage);
    process.exit(2);
  }
  file = join(root, "content", "labs", track, `${id}.md`);
  text = `---
id: ${id}
title: ${T} title
track: ${track}
level: intermediate
mode: ${mode}
estimated_minutes: 45
prerequisites: [${last?.id ?? ""}]
objectives:
  - ${T} what the learner will be able to do.
checkpoints:
  - { id: first-checkpoint, text: "${T} something the learner can see or check" }
${mode === "simulation" ? `simulation: { id: ${T}, challenges: [${T}] }\n` : ""}${mode === "read-through" ? `questions:\n${question(1)}\n${question(2)}\n` : ""}${resource}
verification:
  method: pending
  details: ${T} how the lab is verified.
owner: content-team
last_reviewed: ${today}
content_version: 1
---

## Goal

${T}

## Steps

${mode === "local" ? `\`\`\`bash run\necho "${T}"\n\`\`\`\n\nThe check script below must report FAIL in an empty folder and PASS after the steps:\n\n\`\`\`bash run check\necho "FAIL: ${T}"; exit 1\n\`\`\`` : T}

## Reset

${T}
`;
}

if (existsSync(file)) {
  console.error(`${file} already exists`);
  process.exit(1);
}
mkdirSync(join(file, ".."), { recursive: true });
writeFileSync(file, text);
console.log(`created ${file.slice(root.length + 1)}`);

if (kind === "lesson") {
  const fig = join(root, "scripts", "figures", track, `${id}.py`);
  if (!existsSync(fig)) {
    mkdirSync(join(fig, ".."), { recursive: true });
    writeFileSync(
      fig,
      `"""Figure for ${id}; run: python3 scripts/figures/${track}/${id}.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 260, "${T} one-line note on what the figure shows.")
f.box(10, 80, 200, 80, "f-box"); f.text(110, 124, "${T}", "f-small f-strong", fit=190)
write(ROOT, "${track}", "${id}", f,
      "${T} full text alternative describing everything the figure shows.",
      "${T} one-sentence caption.")
`,
    );
    console.log(`created scripts/figures/${track}/${id}.py — edit it, then run it to write content/media/${track}/${id}.svg`);
  }
}
console.log("Replace every TODO(scaffold); the content build refuses files that still contain one.");
