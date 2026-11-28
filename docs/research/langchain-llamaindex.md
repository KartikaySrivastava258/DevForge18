# LangChain + LlamaIndex — research notes

Checked 2026-11-27 (UTC). Reuse these in lessons; add to them instead of researching again.

## Versions

| Component | Version | Notes |
|---|---|---|
| `python:3.12-slim` | `@sha256:191083cd…` | all lessons of this track |
| langchain-core | 1.8.4 | with numpy 2.5.5 for the in-memory vector store |
| llama-index-core | 0.14.26 | lesson 3 only |

No real model is called anywhere in this track: embeddings are the hand-made keyword model, chat models are `FakeListChatModel` / `GenericFakeChatModel`, and the "obedient model" in the injection lesson is plain Python — all labelled as stand-ins.

## Facts confirmed (source → wording)

- RAG tutorial (docs.langchain.com/oss/python/langchain/rag): indexing commonly works in four steps — load, split, store (and embed); retrieval and generation follow.
- Tools (…/langchain/tools): `@tool` uses the function's name, docstring and typed arguments as the tool's name, description and schema.
- Agents (…/langchain/agents): "Without another limit, an agent that keeps calling tools stops only at its recursion limit. create_agent sets that limit to 9,999 steps."
- OWASP LLM01 Prompt Injection (genai.owasp.org/llmrisk/llm01-prompt-injection/): direct vs indirect injection; "it is unclear if there are fool-proof methods of prevention for prompt injection"; mitigations include least privilege, human approval for high-risk actions, "Segregate and identify external content".
- OWASP LLM06 Excessive Agency: minimise extensions; require human approval for high-impact actions.
- OWASP LLM09 Misinformation: hallucination as a cause; mitigations include RAG, "Cross-Verification and Human Oversight".
- LangSmith evaluation concepts: datasets with reference outputs; human, code and LLM-as-judge evaluators.

## Observed while building lessons

- `InMemoryVectorStore.similarity_search_with_score` with an all-zero query vector raises `ValueError: NaN values found` (cosine similarity); the teaching embedding needs a guard or a constant extra dimension.
- With only four topic dimensions, any two texts about the same topic score 1.00 — say so wherever scores are shown.
- `similarity_search(…, filter=callable)` filters on each `Document` before ranking (keyword argument `filter: Callable[[Document], bool]`).
- `GenericFakeChatModel` / `FakeListChatModel` raise `NotImplementedError` for `bind_tools`; a hand-written loop with scripted `AIMessage(tool_calls=…)` works.
- `tool.invoke(args)` validates with pydantic: `amount="lots"` → "Input should be a valid integer, unable to parse string as an integer".
- One pip resolution of langchain-core 1.8.4 failed with ResolutionImpossible and succeeded on retry minutes later (transient index problem); only top-level packages are pinned in this track.

## Vector stores (alternatives.yaml, `complements`) — checked 2026-11-28

Vector stores are used *with* LangChain or LlamaIndex, not instead of them, so they are a separate list (`complements`) next to the framework alternatives.

- Qdrant — licence Apache-2.0 (GitHub licence API for qdrant/qdrant, `LICENSE` on `master`). README: "a vector similarity search engine and vector database", "written in Rust", "tailored for extended filtering support"; the quick start `docker run -p 6333:6333 qdrant/qdrant` "starts an insecure deployment without authentication". Docs overview (qdrant.tech/documentation/overview/): client-server architecture; payload indexes enable filtering during search; dense or sparse vectors; hybrid retrieval with semantic and lexical search; deployment as Managed Cloud, Hybrid Cloud, Private Cloud or Open Source.
- Weaviate — `LICENSE` on `main`: "variously licensed under the BSD-3-Clause License, or the Weaviate License"; outside the `wl` directory BSD-3-Clause, inside it "only available under a separate enterprise license"; "Enterprise features are enabled via license key"; the BSD licence "does not grant the right to use these features". GitHub's licence API reports `NOASSERTION` ("Other"). Docs (docs.weaviate.io/weaviate): "an open-source vector database designed to store and index both data objects and their vector embeddings"; searches "based on both semantic similarity and keywords"; Weaviate Cloud, Docker ("local evaluation & development"), Kubernetes ("development to production"), Embedded ("basic, quick evaluation").
- Chroma — licence Apache-2.0 (chroma-core/chroma `LICENSE` on `main`). Docs: "the open-source data infrastructure for AI"; "Run it locally, self-host, or use Chroma Cloud". Clients page (docs.trychroma.com/docs/run-chroma/clients): Python `Client()` runs in memory, `PersistentClient` saves to a local path; the JS/TS and Rust clients connect to a running Chroma server.
