/**
 * Small, dependency-free full-text search over the content bundle.
 *
 * - Inverted index from normalised tokens to (document, field weight).
 * - Query tokens match exactly, by prefix, or fuzzily (bounded edit distance)
 *   so "kuberntes" still finds Kubernetes.
 * - Synonyms expand abbreviations students actually type ("k8s", "pg", "otel").
 * - AND semantics first (every query word must match); falls back to OR so a
 *   long query with one unknown word still returns something useful.
 *
 * The corpus is small (hundreds to low thousands of documents), so an
 * in-memory index is fast and avoids running a separate search service.
 */
import type { ContentBundle } from "./content-schema.ts";

export type SearchDocType = "track" | "path" | "lesson" | "topic";

export interface SearchDoc {
  type: SearchDocType;
  id: string;
  title: string;
  url: string;
  snippet: string;
  /** Short label for grouping, such as the parent track's name. */
  context: string;
  fields: { text: string; weight: number }[];
}

export interface SearchHit {
  type: SearchDocType;
  id: string;
  title: string;
  url: string;
  snippet: string;
  context: string;
  score: number;
}

interface Posting {
  doc: number;
  weight: number;
}

export interface SearchIndex {
  docs: SearchDoc[];
  postings: Map<string, Posting[]>;
  vocabulary: string[];
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "i", "in", "is", "it",
  "of", "on", "or", "the", "to", "what", "when", "why", "with", "do", "does", "my", "vs",
]);

/** Query-side synonyms: each key also searches for the listed terms. */
export const SYNONYMS: Record<string, string[]> = {
  k8s: ["kubernetes"],
  kube: ["kubernetes"],
  kubectl: ["kubernetes", "kubectl"],
  pg: ["postgresql"],
  postgres: ["postgresql"],
  psql: ["postgresql", "psql"],
  sql: ["sql", "postgresql"],
  db: ["database", "postgresql"],
  gha: ["github", "actions"],
  ci: ["ci", "pipeline", "actions", "jenkins"],
  cd: ["cd", "delivery", "deployment"],
  cicd: ["ci", "cd", "pipeline"],
  otel: ["opentelemetry"],
  tracing: ["traces", "opentelemetry"],
  tf: ["terraform"],
  iac: ["infrastructure", "terraform"],
  llm: ["llm", "langchain", "llamaindex"],
  rag: ["retrieval", "rag"],
  ml: ["machine", "learning", "mlflow"],
  mlops: ["mlflow", "mlops"],
  container: ["container", "docker"],
  containers: ["containers", "docker"],
  vcs: ["version", "control", "git"],
  cache: ["cache", "caching", "redis"],
  queue: ["queue", "kafka"],
  streaming: ["streaming", "kafka"],
  proxy: ["proxy", "nginx"],
  api: ["api", "postman"],
  dag: ["dag", "airflow"],
  metrics: ["metrics", "prometheus"],
  dashboard: ["dashboard", "dashboards", "grafana"],
  automation: ["automation", "n8n"],
  scrum: ["scrum", "jira"],
  kanban: ["kanban", "jira"],
};

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

/** Optimal-string-alignment distance with an upper bound; returns bound+1 when exceeded. */
export function boundedEditDistance(a: string, b: string, bound: number): number {
  if (Math.abs(a.length - b.length) > bound) return bound + 1;
  const prevPrev: number[] = new Array(b.length + 1).fill(0);
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, (prevPrev[j - 2] ?? 0) + 1);
      }
      curr[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > bound) return bound + 1;
    for (let j = 0; j <= b.length; j++) prevPrev[j] = prev[j] ?? 0;
    prev = curr;
  }
  return prev[b.length] ?? bound + 1;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function truncate(text: string, max = 180): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

