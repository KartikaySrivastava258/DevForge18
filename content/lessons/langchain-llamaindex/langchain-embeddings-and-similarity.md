---
id: langchain-embeddings-and-similarity
title: Embeddings and similarity, with small vectors
track: langchain-llamaindex
order: 2
level: beginner
estimated_minutes: 30
prerequisites: [langchain-prompts-models-and-parsers]
learning_objectives:
  - Explain what an embedding is and how cosine similarity compares two of them.
  - Search a small vector store for the texts closest to a question.
  - Explain why real embedding models are learned, using a case where a hand-made one fails.
resources:
  - title: LangChain — embedding models
    url: https://docs.langchain.com/oss/python/integrations/embeddings/index
    publisher: LangChain
    type: documentation
    level: beginner
    official: true
    why: What an embedding is, cosine similarity, and the embed_documents / embed_query interface.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: LlamaIndex — embeddings
    url: https://developers.llamaindex.ai/python/framework/module_guides/models/embeddings/
    publisher: LlamaIndex
    type: documentation
    level: beginner
    official: true
    why: The same idea from the other framework, and that LlamaIndex compares embeddings with cosine similarity by default.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: what-embedding
    prompt: What is an embedding?
    options:
      - { id: a, text: "A compressed copy of the text that can be turned back into it" }
      - { id: b, text: "A list of numbers that places a text in a space where texts with similar meaning are close together" }
      - { id: c, text: "A password for the model" }
    answer: b
    explanation: LangChain's documentation describes embeddings as fixed-length vectors that capture semantic meaning, so texts with similar ideas are close together. You cannot turn the vector back into the text.
  - id: cosine
    prompt: Two vectors point in exactly the same direction but one is twice as long. What is their cosine similarity?
    options:
      - { id: a, text: "0.5" }
      - { id: b, text: "1 — cosine similarity looks at the angle, not the length" }
      - { id: c, text: "2" }
    answer: b
    explanation: Cosine similarity measures the angle between two vectors. In the lesson, a long text about caching and a short one point the same way, so length does not hide their similarity.
  - id: why-learned
    prompt: The hand-made embedding fails on "Which tool queues messages?". Why would a real embedding model do better?
    options:
      - { id: a, text: "It has a longer list of keywords" }
      - { id: b, text: "It was trained on huge amounts of text, so it places words like queue, message and event near each other without anyone listing them" }
      - { id: c, text: "It does not do better" }
    answer: b
    explanation: A keyword list only knows the words someone wrote down. A learned model has seen how words are used, so related words and phrasings land near each other.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with python:3.12-slim (pinned by digest) and langchain-core 1.8.4, after the previous lesson; the output shown was recorded from that run. The embedding is a hand-made keyword count, clearly labelled; no model is called. Facts about embeddings were checked against the LangChain and LlamaIndex documentation and the langchain-core 1.8.4 source on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

An **embedding** turns a text into a list of numbers — a **vector** — so that texts with similar meaning end up close together, and **cosine similarity** measures how close two of them are; searching by meaning is then finding the nearest vectors.

## Explain it like I'm twelve

Give every text a score on a few questions: how much is it about containers? About databases? About caching? About messaging? A text about Redis scores high on caching and a bit on databases. A question about "cache expiry" scores high on caching too — so the two are close, even if they share few words.

Those scores are an **embedding**, and comparing which way two lists of scores point is **cosine similarity**.

Where the analogy breaks: real embeddings have hundreds or thousands of numbers, and no person chose what each one means — a model learned them.

## What problem it solves

Keyword search misses texts that say the same thing in other words, and finds texts that use the word in a different sense. Embeddings let a program search by meaning: find the paragraphs most related to a question, which is the first half of retrieval-augmented generation (next lesson).

## How it works

```diagram steps=langchain-llamaindex/cosine
```

- An **embedding model** maps each text to a vector. LangChain's interface has two methods: `embed_documents` for the texts you store and `embed_query` for a question.
- **Cosine similarity** is the cosine of the angle between two vectors: 1 means the same direction, 0 means unrelated (at right angles).
- A **vector store** keeps the vectors of your texts and returns the ones closest to the question's vector. langchain-core's `InMemoryVectorStore` uses cosine similarity.

## Try it yourself

> **Local lab** — continue with the `devforge-llm` container, from inside `llm-lab`, with `py` and `put` defined (lesson 1). Every command is run automatically in DevForge's tests.

### 1. A hand-made embedding

This is a **teaching model**, not a real embedding model: it counts words from four short lists, one per topic.

```bash run
put keyword_embedding.py <<'EOF'
import re
from langchain_core.embeddings import Embeddings

TOPICS = {
    "containers": ["docker", "image", "container", "containers"],
    "databases": ["postgresql", "table", "sql", "query", "index"],
    "caching": ["redis", "cache", "ttl", "expire", "expires"],
    "messaging": ["kafka", "topic", "partition", "consumer", "event", "events"],
}

def vector(text):
    words = re.findall(r"[a-z]+", text.lower())
    return [float(sum(words.count(w) for w in keywords)) for keywords in TOPICS.values()]

class KeywordEmbedding(Embeddings):
    """Teaching stand-in for an embedding model: one number per topic."""
    def embed_documents(self, texts):
        return [vector(t) for t in texts]
    def embed_query(self, text):
        return vector(text)
EOF
py <<'EOF'
from keyword_embedding import TOPICS, KeywordEmbedding
e = KeywordEmbedding()
print("topics:", list(TOPICS))
for text in ["Redis is a cache; each cache entry can expire after a TTL.",
             "Kafka keeps events in a topic.",
             "How long does a Redis cache entry live?"]:
    print(e.embed_query(text), text)
EOF
```

