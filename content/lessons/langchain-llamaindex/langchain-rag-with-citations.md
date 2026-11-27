---
id: langchain-rag-with-citations
title: A RAG pipeline with citations, in depth
track: langchain-llamaindex
order: 4
level: intermediate
estimated_minutes: 45
prerequisites: [llamaindex-chunking-and-retrieval]
starts_fresh: true
learning_objectives:
  - "Build a retrieval-augmented generation (RAG) pipeline with LangChain: documents with metadata, a vector store, scored retrieval, a numbered-sources prompt and a model."
  - Refuse to answer — without calling the model — when nothing relevant is retrieved.
  - Check every citation in an answer against the sources that were actually given to the model, and reject answers that cite nothing or cite sources that do not exist.
  - Return answers with their sources so a user can verify them.
resources:
  - title: Build a Retrieval Augmented Generation (RAG) app (LangChain documentation)
    url: https://docs.langchain.com/oss/python/langchain/rag
    publisher: LangChain
    type: tutorial
    level: intermediate
    official: true
    why: The indexing (load, split, store) and retrieval-and-generation steps of a RAG application in LangChain.
    verification: { status: verified, checked_on: 2026-11-27 }
  - title: InMemoryVectorStore (langchain-core API reference)
    url: https://reference.langchain.com/python/langchain-core/vectorstores/in_memory/InMemoryVectorStore
    publisher: LangChain
    type: reference
    level: intermediate
    official: true
    why: add_documents and similarity_search_with_score (cosine similarity) on the in-memory store used here.
    verification: { status: verified, checked_on: 2026-11-27 }
self_check:
  - id: abstain
    prompt: Nothing in the knowledge base is about the question. What should the pipeline do?
    options:
      - { id: a, text: "Ask the model anyway; it may know" }
      - { id: b, text: "Answer that it does not know, without calling the model — an answer with no supporting sources cannot be checked" }
      - { id: c, text: "Return the closest passage as the answer" }
    answer: b
    explanation: The lab refuses the bread question before any model call; the threshold decides what counts as relevant.
  - id: citation
    prompt: The model's answer cites [3], but only sources [1] and [2] were in the prompt. What does that tell you?
    options:
      - { id: a, text: "Source 3 was retrieved later" }
      - { id: b, text: "The citation is invented; the answer must be rejected or regenerated, because nothing supports that sentence" }
      - { id: c, text: "Nothing — citations are decoration" }
    answer: b
    explanation: Checking citations mechanically catches one common kind of hallucination cheaply.
  - id: metadata
    prompt: Why store source and section metadata with each chunk?
    options:
      - { id: a, text: "To make the index bigger" }
      - { id: b, text: "So answers can link to where each claim came from, and so retrieval can later be filtered (for example by permissions)" }
      - { id: c, text: "The model needs it to work" }
    answer: b
    explanation: The last lesson of this track filters by metadata to enforce permissions.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with python:3.12-slim (pinned by digest), langchain-core 1.8.4 and numpy 2.5.5, starting from nothing, and its output is compared with this lesson. The embedding is the hand-made keyword model from the embeddings lesson and the chat model is FakeListChatModel with fixed replies — labelled teaching stand-ins; no real model is called. Checked against the LangChain documentation and the langchain-core 1.8.4 source on 2026-11-27.
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## The idea in one sentence

A **RAG pipeline** retrieves the passages most similar to a question, gives them to the model as **numbered sources**, and asks for an answer that **cites** them — and a trustworthy one also **refuses** when nothing relevant was found and **checks** that every citation points to a source the model was actually given.

## Explain it like I'm twelve

For a school project you may only use the books on your desk. You number the books, and after every sentence you write "(book 2)". Your teacher checks: is there a book 2 on the desk? Does every sentence have a number? And if none of your books is about the topic, the honest answer is "my books don't cover that" — not something made up.

## What problem it solves

Language models answer fluently whether or not they know. RAG grounds them in your documents, but only if the pipeline is strict: it must not call the model with irrelevant context, must make the model say where each claim came from, and must verify those claims mechanically before showing them. Users then get answers they can check, with links to the source.

## How it works

![](media:langchain-llamaindex/rag-citations.svg)

- **Index**: each chunk is a `Document` with text and **metadata** (`source`, `section`), embedded and stored in a vector store.
- **Retrieve with scores**: `similarity_search_with_score` returns chunks and their cosine similarity; a **threshold** separates relevant from merely closest.
- **Abstain** when nothing passes the threshold — before spending a model call.
- **Prompt**: the passages as `[1] (source#section) text`, with the rule "cite like [1]; if the sources do not answer, say so".
- **Check**: parse `[n]` from the answer; every sentence needs one, and every `n` must be a source that was in the prompt.

## Try it yourself

