---
id: rag-assistant
title: Retrieval-augmented assistant with citations
summary: An assistant that answers only from an organisation's own documents — chunks with source and audience metadata and their embeddings live in PostgreSQL, retrieval filters by the user's permissions before ranking, the model answers with numbered citations that are checked, and it refuses when nothing relevant is found; Redis caches and rate-limits, and OpenTelemetry traces each question.
problem: Users need answers grounded in specific documents they can check, but a language model will answer confidently from irrelevant or forbidden context, invent citations and follow instructions hidden in the text it is given.
tracks: [langchain-llamaindex, postgresql, redis, opentelemetry]
diagram: media:architecture/rag-assistant.svg
components:
  - { name: Indexing pipeline, track: langchain-llamaindex, role: "Splits documents into chunks, copies source, section, date and audience metadata onto every chunk, and embeds each chunk once with one embedding model." }
  - { name: PostgreSQL with pgvector, track: postgresql, role: "Stores chunks, their metadata and their vectors; the audience filter is an ordinary WHERE clause applied with the similarity search." }
  - { name: Retrieval and answer chain, track: langchain-llamaindex, role: "Embeds the question with the same model, retrieves the closest permitted chunks with scores, abstains below a relevance threshold, prompts with numbered sources and checks every citation in the answer." }
  - { name: Language model, role: "Writes the answer from the sources it is given. It can be manipulated by what reaches the prompt, so it is never the place where a rule is enforced." }
  - { name: Redis, track: redis, role: "Caches repeated answers (and embeddings of frequent questions) and limits how many requests each user may make." }
  - { name: OpenTelemetry, track: opentelemetry, role: "Traces each question through retrieval, the model call and any tools, so time, cost and failures can be investigated." }
  - { name: Evaluation set, role: "A versioned set of questions with required facts, their sources and some unanswerable ones; it runs on every change as a release gate." }
flow:
  - The indexing pipeline chunks new or changed documents, attaches their metadata and stores chunks and embeddings in PostgreSQL.
  - A question arrives; Redis checks the user's rate limit and whether a cached answer can be used.
  - The question is embedded with the same model as the chunks; retrieval considers only chunks whose audience includes the user and returns the closest ones with similarity scores.
  - If no chunk passes the threshold, the assistant refuses before calling the model; otherwise it sends the passages as numbered, clearly delimited sources with the rule to cite them.
  - The answer's citations are parsed and checked against the sources that were sent; the answer is returned with those sources, and the whole path is recorded in one trace.
trade_offs:
  - { choice: "A relevance threshold with abstention", gain: "Fewer confident answers built on irrelevant context, and no model call is spent on them.", cost: "Some answerable questions are refused; the threshold has to be measured on a test set rather than set by feel." }
  - { choice: "Permissions applied as a retrieval filter", gain: "Restricted chunks are never candidates, whatever the question or a hidden instruction says.", cost: "Every chunk needs correct audience metadata from the indexing pipeline, taken from the groups or roles of the identity provider." }
  - { choice: "pgvector in PostgreSQL instead of a separate vector database", gain: "Vectors sit next to the relational data, with transactions and SQL filters, in a database the team already runs.", cost: "If you need features or scaling beyond what your PostgreSQL setup provides, a dedicated vector service may be required." }
  - { choice: "Caching answers in Redis", gain: "Repeated questions are answered without retrieval or a model call.", cost: "A cached answer can outlive a document change; it needs a TTL and invalidation like any other cache." }
failure_modes:
  - { failure: "The model cites a source number it was never given", effect: "The answer looks verified but is not.", mitigation: "Parse every [n], require one per sentence, and reject or refuse when a number is not among the sources sent." }
  - { failure: "A retrieved document contains instructions (indirect prompt injection)", effect: "The model may follow them — reveal data or call tools it should not.", mitigation: "Keep forbidden data out of the prompt by code (permission filters), mark retrieved text as data, flag instruction-like passages, check answers before returning them, and give tools no more power than the user has." }
  - { failure: "The wrong passage is retrieved", effect: "A fluent answer to a different question; most bad RAG answers start here.", mitigation: "Look at retrieved chunks while developing, and tune chunk size and top_k against real questions from the evaluation set." }
  - { failure: "Questions are embedded with a different model from the stored chunks", effect: "Similarity scores become meaningless and retrieval returns noise.", mitigation: "Record which embedding model built the index and use the same one for every question." }
alternatives:
  - { instead_of: "LangChain or LlamaIndex", consider: "Direct use of a model provider's SDK", when: "The application is small or well understood and you want fewer dependencies, full control and easier debugging." }
  - { instead_of: "LangChain or LlamaIndex", consider: "Haystack", when: "You are building retrieval- or search-centred pipelines and prefer explicit, composable pipeline components." }
  - { instead_of: "pgvector", consider: "A dedicated vector database", when: "You need features or scaling behaviour beyond what your PostgreSQL setup provides." }
decision_prompts:
  - Which chunk size, top_k and relevance threshold do you choose, and which numbers from the evaluation set support them?
  - Where do audience labels come from, and what happens to a chunk whose audience is unknown?
  - How are cached answers keyed and expired so that a user never receives an answer built from documents they may not see, or from an outdated version?
  - Which questions in your evaluation set must the assistant refuse, and what refusal rate do you accept on answerable ones?
  - Which tools may the assistant call, with whose credentials, and which ones need a person's approval?
learn_more:
  - { kind: lesson, id: langchain-rag-with-citations }
  - { kind: lesson, id: llamaindex-chunking-and-retrieval }
  - { kind: lesson, id: llm-prompt-injection-and-permissions }
  - { kind: lesson, id: llm-evaluation-and-hallucination-checks }
  - { kind: lab, id: langchain-chunk-size-and-retrieval }
  - { kind: project, id: langchain-handbook-assistant }
capstones: [capstone-c]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## When to use it

Use this shape when people ask questions whose answers are in a known body of documents — a handbook, notices,
policies, course material — and they need to see where each answer came from. It suits documents that change, since
the indexing pipeline re-chunks and re-embeds changed documents, and collections where different people may see
different documents.

Retrieval is the wrong way to answer questions that need an exact lookup, such as a timetable entry: give the
assistant a narrow, allow-listed tool with validated arguments for that, and require a person's approval for anything
that writes. And if no evaluation set exists yet, build that first; without it nobody can tell whether a change made
the assistant better or worse.

## How it works

The model is asked to answer only from what retrieval hands it — and because that is an instruction, not a
guarantee, everything around the model enforces it. Retrieval decides what the model can see — the
closest chunks among those the user is permitted to read, and nothing at all when no chunk is relevant enough — and
code checks afterwards that every citation in the answer points to a source that was actually provided. The model is
treated as a capable but untrustworthy component in the middle: rules live in the retrieval filter and in the checks
around it, never only in the prompt.

The evaluation set is what keeps that honest over time. It scores correctness by required facts, faithfulness by
checking each sentence against its cited passage, and abstention on questions the documents cannot answer, and it
runs on every change so that a new prompt, chunk size or model is a measured decision.
