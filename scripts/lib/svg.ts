/**
 * Strict SVG allowlist for lesson figures (ADR 0007).
 *
 * Figures are inlined into lesson HTML so they can follow the site theme
 * through CSS classes. Inline SVG is markup, so it gets the same treatment
 * as everything else that reaches learners: it is parsed, every element,
 * attribute and value is checked against an allowlist, and the output is
 * re-serialised from the parsed tokens (never copied through). Anything not
 * on the list fails the build with a precise message instead of being
 * silently dropped, so authors see exactly what to change.
 *
 * Rules that keep figures safe under the strict CSP and consistent with the
 * design system:
 *   - no scripts, event handlers, style elements or style attributes;
 *   - no external references: href/url() may only point at #ids in the same figure;
 *   - no hard-coded colours: fill and stroke are none, currentColor or url(#id),
 *     and colour comes from the FIGURE_CLASSES vocabulary styled in components.css;
 *   - ids are prefixed with the figure's key, so several figures can share a page.
 */

/** Classes figures may use; each is styled from the design tokens in both themes. */
export const FIGURE_CLASSES = [
  "f-box", "f-box-accent", "f-box-ok", "f-box-warn", "f-box-danger", "f-box-faint",
  "f-line", "f-line-accent", "f-arrow", "f-arrow-accent", "f-dashed", "f-head", "f-head-accent",
  "f-text", "f-muted", "f-faint", "f-accent", "f-ok", "f-warn", "f-danger",
  "f-small", "f-large", "f-strong", "f-mono", "f-dot", "f-dot-accent",
] as const;
const CLASS_SET = new Set<string>(FIGURE_CLASSES);