> **Local lab** — needs Docker. Python runs in a container with exact package versions, as in the first lesson of this track. The embedding and the model are labelled teaching stand-ins, so the lab needs no API key and gives the same output every time. Every command is run automatically in DevForge's tests.

### 1. A container, the teaching embedding, and a small knowledge base

```bash run
mkdir -p rag-lab && cd rag-lab
IMAGE=python:3.12-slim@sha256:191083cdf6c7bda8c76158983163ead5d5cf7b77cf3033e805bb0f5296f51b4b
docker pull -q "$IMAGE" > /dev/null
docker run -d --name devforge-llm -w /lab "$IMAGE" sleep infinity > /dev/null
docker exec devforge-llm pip install -q --root-user-action=ignore --disable-pip-version-check langchain-core==1.8.4 numpy==2.5.5
py() { docker exec -i devforge-llm python - "$@"; }
put() { docker exec -i devforge-llm sh -c "cat > /lab/$1"; }
put knowledge.py <<'EOF'
import re
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from langchain_core.vectorstores import InMemoryVectorStore

# Teaching stand-in for an embedding model (from the embeddings lesson): one number per topic.
TOPICS = {
    "containers": ["docker", "image", "container", "containers"],
    "databases": ["postgresql", "table", "sql", "query", "index"],
    "caching": ["redis", "cache", "ttl", "expire", "expires", "entry"],
    "messaging": ["kafka", "topic", "partition", "partitions", "consumer", "event", "events"],
}

def vector(text):
    words = re.findall(r"[a-z]+", text.lower())
    return [float(sum(words.count(w) for w in keywords)) for keywords in TOPICS.values()]

class KeywordEmbedding(Embeddings):
    def embed_documents(self, texts):
        return [vector(t) for t in texts]
    def embed_query(self, text):
        return vector(text)

store = InMemoryVectorStore(KeywordEmbedding())
store.add_documents([
    Document("A Redis cache entry expires when its TTL runs out; EXPIRE sets the TTL in seconds.",
             metadata={"source": "redis.md", "section": "ttl"}, id="redis-ttl"),
    Document("With no TTL, a Redis key stays until it is deleted or evicted.",
             metadata={"source": "redis.md", "section": "eviction"}, id="redis-evict"),
    Document("Kafka keeps events in a topic split into partitions; order holds within a partition.",
             metadata={"source": "kafka.md", "section": "topics"}, id="kafka-topics"),
    Document("A Docker image is a read-only template; a container is a running instance of it.",
             metadata={"source": "docker.md", "section": "images"}, id="docker-images"),
])
EOF
py <<'EOF'
import langchain_core
from knowledge import store
print("langchain-core", langchain_core.__version__, "| chunks in the store:", len(store.store))
EOF
```

```text output
langchain-core 1.8.4 | chunks in the store: 4
```

Each `Document` carries its text, an ID, and metadata saying where it came from. The keyword embedding is the labelled teaching model from *Embeddings and similarity*.

### 2. Retrieval with scores, and a threshold

```bash run
put pipeline.py <<'EOF'
from knowledge import store, vector

MIN_SCORE = 0.5   # below this, a chunk is "closest" but not relevant

def retrieve(question, k=2):
    if not any(vector(question)):                # the teaching embedding knows none of these words
        return []
    hits = store.similarity_search_with_score(question, k=k)
    return [(doc, score) for doc, score in hits if score >= MIN_SCORE]
EOF
py <<'EOF'
from pipeline import retrieve
for question in ["When does a Redis cache entry expire?", "What does Kafka keep in a topic?", "How do I bake bread?"]:
    hits = retrieve(question)
    print(f"{question:38} → " + (", ".join(f"{d.id} ({s:.2f})" for d, s in hits) or "nothing relevant"))
EOF
```

```text output
When does a Redis cache entry expire?  → redis-ttl (1.00), redis-evict (1.00)
What does Kafka keep in a topic?       → kafka-topics (1.00)
How do I bake bread?                   → nothing relevant
```

- Scores are cosine similarities (1 = same direction). For the Kafka question the second-closest chunk scored below 0.5, so only one source survives. Both Redis chunks score 1.00 because the teaching model knows only four topics, so any two texts about caching point the same way; a real embedding model would rank the TTL passage above the eviction one.
- The bread question contains none of the teaching model's words, so its vector is all zeros. Passing that to the store fails — langchain-core raises `ValueError: NaN values found` when it computes the similarity — so `retrieve` checks first. A real embedding model always returns a non-zero vector, and the score threshold does this job.

### 3. A prompt with numbered sources, and a model

