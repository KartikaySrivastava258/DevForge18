---
id: langchain-chunk-size-and-retrieval
title: Tune chunk size and k for retrieval
track: langchain-llamaindex
level: intermediate
mode: simulation
estimated_minutes: 25
prerequisites: [langchain-embeddings-and-similarity, llamaindex-chunking-and-retrieval]
objectives:
  - Predict how chunk size changes each chunk's vector and which chunks are retrieved.
  - Choose a chunk size and k so the sentence that answers the question is retrieved within a prompt budget.
  - Read the prompt that retrieval builds, with the source file of every chunk.
checkpoints:
  - { id: predicted, text: "I wrote down a prediction before each experiment and compared it with the event log" }
  - { id: challenges, text: "The two challenges below show Done" }
simulation:
  id: langchain-rag-pipeline
  challenges: [ttl-question, why-cache]
resources:
  - title: LlamaIndex — Documents and Nodes
    url: https://developers.llamaindex.ai/python/framework/module_guides/loading/documents_and_nodes/
    publisher: LlamaIndex
    type: documentation
    level: beginner
    official: true
    why: How LlamaIndex represents your data (Documents) and their chunks (Nodes).
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: LlamaIndex — VectorStoreIndex
    url: https://developers.llamaindex.ai/python/framework/module_guides/indexing/vector_store_index/
    publisher: LlamaIndex
    type: documentation
    level: beginner
    official: true
    why: Building an index from nodes and querying it.
    verification: { status: verified, checked_on: 2026-11-25 }
verification:
  method: docs-checked
  details: The simulation is a labelled teaching model with hand-made vectors over four topics, not a real embedding model, and it generates no answer. Its retrieval rules — chunks keep their source, similarity is cosine, and the top k chunks go into a prompt template with the question — follow how retrieval works in LangChain and LlamaIndex, as stated in the model. Challenges are verified on the server by replaying your actions through the same model.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

Use the RAG pipeline simulation like a scientist: **predict** which chunks will be retrieved and how long the prompt will be, **run** the experiment by changing one setting, and **compare** with the ranked chunks and the event log. You finish when the server has verified both challenges.

This lab runs in your browser. It is a model of retrieval with hand-made vectors, not a real embedding model, and no answer is generated. The lesson *Chunking, retrieval and the prompt a RAG system builds* runs the same steps with LlamaIndex itself; *Embeddings and similarity, with small vectors* explains cosine similarity.

## Steps

### 1. Find the TTL answer

Choose the scenario **When a TTL runs out**. The question's vector is `[0, 0, 2, 0]` over containers, databases, caching and messaging: it is only about caching. The answer is one sentence in `operations.md`, a document that mixes Kafka, caching and Docker. The prompt may have at most 70 words. Before you touch anything, write down:

- With chunks of four sentences, each document is one chunk. Which way does the `operations.md` chunk's vector point? Will it rank first?
- If every sentence were its own chunk, which sentences would point exactly the same way as the question?

Read the ranked chunks and the highlighted answer sentence. Then change **Chunk size (sentences)** and watch the similarity scores and vectors change.

When the answer sentence has a chunk of its own, count how many chunks rank above it. What is the smallest **k (chunks retrieved)** that brings it into the prompt? Before you set it, estimate the prompt length and compare it with the budget.

Open **The prompt the model would receive** and check that each chunk shows the file it came from.

A chunk's vector mixes everything in it. A big chunk can bury one relevant sentence under unrelated ones.

### 2. Keep the answer's context

Choose **Why add a cache**. The question's vector is `[0, 1, 1, 0]`: half databases, half caching. The answer is a sentence in `postgresql.md`. The prompt may have at most 45 words, and each chunk is one sentence.

- Work out the cosine similarity of the answer sentence and of the Redis sentence about PostgreSQL with the question. Which one ranks first? (In this model, a tie keeps document order.)
- Raising k to 2 would bring the answer in. Predict the prompt length first. Does it fit the budget?

Try it and compare with **Prompt length**. Then go back to k=1 and try larger chunks instead. At each chunk size, read which sentences share the answer's chunk and how that changes the chunk's vector. Which size makes that chunk lean towards databases, like the question, and still fit the budget?

Raising k is not the only lever. The sentences around the answer decide which way its chunk points.

## Simulation

```simulation langchain-rag-pipeline
```

## Reset

Each scenario has a **Reset** button that restores its starting state. Your verified challenges stay recorded.

## What you practised

Retrieval ranks chunks, not sentences, so chunk size decides what each vector says. A larger k brings in more context but makes the prompt longer. Good settings get the answer into the prompt without wasting the budget.
