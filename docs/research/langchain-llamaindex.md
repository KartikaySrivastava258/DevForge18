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