```bash run
put answer.py <<'EOF'
import re
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.prompts import ChatPromptTemplate
from pipeline import retrieve

PROMPT = ChatPromptTemplate.from_messages([
    ("system", "Answer only from the numbered sources. End every sentence with its source, like [1]. "
               "If the sources do not contain the answer, say you do not know.\n\n{sources}"),
    ("human", "{question}"),
])

def format_sources(hits):
    return "\n".join(f"[{i}] ({d.metadata['source']}#{d.metadata['section']}) {d.page_content}" for i, (d, _) in enumerate(hits, 1))

def check_citations(answer, n_sources):
    """Every sentence must cite, and every citation must be a source that was in the prompt."""
    problems = []
    for sentence in [s for s in re.split(r"(?<=[.!?])\s+", answer.strip()) if s]:
        cited = [int(n) for n in re.findall(r"\[(\d+)\]", sentence)]
        if not cited:
            problems.append(f"no citation: {sentence!r}")
        problems += [f"cites [{n}], which was not given" for n in cited if not 1 <= n <= n_sources]
    return problems

def ask(question, model):
    hits = retrieve(question)
    if not hits:
        return {"answer": "I don't know — the documentation does not cover that.", "sources": [], "model_called": False}
    messages = PROMPT.invoke({"sources": format_sources(hits), "question": question})
    answer = model.invoke(messages).content
    problems = check_citations(answer, len(hits))
    return {"answer": answer if not problems else None, "problems": problems, "model_called": True,
            "sources": [f"{d.metadata['source']}#{d.metadata['section']}" for d, _ in hits]}
EOF
py <<'EOF'
from answer import PROMPT, format_sources
from pipeline import retrieve
question = "When does a Redis cache entry expire?"
messages = PROMPT.invoke({"sources": format_sources(retrieve(question)), "question": question}).to_messages()
for m in messages:
    print(f"--- {m.type}\n{m.content}")
EOF
```

```text output
--- system
Answer only from the numbered sources. End every sentence with its source, like [1]. If the sources do not contain the answer, say you do not know.

[1] (redis.md#ttl) A Redis cache entry expires when its TTL runs out; EXPIRE sets the TTL in seconds.
[2] (redis.md#eviction) With no TTL, a Redis key stays until it is deleted or evicted.
--- human
When does a Redis cache entry expire?
```

This is exactly what a real model would receive: the rules, the numbered sources with where they came from, and the question.

### 4. Answers, checked

The stand-in model returns fixed replies, so you can see how the pipeline treats a good answer, an invented citation and an uncited claim:

```bash run
py <<'EOF'
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from answer import ask
question = "When does a Redis cache entry expire?"
replies = {
    "grounded": "It expires when its TTL runs out [1]. Without a TTL it stays until deleted or evicted [2].",
    "invented citation": "It expires after 60 seconds by default [3].",
    "uncited claim": "It expires when its TTL runs out [1]. Redis also replicates every write to three nodes.",
}
for label, reply in replies.items():
    result = ask(question, FakeListChatModel(responses=[reply]))
    verdict = "shown to the user" if result["answer"] else "rejected: " + "; ".join(result["problems"])
    print(f"{label:18} → {verdict}")
print("sources returned with the answer:", ask(question, FakeListChatModel(responses=[replies["grounded"]]))["sources"])
result = ask("How do I bake bread?", FakeListChatModel(responses=["(never used)"]))
print(f"off-topic question → {result['answer']} (model called: {result['model_called']})")
EOF
```

```text output
grounded           → shown to the user
invented citation  → rejected: cites [3], which was not given
uncited claim      → rejected: no citation: 'Redis also replicates every write to three nodes.'
sources returned with the answer: ['redis.md#ttl', 'redis.md#eviction']
off-topic question → I don't know — the documentation does not cover that. (model called: False)
```

- The grounded answer cites a source that was in the prompt for each sentence, and is returned **with** its sources, so the interface can link to them.
- The invented `[3]` — a source that never existed — and the uncited sentence (an unsupported claim about replication) are both caught mechanically. Rejecting is the safe default; asking the model to try again, with the problem stated, is a common next step.
- These checks prove citations point to real sources; they do not prove the cited source *says* what the sentence claims. That needs evaluation — *Evaluation and hallucination checks*.

### 5. Clean up

```bash run
docker rm -f devforge-llm > /dev/null
echo removed
```

```text output
removed
```

## Common mistakes

- **Always calling the model, even with irrelevant context.** It will answer anyway; set a relevance threshold and abstain.
- **Dropping metadata when chunking.** Without `source` and `section` you cannot cite, link, or filter.
- **Trusting citations without checking them.** Models invent plausible source numbers; parse and verify.
- **Returning the answer without its sources.** Users cannot verify what they cannot see.
- **Choosing the threshold by feel.** Measure it on a test set of questions with known answers (the lab in this track).

## Where this fits in a real system

Production RAG stores chunks in a vector database — **PostgreSQL** with pgvector is a common choice — kept fresh by an **Airflow** pipeline that re-chunks changed documents; prompts, retrieval scores and check results are logged (and traced with **OpenTelemetry**) so failures can be investigated; the **Kafka** track's idea of idempotent processing applies to re-indexing too.
