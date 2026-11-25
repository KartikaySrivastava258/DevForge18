/**
 * Figures and step-through diagrams for lessons (REMAINING_WORK.md §4.2, ADR 0007).
 *
 *   content/media/<track>/<name>.svg         the drawing (strict SVG subset, see svg.ts)
 *   content/media/<track>/<name>.yaml        sidecar: alt text, caption, credit, licence
 *   content/media/<track>/<name>.steps.yaml  optional step-through over one of the figures
 *
 * Lessons reference them as ![](media:<track>/<name>.svg) and
 * ```diagram steps=<track>/<name>``` (an empty fence). Both render to static
 * HTML at build time; the lesson page adds Previous/Next/Play controls to
 * step-throughs (web/src/components/StepDiagram.tsx).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { MediaMetaSchema, StepDiagramSchema, type MediaMeta, type StepDiagram } from "../../shared/content-schema.ts";
import { escapeHtml, type MediaResolver } from "./markdown.ts";
import { sanitizeSvg, type SvgResult } from "./svg.ts";
import { parseYaml } from "./yaml.ts";

interface Figure {
  key: string;
  meta: MediaMeta;
  svg: SvgResult;
}

interface Diagram {
  key: string;
  def: StepDiagram;
  figure: Figure;
}

export interface MediaLibrary {
  figures: Map<string, Figure>;
  diagrams: Map<string, Diagram>;
}

const domId = (key: string) => key.replace(/[^a-z0-9]+/g, "-");

/** Load and validate everything under content/media. Problems are pushed to `errors`. */
export function loadMedia(root: string, trackSlugs: Set<string>, errors: string[]): MediaLibrary {
  const lib: MediaLibrary = { figures: new Map(), diagrams: new Map() };
  const mediaDir = join(root, "media");
  if (!existsSync(mediaDir)) return lib;
  const stepFiles: [string, string][] = [];

  for (const track of readdirSync(mediaDir).sort()) {
    const dir = join(mediaDir, track);
    if (track.startsWith(".") || !statSync(dir).isDirectory()) continue;
    if (!trackSlugs.has(track)) errors.push(`media/${track}: no track with this slug`);
    const files = readdirSync(dir).filter((f) => !f.startsWith(".")).sort();
    for (const file of files) {
      const rel = relative(root, join(dir, file));
      if (file.endsWith(".steps.yaml")) {
        stepFiles.push([track, file]);
        continue;
      }
      if (file.endsWith(".yaml")) {
        if (!files.includes(file.replace(/\.yaml$/, ".svg"))) errors.push(`${rel}: sidecar without a matching .svg`);
        continue;
      }
      if (!file.endsWith(".svg")) {
        errors.push(`${rel}: only .svg figures (with a .yaml sidecar) are supported`);
        continue;
      }
      const name = file.replace(/\.svg$/, "");
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) errors.push(`${rel}: file name must be kebab-case`);
      const sidecar = join(dir, `${name}.yaml`);
      if (!existsSync(sidecar)) {
        errors.push(`${rel}: missing sidecar ${name}.yaml (alt text, caption, credit, licence)`);
        continue;
      }
      let raw: unknown;
      try {
        raw = parseYaml(readFileSync(sidecar, "utf8"), sidecar);
      } catch (err) {
        errors.push(`${relative(root, sidecar)}: invalid YAML — ${(err as Error).message.split("\n")[0]}`);
        continue;
      }
      const meta = MediaMetaSchema.safeParse(raw);
      if (!meta.success) {
        errors.push(...meta.error.issues.map((i) => `${relative(root, sidecar)}: ${i.path.join(".") || "(root)"} — ${i.message}`));
        continue;
      }
      const key = `${track}/${name}`;
      try {
        lib.figures.set(key, { key, meta: meta.data, svg: sanitizeSvg(readFileSync(join(dir, file), "utf8"), domId(key)) });
      } catch (err) {
        errors.push(`${rel}: ${(err as Error).message}`);
      }
    }
  }

  for (const [track, file] of stepFiles) {
    const path = join(mediaDir, track, file);
    const rel = relative(root, path);
    let raw: unknown;
    try {
      raw = parseYaml(readFileSync(path, "utf8"), path);
    } catch (err) {
      errors.push(`${rel}: invalid YAML — ${(err as Error).message.split("\n")[0]}`);
      continue;
    }
    const parsed = StepDiagramSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push(...parsed.error.issues.map((i) => `${rel}: ${i.path.join(".") || "(root)"} — ${i.message}`));
      continue;
    }
    const def = parsed.data;
    const figure = lib.figures.get(`${track}/${def.figure.replace(/\.svg$/, "")}`);
    if (!figure) {
      errors.push(`${rel}: figure "${def.figure}" not found in media/${track} (or it is invalid)`);
      continue;
    }
    const n = def.steps.length;
    const { stepValues, untilValues } = figure.svg;
    for (const v of stepValues) if (v > n) errors.push(`${rel}: ${def.figure} uses data-step="${v}" but there are only ${n} steps`);
    for (const v of untilValues) if (v >= n) errors.push(`${rel}: ${def.figure} uses data-until="${v}", so the element would never be hidden (last step is ${n})`);
    // Every step after the first must change the picture, otherwise it is only text.
    for (let k = 2; k <= n; k++) {
      if (!stepValues.includes(k) && !untilValues.includes(k - 1)) errors.push(`${rel}: step ${k} changes nothing in ${def.figure} (add data-step="${k}" or data-until="${k - 1}" to an element)`);
    }
    const key = `${track}/${file.replace(/\.steps\.yaml$/, "")}`;
    lib.diagrams.set(key, { key, def, figure });
  }
  return lib;
}