export function buildSearchDocs(bundle: ContentBundle): SearchDoc[] {
  const docs: SearchDoc[] = [];
  const trackTitle = new Map(bundle.tracks.map((t) => [t.slug, t.short_title]));

  for (const track of bundle.tracks) {
    docs.push({
      type: "track",
      id: track.slug,
      title: `${track.short_title} — ${track.title}`,
      url: `/tracks/${track.slug}`,
      snippet: truncate(track.mental_model),
      context: `Track ${track.number}`,
      fields: [
        { text: `${track.short_title} ${track.title} ${track.slug.replace(/-/g, " ")}`, weight: 5 },
        { text: track.products.map((p) => p.name).join(" "), weight: 5 },
        { text: `${track.mental_model} ${track.outcome}`, weight: 2 },
        { text: `${track.summary} ${track.problem} ${track.architecture_position}`, weight: 1 },
        { text: track.topics.map((t) => t.title).join(" "), weight: 1.5 },
      ],
    });
    track.topics.forEach((topic, index) => {
      docs.push({
        type: "topic",
        id: `${track.slug}#topic-${index}`,
        title: topic.title,
        url: `/tracks/${track.slug}#curriculum`,
        snippet: `${topic.level[0]?.toUpperCase()}${topic.level.slice(1)} topic in the ${track.short_title} curriculum.`,
        context: track.short_title,
        fields: [
          { text: topic.title, weight: 3 },
          { text: `${track.short_title} ${track.products.map((p) => p.name).join(" ")}`, weight: 0.5 },
        ],
      });
    });
  }

  for (const path of bundle.paths) {
    docs.push({
      type: "path",
      id: path.slug,
      title: path.title,
      url: `/paths/${path.slug}`,
      snippet: truncate(path.outcome),
      context: `Learning path ${path.number}`,
      fields: [
        { text: path.title, weight: 5 },
        { text: `${path.outcome} ${path.target_learner}`, weight: 1.5 },
        { text: path.modules.map((m) => `${trackTitle.get(m.track) ?? m.track} ${m.focus}`).join(" "), weight: 1 },
      ],
    });
  }

  for (const lesson of bundle.lessons) {
    docs.push({
      type: "lesson",
      id: lesson.id,
      title: lesson.title,
      url: `/tracks/${lesson.track}/lessons/${lesson.id}`,
      snippet: truncate(lesson.learning_objectives[0] ?? ""),
      context: `${trackTitle.get(lesson.track) ?? lesson.track} lesson`,
      fields: [
        { text: lesson.title, weight: 5 },
        { text: lesson.toc.map((t) => t.text).join(" "), weight: 2 },
        { text: lesson.learning_objectives.join(" "), weight: 2 },
        { text: stripHtml(lesson.html), weight: 0.6 },
      ],
    });
  }
  return docs;
}

export function buildSearchIndex(docs: SearchDoc[]): SearchIndex {
  const postings = new Map<string, Posting[]>();
  docs.forEach((doc, docIndex) => {
    const best = new Map<string, number>();
    for (const field of doc.fields) {
      for (const token of tokenize(field.text)) {
        best.set(token, Math.max(best.get(token) ?? 0, field.weight));
      }
    }
    for (const [token, weight] of best) {
      const list = postings.get(token);
      if (list) list.push({ doc: docIndex, weight });
      else postings.set(token, [{ doc: docIndex, weight }]);
    }
  });
  return { docs, postings, vocabulary: [...postings.keys()] };
}

/** Find vocabulary terms that match one query term, with a match-quality multiplier. */
function expandTerm(index: SearchIndex, term: string): Map<string, number> {
  const matches = new Map<string, number>();
  if (index.postings.has(term)) matches.set(term, 1);
  const fuzzyBound = term.length >= 8 ? 2 : term.length >= 4 ? 1 : 0;
  for (const word of index.vocabulary) {
    if (word === term) continue;
    if (term.length >= 2 && word.startsWith(term)) {
      matches.set(word, Math.max(matches.get(word) ?? 0, 0.7));
    } else if (fuzzyBound > 0 && boundedEditDistance(term, word, fuzzyBound) <= fuzzyBound) {
      matches.set(word, Math.max(matches.get(word) ?? 0, 0.45));
    }
  }
  return matches;
}

export interface SearchOptions {
  limit?: number;
  types?: SearchDocType[];
}

export function search(index: SearchIndex, query: string, options: SearchOptions = {}): SearchHit[] {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const queryTokens = [...new Set(tokenize(query))].slice(0, 8);
  if (queryTokens.length === 0) return [];

  // For each query token: doc → best score contributed by that token (or any synonym).
  const perToken: Map<number, number>[] = queryTokens.map((token) => {
    const scores = new Map<number, number>();
    const alternatives = new Set([token, ...(SYNONYMS[token] ?? [])]);
    for (const alt of alternatives) {
      const synonymFactor = alt === token ? 1 : 0.9;
      for (const [word, quality] of expandTerm(index, alt)) {
        for (const posting of index.postings.get(word) ?? []) {
          const score = posting.weight * quality * synonymFactor;
          if (score > (scores.get(posting.doc) ?? 0)) scores.set(posting.doc, score);
        }
      }
    }
    return scores;
  });

  const combine = (requireAll: boolean): SearchHit[] => {
    const totals = new Map<number, { score: number; matched: number }>();
    for (const scores of perToken) {
      for (const [doc, score] of scores) {
        const entry = totals.get(doc) ?? { score: 0, matched: 0 };
        entry.score += score;
        entry.matched += 1;
        totals.set(doc, entry);
      }
    }
    const hits: SearchHit[] = [];
    for (const [docIndex, { score, matched }] of totals) {
      if (requireAll && matched < perToken.length) continue;
      const doc = index.docs[docIndex];
      if (!doc) continue;
      if (options.types && !options.types.includes(doc.type)) continue;
      // Prefer tracks and lessons slightly over individual topics with equal relevance.
      const typeBoost = doc.type === "track" ? 1.15 : doc.type === "lesson" ? 1.1 : 1;
      hits.push({
        type: doc.type,
        id: doc.id,
        title: doc.title,
        url: doc.url,
        snippet: doc.snippet,
        context: doc.context,
        score: Math.round(score * typeBoost * (matched / perToken.length) * 1000) / 1000,
      });
    }
    return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
  };

  const strict = combine(true);
  return strict.length > 0 ? strict : combine(false);
}
