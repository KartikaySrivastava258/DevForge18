---
id: llamaindex-chunking-and-retrieval
title: Chunking, retrieval and the prompt a RAG system builds
track: langchain-llamaindex
order: 3
level: beginner
estimated_minutes: 35
prerequisites: [langchain-embeddings-and-similarity]
learning_objectives:
  - Split documents into chunks with LlamaIndex and explain what chunk size changes.
  - Retrieve the chunks closest to a question, with the file each came from.
  - Read the exact prompt a retrieval-augmented generation (RAG) query sends to the model, and cite its sources.
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
self_check:
  - id: rag-what
    prompt: In retrieval-augmented generation, what does the model receive?
    options:
      - { id: a, text: "Your whole document collection" }
      - { id: b, text: "The question plus the few chunks retrieved as most relevant to it, inside a prompt that says to answer from them" }
      - { id: c, text: "Only the question" }
    answer: b
    explanation: You read the exact prompt in the lesson — "Context information is below", the retrieved chunks, then the query. The model only knows what that prompt contains, plus what it learned in training.
  - id: chunk-size
    prompt: Chunks are very large (whole documents). What is the risk?
    options:
      - { id: a, text: "None" }
      - { id: b, text: "Each retrieved chunk carries a lot of unrelated text, which costs tokens and can bury the sentence that answers the question" }
      - { id: c, text: "The index cannot be built" }
    answer: b
    explanation: Big chunks match loosely and fill the prompt. Very small chunks lose context. You will see both effects; chunk size is a trade-off to test, not a constant.
  - id: citations
    prompt: Why keep the source file of each chunk?
    options:
      - { id: a, text: "To show where an answer came from, so a reader can check it" }
      - { id: b, text: "It makes retrieval faster" }
      - { id: c, text: "The model needs it to run" }
    answer: a
    explanation: Citations let people verify answers and spot when the wrong passage was retrieved. LlamaIndex returns the retrieved nodes, with their metadata, alongside the response.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with python:3.12-slim (pinned by digest) and llama-index-core 0.14.26, after the previous lessons; the output shown was recorded from that run. The embedding is the hand-made keyword model from lesson 2 and the language model is LlamaIndex's MockLLM, which returns the prompt it receives; no real model is called. Facts were checked against the LlamaIndex documentation and the llama-index-core 0.14.26 source on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

**Retrieval-augmented generation (RAG)** answers a question from your own documents: split them into **chunks**, find the chunks closest to the question, and put those chunks into the prompt — **LlamaIndex** does each step, and keeps track of which file every chunk came from.

## Explain it like I'm twelve

You have an open-book test, but the book is enormous and you only have a minute. So beforehand you cut the book into index cards, one idea per card. When a question comes, you pick the two or three cards that match best, and answer from those — and you write down which page each card came from.

Cutting the book is **chunking**, picking cards is **retrieval**, the answer is **generation**, and the page numbers are **citations**.

Where the analogy breaks: the computer "matches" cards with vectors (previous lesson), so a card can match well and still be the wrong one — which is why citations matter.

## What problem it solves

A language model only knows what was in its training data, and it cannot read your private or recent documents. Sending all of them with every question is impossible (prompts have size limits) and expensive. RAG sends only the relevant parts, so answers can use your data — and point to it.

## How it works

![](media:langchain-llamaindex/rag-pipeline.svg)

- A **Document** holds a source text and its metadata (here, a file name). A **node parser** such as `SentenceSplitter` cuts it into **nodes** (chunks) of at most `chunk_size` tokens, keeping sentences whole where it can, and copies the metadata to each node.
- A **VectorStoreIndex** embeds every node. A **retriever** embeds the question and returns the `similarity_top_k` closest nodes.
- A **query engine** puts the retrieved nodes into a prompt template with the question, sends it to the language model, and returns the response together with its **source nodes**.

## Try it yourself

> **Local lab** — continue with the `devforge-llm` container, from inside `llm-lab`, with `py` and `put` defined (lesson 1). Every command is run automatically in DevForge's tests. The language model here is LlamaIndex's `MockLLM`, which simply returns the prompt it receives — so you can read exactly what a real model would be sent.

### 1. Install LlamaIndex and load three documents

