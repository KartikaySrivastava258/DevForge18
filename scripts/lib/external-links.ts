/**
 * Every external link in the compiled content, with where it is used and, for listed resources, the
 * verification status the content declares. Used by the link checker (scripts/check-links.ts) and the
 * release audit (scripts/content-audit.ts).
 *
 * Collected: link fields (`url`, `source_url`, `licence_source`) anywhere in the bundle, and the `href` of every
 * link in rendered HTML (lesson, lab, project, capstone and architecture bodies, quiz figures). Links to this
 * machine or to reserved example domains are left out: they are commands for the learner, not references.
 */
import type { ContentBundle } from "../../shared/content-schema.ts";

export interface ExternalLink {
  url: string;
  usedBy: string[];
  /** The status declared in the content for a listed resource; undefined for links in prose. */
  declared?: "verified" | "unverified" | "broken";
}

const LINK_FIELDS = new Set(["url", "source_url", "licence_source"]);
const HREF = /href="(https?:\/\/[^"]+)"/g;

function isLocal(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || /(^|\.)example\.(com|org|net|edu)$/.test(host) || host.endsWith(".localhost");
  } catch {
    return true;
  }
}

const unescapeHtml = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

export function externalLinks(bundle: ContentBundle): ExternalLink[] {
  const links = new Map<string, ExternalLink>();
  const add = (url: string, where: string, declared?: ExternalLink["declared"]) => {
    if (isLocal(url)) return;
    const link = links.get(url) ?? { url, usedBy: [] };
    if (!link.usedBy.includes(where)) link.usedBy.push(where);
    // The weakest declaration wins: a URL declared broken or unverified anywhere is reported.
    const rank = { broken: 0, unverified: 1, verified: 2 } as const;
    if (declared && (!link.declared || rank[declared] < rank[link.declared])) link.declared = declared;
    links.set(url, link);
  };
  const walk = (value: unknown, where: string): void => {
    if (typeof value === "string") {
      if (value.includes("href=")) for (const m of value.matchAll(HREF)) add(unescapeHtml(m[1] ?? ""), where);
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) walk(v, where);
      return;
    }
    if (!value || typeof value !== "object") return;
    const obj = value as Record<string, unknown>;
    const verification = obj.verification as { status?: ExternalLink["declared"] } | undefined;
    for (const [key, v] of Object.entries(obj)) {
      if (LINK_FIELDS.has(key) && typeof v === "string" && /^https?:\/\//.test(v)) {
        // A resource declares its status; case-study claims and alternatives carry a checked_on date instead.
        const declared = key === "url" && verification?.status ? verification.status : "checked_on" in obj || "alternatives" in obj ? "verified" : undefined;
        add(v, where, declared);
      } else {
        walk(v, where);
      }
    }
  };
  for (const t of bundle.tracks) {
    walk({ ...t, alternatives: undefined }, `track ${t.slug}`);
    for (const a of t.alternatives ?? []) {
      // alternatives.yaml has one checked_on date for the file.
      if (a.url) add(a.url, `alternative ${a.name} (${t.slug})`, t.alternatives_checked_on ? "verified" : "unverified");
      if (a.licence_source) add(a.licence_source, `licence of ${a.name} (${t.slug})`, t.alternatives_checked_on ? "verified" : "unverified");
    }
  }
  const groups: [string, readonly ({ id: string } | { slug: string })[]][] = [
    ["path", bundle.paths],
    ["lesson", bundle.lessons],
    ["simulation", bundle.simulations],
    ["case study", bundle.case_studies],
    ["lab", bundle.labs],
    ["quiz", bundle.quizzes],
    ["project", bundle.projects],
    ["capstone", bundle.capstones],
    ["integration", bundle.integrations],
    ["architecture", bundle.architectures],
  ];
  for (const [kind, items] of groups) for (const item of items) walk(item, `${kind} ${"id" in item ? item.id : item.slug}`);
  return [...links.values()].sort((a, b) => a.url.localeCompare(b.url));
}