```text output
topics: ['containers', 'databases', 'caching', 'messaging']
[0.0, 0.0, 5.0, 0.0] Redis is a cache; each cache entry can expire after a TTL.
[0.0, 0.0, 0.0, 3.0] Kafka keeps events in a topic.
[0.0, 0.0, 2.0, 0.0] How long does a Redis cache entry live?
```

Each text becomes four numbers. The Redis sentence and the question about Redis both point mostly along "caching" — that is what will make them similar.

### 2. Cosine similarity by hand

```bash run
py <<'EOF'
import math
from keyword_embedding import KeywordEmbedding

def cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    return dot / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)))

e = KeywordEmbedding()
question = e.embed_query("How long does a Redis cache entry live?")
for text in ["Redis is a cache; each cache entry can expire after a TTL.",
             "Redis cache.",
             "Kafka keeps events in a topic.",
             "Docker builds an image for each container."]:
    print(f"{cosine(question, e.embed_query(text)):.2f}  {text}")
EOF
```

```text output
1.00  Redis is a cache; each cache entry can expire after a TTL.
1.00  Redis cache.
0.00  Kafka keeps events in a topic.
0.00  Docker builds an image for each container.
```

- The long Redis sentence and the two-word "Redis cache." score the same: cosine similarity compares **direction**, not length.
- Kafka and Docker sentences point in other directions entirely: similarity 0.

### 3. A vector store: search by meaning

```bash run
py <<'EOF'
from langchain_core.vectorstores import InMemoryVectorStore
from keyword_embedding import KeywordEmbedding

store = InMemoryVectorStore(embedding=KeywordEmbedding())
store.add_texts([
    "Redis keeps data in memory, and a cache entry can expire after a TTL.",
    "PostgreSQL stores rows in a table; an index makes a query faster.",
    "Kafka stores events in a topic with several partitions.",
    "Docker builds an image; a container is a running image.",
    "Redis can sit in front of PostgreSQL as a cache for slow queries.",
])
for question in ["When does a cache entry expire?", "How do I make an SQL query faster?"]:
    print(question)
    for doc, score in store.similarity_search_with_score(question, k=2):
        print(f"  {score:.2f}  {doc.page_content}")
EOF
```

```text output
When does a cache entry expire?
  1.00  Redis keeps data in memory, and a cache entry can expire after a TTL.
  0.89  Redis can sit in front of PostgreSQL as a cache for slow queries.
How do I make an SQL query faster?
  1.00  PostgreSQL stores rows in a table; an index makes a query faster.
  0.45  Redis can sit in front of PostgreSQL as a cache for slow queries.
```

The store embedded the five texts once, then for each question returned the two closest. The second question also finds the Redis-in-front-of-PostgreSQL text: it is partly about databases.

### 4. Where a hand-made embedding breaks

```bash run
py <<'EOF'
from langchain_core.vectorstores import InMemoryVectorStore
from keyword_embedding import KeywordEmbedding

store = InMemoryVectorStore(embedding=KeywordEmbedding())
store.add_texts(["Kafka stores events in a topic with several partitions."])
question = "Which tool queues messages?"
print(question, "->", KeywordEmbedding().embed_query(question))
try:
    store.similarity_search_with_score(question, k=1)
except ValueError as e:
    print("search failed:", e)
EOF
```

```text output
Which tool queues messages? -> [0.0, 0.0, 0.0, 0.0]
search failed: NaN values found, please remove the NaN values and try again
```

None of the question's words are in the keyword lists, so its vector is all zeros — it points nowhere, and the similarity cannot be computed. A person knows that "queues messages" is about Kafka; the keyword lists do not. Real embedding models learn from huge amounts of text, so related words and phrasings land near each other without anyone listing them. That is why applications use a trained model (a hosted API or a local model) and why this lesson labels its embedding a teaching model.

**Keep the container running** for the next lesson.

## Common mistakes

- **Comparing vectors from different embedding models.** Each model has its own space; a query must be embedded with the same model as the stored texts.
- **Thinking a high similarity means a correct answer.** It means "about the same thing"; the text may still be outdated or wrong.
- **Re-embedding everything on every request.** Embed stored texts once and keep the vectors; only the question is embedded per request.
- **Sending private data to a hosted embedding API without checking.** Embedding a document sends it to the provider; check what your data rules allow.

## Where this fits in a real system

Embeddings of documents are stored in a vector store — in production often **PostgreSQL** with the pgvector extension, or a dedicated vector database — and refreshed by a pipeline scheduled in **Airflow** when documents change. A cache such as **Redis** can keep the embeddings of frequent questions.