```bash run
docker exec devforge-llm pip install -q --root-user-action=ignore --disable-pip-version-check llama-index-core==0.14.26
put course_docs.py <<'EOF'
from llama_index.core import Document, Settings
from llama_index.core.embeddings import BaseEmbedding
from llama_index.core.llms import MockLLM
from keyword_embedding import vector

class KeywordEmbedding(BaseEmbedding):
    """The teaching embedding from lesson 2, for LlamaIndex."""
    def _get_text_embedding(self, text):
        return vector(text)
    def _get_query_embedding(self, query):
        return vector(query)
    async def _aget_query_embedding(self, query):
        return vector(query)

Settings.embed_model = KeywordEmbedding()
Settings.llm = MockLLM(max_tokens=None)

DOCS = [
    Document(metadata={"file": "redis.md"}, text=(
        "Redis keeps data in memory, which makes reads very fast. It is often used as a cache in front of a slower database such as PostgreSQL. "
        "Every cache entry can be given a TTL. When the TTL runs out, the entry expires and Redis deletes it, so the next read goes to the database again. "
        "Choosing the TTL is a trade-off between fresh data and fewer database queries.")),
    Document(metadata={"file": "kafka.md"}, text=(
        "Kafka stores events in topics. A topic is split into partitions, and the events of one partition keep their order. "
        "A consumer group shares the partitions of a topic between its members. Events are not deleted when they are read; they stay until the retention time passes.")),
    Document(metadata={"file": "docker.md"}, text=(
        "Docker builds an image from a Dockerfile. An image is a read-only template, and a container is a running instance of an image. "
        "Many containers can start from the same image, and each container has its own writable layer.")),
]
EOF
py <<'EOF'
import llama_index.core
from course_docs import DOCS
print("llama-index-core", llama_index.core.__version__)
for d in DOCS:
    print(d.metadata["file"], len(d.text.split()), "words")
EOF
```

```text output
llama-index-core 0.14.26
redis.md 68 words
kafka.md 47 words
docker.md 39 words
```

- `course_docs.py` sets LlamaIndex's defaults: the keyword embedding from lesson 2 (wrapped in LlamaIndex's embedding interface) and `MockLLM`.
- Each `Document` carries its text and a `file` name in its metadata — the citation you will see later.

### 2. Chunking: the same documents, two chunk sizes

```bash run
py <<'EOF'
from llama_index.core.node_parser import SentenceSplitter
from course_docs import DOCS

for size in (200, 60):
    nodes = SentenceSplitter(chunk_size=size, chunk_overlap=0, tokenizer=str.split).get_nodes_from_documents(DOCS)
    print(f"chunk_size={size}: {len(nodes)} chunks")
    for n in nodes:
        print(f"  {n.metadata['file']}: {n.text[:60]}…")
EOF
```

```text output
chunk_size=200: 3 chunks
  redis.md: Redis keeps data in memory, which makes reads very fast. It …
  kafka.md: Kafka stores events in topics. A topic is split into partiti…
  docker.md: Docker builds an image from a Dockerfile. An image is a read…
chunk_size=60: 4 chunks
  redis.md: Redis keeps data in memory, which makes reads very fast. It …
  redis.md: Choosing the TTL is a trade-off between fresh data and fewer…
  kafka.md: Kafka stores events in topics. A topic is split into partiti…
  docker.md: Docker builds an image from a Dockerfile. An image is a read…
```