function svgElement(figure: Figure, titleId: string, title: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${escapeHtml(figure.svg.viewBox)}" class="figure__svg" role="img" aria-labelledby="${titleId}">` +
    `<title id="${titleId}">${escapeHtml(title)}</title>${figure.svg.inner}</svg>`
  );
}

function scrollBox(svg: string): string {
  // Figures keep a minimum width so their text stays readable; on narrow screens the
  // figure (not the page) scrolls sideways, so the scroll area must be keyboard-focusable.
  return `<div class="figure__scroll" tabindex="0" role="group" aria-label="Figure; scroll sideways if it is cut off">${svg}</div>`;
}

function credit(meta: MediaMeta): string {
  if (meta.licence === "project-content") return "";
  return ` <span class="figure__credit">Credit: <a href="${escapeHtml(meta.source_url ?? "")}" rel="noopener noreferrer" target="_blank">${escapeHtml(meta.credit)}<span class="sr-only"> (opens in a new tab)</span></a>, ${escapeHtml(meta.licence)}.</span>`;
}

/**
 * A resolver for one lesson. It records which media were used (so unused
 * files can be reported) and refuses to put the same figure on a page twice,
 * which would duplicate its element ids.
 */
export function mediaResolver(lib: MediaLibrary, used: Set<string>): MediaResolver {
  const onPage = new Set<string>();
  const once = (figure: Figure) => {
    if (onPage.has(figure.key)) throw new Error(`figure ${figure.key} appears twice in this lesson (directly or through a step-through)`);
    onPage.add(figure.key);
  };
  return {
    figure(ref, alt, caption) {
      const m = /^([a-z0-9-]+)\/([a-z0-9-]+)\.svg$/.exec(ref);
      if (!m) throw new Error(`media reference "${ref}" must look like media:<track>/<name>.svg`);
      const figure = lib.figures.get(`${m[1]}/${m[2]}`);
      if (!figure) throw new Error(`unknown figure media:${ref} (expected content/media/${ref} with a .yaml sidecar)`);
      if (figure.svg.untilValues.length) throw new Error(`media:${ref} hides elements with data-until, so it only makes sense as a step-through; use a \`\`\`diagram steps= fence`);
      once(figure);
      used.add(`figure:${figure.key}`);
      const id = domId(figure.key);
      return (
        `<figure class="figure" id="figure-${id}">${scrollBox(svgElement(figure, `${id}-title`, alt || figure.meta.alt))}` +
        `<figcaption>${escapeHtml(caption || figure.meta.caption)}${credit(figure.meta)}</figcaption></figure>\n`
      );
    },
    stepDiagram(ref) {
      const diagram = lib.diagrams.get(ref);
      if (!diagram) throw new Error(`unknown step-through "${ref}" (expected content/media/${ref}.steps.yaml)`);
      once(diagram.figure);
      used.add(`diagram:${diagram.key}`);
      used.add(`figure:${diagram.figure.key}`);
      const id = domId(diagram.figure.key);
      const { def } = diagram;
      const steps = def.steps.map((s) => `<li>${escapeHtml(s.caption)}</li>`).join("");
      return (
        `<figure class="figure step-diagram" id="steps-${domId(diagram.key)}" data-step-diagram data-steps="${def.steps.length}">` +
        scrollBox(svgElement(diagram.figure, `${id}-title`, `${def.title}. ${diagram.figure.meta.alt}`)) +
        `<div class="step-diagram__controls" data-controls></div>` +
        `<figcaption><strong class="figure__title">${escapeHtml(def.title)}</strong>${credit(diagram.figure.meta)}` +
        `<details class="step-diagram__all"><summary>All ${def.steps.length} steps as text</summary><ol>${steps}</ol></details></figcaption></figure>\n`
      );
    },
  };
}