const NUMBER = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;
const NUMBER_LIST = /^[-0-9.,\s]+$/;
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/;
const TRANSFORM = /^(?:\s*(?:translate|rotate|scale)\([-0-9.,\s]+\)\s*)+$/;
const ID = /^[a-z][a-z0-9-]*$/;
const LOCAL_REF = /^url\(#([a-z][a-z0-9-]*)\)$/;

type Check = (value: string) => boolean;
const num: Check = (v) => NUMBER.test(v.trim());
const oneOf = (...values: string[]): Check => (v) => values.includes(v.trim());

/** Attributes allowed on every element, with the check for their value. */
const COMMON: Record<string, Check> = {
  id: (v) => ID.test(v),
  class: (v) => v.trim().split(/\s+/).every((c) => CLASS_SET.has(c)),
  transform: (v) => TRANSFORM.test(v),
  "data-step": (v) => /^[1-9]\d?$/.test(v),
  "data-until": (v) => /^[1-9]\d?$/.test(v),
  fill: (v) => v === "none" || v === "currentColor" || LOCAL_REF.test(v),
  stroke: (v) => v === "none" || v === "currentColor",
  "stroke-width": num,
  "stroke-dasharray": (v) => NUMBER_LIST.test(v),
  "stroke-linecap": oneOf("butt", "round", "square"),
  "stroke-linejoin": oneOf("miter", "round", "bevel"),
  opacity: num,
  "fill-opacity": num,
};
const MARKERS: Record<string, Check> = { "marker-start": (v) => LOCAL_REF.test(v), "marker-end": (v) => LOCAL_REF.test(v) };
const TEXT: Record<string, Check> = {
  "text-anchor": oneOf("start", "middle", "end"),
  "dominant-baseline": oneOf("auto", "middle", "central", "hanging"),
  "font-size": num,
  "font-weight": oneOf("400", "500", "600", "normal", "bold"),
  "font-style": oneOf("normal", "italic"),
};

const geometry = (...names: string[]): Record<string, Check> => Object.fromEntries(names.map((n) => [n, num]));

/** Element → its own allowed attributes (in addition to COMMON). */
const ELEMENTS: Record<string, Record<string, Check>> = {
  svg: { xmlns: oneOf("http://www.w3.org/2000/svg"), viewBox: (v) => NUMBER_LIST.test(v) && v.trim().split(/[\s,]+/).length === 4, width: num, height: num },
  g: { ...TEXT },
  defs: {},
  marker: { viewBox: (v) => NUMBER_LIST.test(v), refX: num, refY: num, markerWidth: num, markerHeight: num, orient: oneOf("auto", "auto-start-reverse"), markerUnits: oneOf("strokeWidth", "userSpaceOnUse") },
  path: { d: (v) => PATH_DATA.test(v), ...MARKERS },
  rect: geometry("x", "y", "width", "height", "rx", "ry"),
  circle: geometry("cx", "cy", "r"),
  ellipse: geometry("cx", "cy", "rx", "ry"),
  line: { ...geometry("x1", "y1", "x2", "y2"), ...MARKERS },
  polyline: { points: (v) => NUMBER_LIST.test(v), ...MARKERS },
  polygon: { points: (v) => NUMBER_LIST.test(v) },
  text: { ...geometry("x", "y", "dx", "dy"), ...TEXT },
  tspan: { ...geometry("x", "y", "dx", "dy"), ...TEXT },
};
const TEXT_ELEMENTS = new Set(["text", "tspan"]);

export interface SvgResult {
  /** Re-serialised markup of the root's children (ids prefixed), ready to inline. */
  inner: string;
  viewBox: string;
  /** Distinct data-step and data-until values used, for step-diagram validation. */
  stepValues: number[];
  untilValues: number[];
}

interface Node {
  name: string;
  attrs: [string, string][];
  children: (Node | string)[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decode(text: string, where: () => string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (whole, ent: string) => {
    if (!whole.endsWith(";")) throw new Error(`${where()}: "&" must start an entity such as &amp;`);
    if (ent.startsWith("#x") || ent.startsWith("#X")) return String.fromCodePoint(parseInt(ent.slice(2), 16));
    if (ent.startsWith("#")) return String.fromCodePoint(parseInt(ent.slice(1), 10));
    const value = ENTITIES[ent];
    if (value === undefined) throw new Error(`${where()}: unknown entity &${ent};`);
    return value;
  });
}

const esc = (v: string) => v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** Parse with a deliberately small XML subset: elements, quoted attributes, text, comments. */
function parse(source: string): Node {
  let i = 0;
  const line = () => source.slice(0, i).split("\n").length;
  const where = () => `line ${line()}`;
  const stack: Node[] = [];
  let root: Node | undefined;
  const src = source.replace(/^\uFEFF/, "");
  while (i < src.length) {
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      if (end === -1) throw new Error(`${where()}: unterminated comment`);
      i = end + 3;
      continue;
    }
    if (src.startsWith("<?xml", i)) {
      if (root || stack.length) throw new Error(`${where()}: XML declaration must come first`);
      const end = src.indexOf("?>", i);
      if (end === -1) throw new Error(`${where()}: unterminated XML declaration`);
      i = end + 2;
      continue;
    }
    if (src.startsWith("<!", i) || src.startsWith("<?", i)) throw new Error(`${where()}: DOCTYPE, CDATA and processing instructions are not allowed`);
    if (src.startsWith("</", i)) {
      const m = /^<\/([a-zA-Z][\w:-]*)\s*>/.exec(src.slice(i));
      if (!m) throw new Error(`${where()}: malformed closing tag`);
      const open = stack.pop();
      if (!open || open.name !== m[1]) throw new Error(`${where()}: </${m[1]}> does not match <${open?.name ?? "nothing"}>`);
      if (stack.length === 0) root = open;
      i += m[0].length;
      continue;
    }
    if (src[i] === "<") {
      const m = /^<([a-zA-Z][\w:-]*)((?:\s+[a-zA-Z][\w:-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/.exec(src.slice(i));
      if (!m) throw new Error(`${where()}: malformed tag (attribute values must be quoted)`);
      const name = m[1] ?? "";
      const attrs: [string, string][] = [];
      for (const a of (m[2] ?? "").matchAll(/([a-zA-Z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        const key = a[1] ?? "";
        if (attrs.some(([k]) => k === key)) throw new Error(`${where()}: duplicate attribute ${key}`);
        attrs.push([key, decode(a[2] ?? a[3] ?? "", where)]);
      }
      const node: Node = { name, attrs, children: [] };
      if (stack.length) stack[stack.length - 1]!.children.push(node);
      else if (root) throw new Error(`${where()}: content after the root <svg> element`);
      if (m[3] === "/") {
        if (stack.length === 0) root = node;
      } else stack.push(node);
      i += m[0].length;
      continue;
    }
    const next = src.indexOf("<", i);
    const text = src.slice(i, next === -1 ? undefined : next);
    if (text.trim()) {
      if (!stack.length) throw new Error(`${where()}: text outside the root element`);
      stack[stack.length - 1]!.children.push(decode(text, where));
    }
    i = next === -1 ? src.length : next;
  }
  if (stack.length) throw new Error(`<${stack[stack.length - 1]!.name}> is never closed`);
  if (!root) throw new Error("no root element");
  return root;
}

/**
 * Validate an SVG figure and return safe, re-serialised markup.
 * `prefix` (for example "git-github-three-areas") is prepended to every id.
 * Throws an Error describing the first problem found.
 */
export function sanitizeSvg(source: string, prefix: string): SvgResult {
  const root = parse(source);
  if (root.name !== "svg") throw new Error(`root element must be <svg>, found <${root.name}>`);
  const viewBox = root.attrs.find(([k]) => k === "viewBox")?.[1];
  if (!viewBox) throw new Error("<svg> needs a viewBox so it can scale");

  const ids = new Set<string>();
  const refs: string[] = [];
  const steps = new Set<number>();
  const untils = new Set<number>();
  const collect = (node: Node) => {
    for (const [k, v] of node.attrs) {
      if (k === "id") {
        if (ids.has(v)) throw new Error(`duplicate id "${v}"`);
        ids.add(v);
      }
      const ref = LOCAL_REF.exec(v);
      if (ref && k !== "id") refs.push(ref[1] ?? "");
    }
    node.children.forEach((c) => typeof c !== "string" && collect(c));
  };
  collect(root);
  for (const ref of refs) if (!ids.has(ref)) throw new Error(`url(#${ref}) points at an id that does not exist in this figure`);

  const serialise = (node: Node, path: string): string => {
    const allowed = ELEMENTS[node.name];
    const here = path ? `${path} > ${node.name}` : node.name;
    if (!allowed) throw new Error(`${here}: element <${node.name}> is not allowed in figures`);
    const out: string[] = [];
    for (const [k, v] of node.attrs) {
      const check = allowed[k] ?? COMMON[k];
      if (!check) {
        const hint = k === "style" ? " (use a class from the figure vocabulary; the CSP forbids inline styles)" : /^on/i.test(k) ? " (event handlers are never allowed)" : "";
        throw new Error(`${here}: attribute ${k} is not allowed${hint}`);
      }
      if (!check(v)) {
        const hint = k === "fill" || k === "stroke" ? " (colours come from classes such as f-box or f-accent, so figures work in both themes)" : k === "class" ? ` (allowed classes: ${FIGURE_CLASSES.join(", ")})` : "";
        throw new Error(`${here}: ${k}="${v}" is not allowed${hint}`);
      }
      if (node === root && k !== "viewBox") continue; // the root is rebuilt by the renderer
      if (k === "data-step") steps.add(Number(v));
      if (k === "data-until") untils.add(Number(v));
      const value = k === "id" ? `${prefix}-${v}` : LOCAL_REF.test(v) ? v.replace(LOCAL_REF, (_m, id: string) => `url(#${prefix}-${id})`) : v;
      out.push(` ${k}="${esc(value)}"`);
    }
    const children = node.children
      .map((c) => {
        if (typeof c === "string") {
          if (!TEXT_ELEMENTS.has(node.name)) throw new Error(`${here}: text is only allowed inside <text> or <tspan>`);
          return esc(c.replace(/\s+/g, " "));
        }
        return serialise(c, here);
      })
      .join("");
    if (node === root) return children;
    return `<${node.name}${out.join("")}>${children}</${node.name}>`;
  };
  const inner = serialise(root, "");
  return { inner, viewBox: viewBox.trim(), stepValues: [...steps].sort((a, b) => a - b), untilValues: [...untils].sort((a, b) => a - b) };
}
