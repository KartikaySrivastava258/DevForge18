import { PROMPT_HEAD, PROMPT_RULE, promptWords, ragPipeline, ranked, retrieved, supportFound, TOPICS, withinBudget, type RagAction, type RagState } from "../../../shared/simulations/langchain/rag-pipeline.ts";
import { Field } from "./Field.tsx";
import type { SimulationEntry, ViewProps } from "./registry.ts";

function command(a: RagAction): string {
  return a.type === "setChunkSize" ? `chunks of ${a.size} sentences (a teaching model: LlamaIndex's chunk_size counts tokens)` : `as_retriever(similarity_top_k=${a.k})`;
}

function RagPipelineView({ state, dispatch }: ViewProps<RagState, RagAction>) {
  const hits = ranked(state);
  const top = new Set(retrieved(state).map((h) => h.chunk.id));
  const words = promptWords(state);
  const found = supportFound(state);
  return (
    <div className="rag-sim">
      <dl className="k8s-sim__summary">
        <div>
          <dt>Question</dt>
          <dd>{state.question.text}</dd>
        </div>
        <div>
          <dt>Question vector</dt>
          <dd>
            [{state.question.vec.join(", ")}] <span className="airflow-sim__detail">{TOPICS.join(", ")}</span>
          </dd>
        </div>
        <div>
          <dt>Answer's sentence</dt>
          <dd className={found ? "rag-sim__ok" : "rag-sim__bad"}>{found ? "in the prompt" : "not retrieved"}</dd>
        </div>
        <div>
          <dt>Prompt length</dt>
          <dd className={withinBudget(state) ? "rag-sim__ok" : "rag-sim__bad"}>
            {words} / {state.budget} words
          </dd>
        </div>
      </dl>

      <div className="prom-sim__query">
        <Field label="Chunk size (sentences)">
          {(id) => (
            <select id={id} value={state.chunkSize} onChange={(e) => dispatch({ type: "setChunkSize", size: Number(e.target.value) })}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="k (chunks retrieved)">
          {(id) => (
            <select id={id} value={state.k} onChange={(e) => dispatch({ type: "setK", k: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <ol className="rag-sim__chunks" aria-label="Chunks ranked by similarity to the question">
        {hits.map((h) => (
          <li key={h.chunk.id} className="rag-sim__chunk" data-retrieved={top.has(h.chunk.id) ? "true" : "false"}>
            <div className="rag-sim__meta">
              <strong>{h.chunk.id}</strong>
              <span>similarity {h.score.toFixed(2)}</span>
              <span>[{h.chunk.vec.join(", ")}]</span>
              {top.has(h.chunk.id) ? <span className="rag-sim__ok">retrieved</span> : null}
            </div>
            <p>
              {h.chunk.sentences.map((s) => (
                <span key={s.id} className={s.id === state.question.support ? "rag-sim__support" : undefined}>
                  {s.text}{" "}
                </span>
              ))}
            </p>
          </li>
        ))}
      </ol>
      <p className="small muted">Highlighted: the sentence that answers the question. Chunks are ranked by cosine similarity; the top k go into the prompt.</p>

      <details className="rag-sim__prompt" open>
        <summary>The prompt the model would receive</summary>
        <pre>
          {[PROMPT_HEAD, "---------------------", ...retrieved(state).flatMap((h) => [`file: ${h.chunk.file}`, h.chunk.sentences.map((s) => s.text).join(" "), ""]), "---------------------", PROMPT_RULE, `Query: ${state.question.text}`, "Answer:"].join("\n")}
        </pre>
      </details>
    </div>
  );
}

const entry: SimulationEntry = { model: ragPipeline, View: RagPipelineView, command: (a) => command(a as RagAction) };
export default entry;