- `chunk_size` is measured in **tokens**. Here the tokenizer is `str.split`, so a token is simply a word (real setups use the embedding model's tokenizer, where a token is often part of a word).
- With 200, every document fits in one chunk. With 60, the longer documents are cut — between sentences, never in the middle of one — and every chunk keeps its `file`.

### 3. Retrieval: which chunks match a question?

```bash run
py <<'EOF'
from llama_index.core import VectorStoreIndex
from llama_index.core.node_parser import SentenceSplitter
from course_docs import DOCS

question = "What happens when the TTL of a cache entry runs out?"
for size in (200, 60):
    nodes = SentenceSplitter(chunk_size=size, chunk_overlap=0, tokenizer=str.split).get_nodes_from_documents(DOCS)
    retriever = VectorStoreIndex(nodes).as_retriever(similarity_top_k=2)
    print(f"chunk_size={size}:")
    for hit in retriever.retrieve(question):
        if hit.score > 0:  # a chunk with similarity 0 shares nothing with the question
            print(f"  {hit.score:.2f} {hit.node.metadata['file']}: {len(hit.node.text.split())} words")
EOF
```

```text output
chunk_size=200:
  0.99 redis.md: 68 words
chunk_size=60:
  1.00 redis.md: 13 words
  0.99 redis.md: 55 words
```

- Hits with similarity 0 are not printed: they share nothing with the question (and which of two such chunks comes first is arbitrary).
- With `chunk_size=200`, the best hit is the *whole* Redis document: 68 words of prompt for one question, most of them not about expiry. No other chunk is similar at all.
- With `chunk_size=60`, the Redis document became two chunks — and the best hit is the short one, *"Choosing the TTL is a trade-off between fresh data and fewer database queries."* It mentions TTLs, so it is similar, but it does not say what happens when a TTL runs out. The sentence that does is in the **second** hit.
- Similarity means "about the same thing", not "answers the question". Chunk size and `top_k` are settings you test against real questions.

### 4. The prompt a RAG query sends — with citations

```bash run
py <<'EOF'
from llama_index.core import VectorStoreIndex
from llama_index.core.node_parser import SentenceSplitter
from course_docs import DOCS

nodes = SentenceSplitter(chunk_size=60, chunk_overlap=0, tokenizer=str.split).get_nodes_from_documents(DOCS)
engine = VectorStoreIndex(nodes).as_query_engine(similarity_top_k=2)
response = engine.query("What happens when the TTL of a cache entry runs out?")
print(response.response)
print("sources:", [n.node.metadata["file"] for n in response.source_nodes])
EOF
```

```text output
Context information is below.
---------------------
file: redis.md

Choosing the TTL is a trade-off between fresh data and fewer database queries.

file: redis.md

Redis keeps data in memory, which makes reads very fast. It is often used as a cache in front of a slower database such as PostgreSQL. Every cache entry can be given a TTL. When the TTL runs out, the entry expires and Redis deletes it, so the next read goes to the database again.
---------------------
Given the context information and not prior knowledge, answer the query.
Query: What happens when the TTL of a cache entry runs out?
Answer:
sources: ['redis.md', 'redis.md']
```

- Because `MockLLM` returns its input, the "answer" is the **prompt** a real model would receive: LlamaIndex's default question-answering template, the retrieved chunks (each with its `file` metadata), and the question.
- With `similarity_top_k=2`, both Redis chunks are in the prompt, including the sentence that answers the question. With `similarity_top_k=1`, the model would have received only the trade-off sentence — and been told to answer from it.
- The template tells the model to answer from the context "and not prior knowledge". That instruction reduces made-up answers but does not prevent them — which is why the response also lists its **sources**, so a reader can check.

### 5. Clean up

```bash run
docker rm -f devforge-llm
```

```text output
devforge-llm
```

Your `llm-lab` folder on your computer is empty: all the files lived in the container.

## Try it in the simulation

Change the chunk size and k, and watch which chunks are retrieved, whether the sentence that answers the question reaches the prompt, and how long the prompt gets. It is a labelled teaching model with hand-made vectors, not a real embedding model.

```simulation langchain-rag-pipeline scenario=ttl-question
```

## Common mistakes

- **Never looking at the retrieved chunks.** Most bad RAG answers come from retrieving the wrong passage; print the sources while developing.
- **One chunk size for everything.** Test chunk size and `top_k` against real questions; FAQs and long manuals need different settings.
- **Dropping metadata.** Without the source of each chunk you cannot cite, filter by permission, or debug.
- **Retrieving documents the user may not see.** Retrieval must respect the same access rules as the documents themselves.
- **Trusting "answer only from the context".** It is an instruction, not a guarantee; check answers against their sources.

## Where this fits in a real system

Documents are loaded and chunked by a pipeline scheduled in **Airflow**, embedded, and stored in **PostgreSQL** with pgvector or a vector database. An API calls the query engine with a real model, logs which sources each answer used, and is traced with **OpenTelemetry**; frequently asked questions can be cached in **Redis**.
