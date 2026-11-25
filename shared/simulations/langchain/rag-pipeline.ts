/**
 * Simulation: a RAG pipeline, end to end (REMAINING_WORK.md §5.8).
 *
 * A few short documents are split into chunks of N sentences; every
 * sentence has a small, hand-made vector over four topics, and a chunk's
 * vector is the sum of its sentences' vectors. A question's vector is
 * compared with every chunk by cosine similarity; the top k chunks go into
 * a prompt with the question. The learner changes the chunk size and k and
 * sees what is retrieved, whether the sentence that answers the question is
 * among it, and how long the prompt gets.
 *
 * Follows how retrieval works in LangChain and LlamaIndex: chunks keep
 * their source; similarity is cosine; the top-k chunks are put into a
 * prompt template with the question.
 *
 * Simplified (shown to learners): the vectors are hand-made over four
 * topics instead of coming from a trained model with hundreds of
 * dimensions; chunks are whole sentences without overlap; the prompt
 * length is counted in words, not tokens; no answer is generated.
 */
import type { SimulationModel, StepResult } from "../types.ts";

export const TOPICS = ["containers", "databases", "caching", "messaging"] as const;
export type Vec = [number, number, number, number];

export interface Sentence {
  id: string;
  text: string;
  vec: Vec;
}
export interface Doc {
  file: string;
  sentences: Sentence[];
}

const s = (id: string, text: string, vec: Vec): Sentence => ({ id, text, vec });

/** The documents (hand-made vectors over containers, databases, caching, messaging). */
export const DOCS: readonly Doc[] = [
  {
    file: "redis.md",
    sentences: [
      s("r1", "Redis keeps data in memory, so reads are fast.", [0, 0, 2, 0]),
      s("r2", "It is often used as a cache in front of PostgreSQL.", [0, 1, 2, 0]),
      s("r3", "Redis can also act as a simple message broker.", [0, 0, 1, 1]),
      s("r4", "Clients talk to Redis over a plain TCP protocol.", [0, 0, 1, 0]),
    ],
  },
  {
    file: "operations.md",
    sentences: [
      s("o1", "Kafka keeps events in topics for seven days.", [0, 0, 0, 2]),
      s("o2", "Consumers read the events of a partition in order.", [0, 0, 0, 2]),
      s("o3", "A cache entry expires when its TTL runs out, and the next read goes to the database.", [0, 1, 3, 0]),
      s("o4", "Docker images are rebuilt every night.", [2, 0, 0, 0]),
    ],
  },
  {
    file: "postgresql.md",
    sentences: [
      s("p1", "PostgreSQL stores rows in tables.", [0, 2, 0, 0]),
      s("p2", "An index makes a query faster.", [0, 2, 0, 0]),
      s("p3", "Slow queries are a common reason to add a cache.", [0, 2, 1, 0]),
      s("p4", "Backups run every night.", [0, 1, 0, 0]),
    ],
  },
];

export interface Question {
  text: string;
  vec: Vec;
  /** The sentence that answers it. */
  support: string;
}

export interface RagScenario {
  question: Question;
  chunkSize: number;
  k: number;
  /** Most words the prompt may have (the context window, simplified). */
  budget: number;
}

export interface Chunk {
  id: string;
  file: string;
  sentences: Sentence[];
  vec: Vec;
  words: number;
}

export interface Hit {
  chunk: Chunk;
  score: number;
}

export interface RagState {
  question: Question;
  chunkSize: number;
  k: number;
  budget: number;
  /** Settings tried so far, for the event log and the challenge. */
  tries: number;
}

export type RagAction = { type: "setChunkSize"; size: number } | { type: "setK"; k: number };

const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];

export function cosine(a: Vec, b: Vec): number {
  const dot = a.reduce((n, x, i) => n + x * (b[i] ?? 0), 0);
  const len = (v: Vec) => Math.sqrt(v.reduce((n, x) => n + x * x, 0));
  return len(a) && len(b) ? dot / (len(a) * len(b)) : 0;
}

/** Split every document into chunks of `size` whole sentences (no overlap); each chunk keeps its file. */
export function chunk(size: number): Chunk[] {
  return DOCS.flatMap((d) => {
    const out: Chunk[] = [];
    for (let i = 0; i < d.sentences.length; i += size) {
      const part = d.sentences.slice(i, i + size);
      out.push({
        id: `${d.file}#${out.length + 1}`,
        file: d.file,
        sentences: part,
        vec: part.reduce<Vec>((v, x) => add(v, x.vec), [0, 0, 0, 0]),
        words: part.reduce((n, x) => n + words(x.text), 0),
      });
    }
    return out;
  });
}

/** Every chunk ranked by similarity to the question (ties keep document order). */
export function ranked(s: Pick<RagState, "question" | "chunkSize">): Hit[] {
  return chunk(s.chunkSize)
    .map((c, i) => ({ chunk: c, score: cosine(s.question.vec, c.vec), i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ chunk: c, score }) => ({ chunk: c, score }));
}

export const PROMPT_HEAD = "Context information is below.";
export const PROMPT_RULE = "Given the context information and not prior knowledge, answer the query.";

export function retrieved(s: RagState): Hit[] {
  return ranked(s).slice(0, s.k);
}
export function promptWords(s: RagState): number {
  return words(PROMPT_HEAD) + words(PROMPT_RULE) + words(`Query: ${s.question.text}`) + retrieved(s).reduce((n, h) => n + h.chunk.words + 1, 0);
}
export const supportFound = (s: RagState) => retrieved(s).some((h) => h.chunk.sentences.some((x) => x.id === s.question.support));
export const withinBudget = (s: RagState) => promptWords(s) <= s.budget;

function summary(s: RagState): string {
  const hits = retrieved(s).map((h) => `${h.chunk.id} (${h.score.toFixed(2)})`).join(", ");
  return `chunk size ${s.chunkSize}, k=${s.k}: retrieved ${hits}. The answer's sentence is ${supportFound(s) ? "in the prompt" : "NOT in the prompt"}; the prompt has ${promptWords(s)} words (budget ${s.budget})${withinBudget(s) ? "" : " — too long"}.`;
}

const refuse = (state: RagState, error: string): StepResult<RagState> => ({ state, events: [], error });

function step(st: RagState, a: RagAction): StepResult<RagState> {
  switch (a.type) {
    case "setChunkSize": {
      if (a.size < 1 || a.size > 4) return refuse(st, "Chunk size must be 1 to 4 sentences.");
      const next = { ...st, chunkSize: a.size, tries: st.tries + 1 };
      return { state: next, events: [`Re-chunked into ${chunk(a.size).length} chunks. ${summary(next)}`] };
    }
    case "setK": {
      if (a.k < 1 || a.k > 6) return refuse(st, "k must be 1 to 6.");
      const next = { ...st, k: a.k, tries: st.tries + 1 };
      return { state: next, events: [summary(next)] };
    }
  }
}

function init(p: RagScenario): StepResult<RagState> {
  const state: RagState = { question: p.question, chunkSize: p.chunkSize, k: p.k, budget: p.budget, tries: 0 };
  return { state, events: [`Question: "${p.question.text}". ${summary(state)}`] };
}

function describe(st: RagState): string[] {
  const top = new Set(retrieved(st).map((h) => h.chunk.id));
  return [
    `Question: "${st.question.text}" — its vector is [${st.question.vec.join(", ")}] over ${TOPICS.join(", ")}.`,
    `Chunk size ${st.chunkSize} sentence(s), k=${st.k}, prompt budget ${st.budget} words.`,
    ...ranked(st).map((h) => `${top.has(h.chunk.id) ? "RETRIEVED " : ""}${h.chunk.id}, similarity ${h.score.toFixed(2)}, ${h.chunk.words} words: ${h.chunk.sentences.map((x) => x.text).join(" ")}`),
    `The answer's sentence is ${supportFound(st) ? "in" : "not in"} the prompt. Prompt length: ${promptWords(st)} of ${st.budget} words.`,
  ];
}

export const ragPipeline: SimulationModel<RagState, RagAction, RagScenario> = {
  id: "langchain-rag-pipeline",
  track: "langchain-llamaindex",
  init,
  step,
  invariants: [
    {
      name: "chunking keeps every sentence exactly once",
      check: (st) => {
        const ids = chunk(st.chunkSize).flatMap((c) => c.sentences.map((x) => x.id));
        const all = DOCS.flatMap((d) => d.sentences.map((x) => x.id));
        return ids.length === all.length && all.every((id, i) => ids[i] === id) ? null : "sentences lost or duplicated";
      },
    },
    {
      name: "retrieval returns k chunks in order of similarity",
      check: (st) => {
        const hits = retrieved(st);
        if (hits.length !== Math.min(st.k, chunk(st.chunkSize).length)) return `${hits.length} hits for k=${st.k}`;
        return hits.every((h, i) => i === 0 || (hits[i - 1]?.score ?? 0) >= h.score) ? null : "hits out of order";
      },
    },
  ],
  checks: {
    /** The sentence that answers the question is retrieved, and the prompt fits the budget. */
    "support-within-budget": (st) => supportFound(st) && withinBudget(st),
  },
  describe,
};
