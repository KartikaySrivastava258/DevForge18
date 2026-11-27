---
id: langchain-evaluate-against-a-test-set
title: Evaluate answers against a small test set
track: langchain-llamaindex
level: advanced
mode: local
estimated_minutes: 40
prerequisites: [langchain-embeddings-and-similarity]
objectives:
  - Measure a retriever with a test set of questions and their expected sources, using hit rate and mean reciprocal rank.
  - Use the evaluation as a gate — a change ships only if every must-pass question still finds its source — and improve the retriever until it passes.
  - "Check generated answers for grounding: every citation must point to a passage that was actually retrieved."
checkpoints:
  - { id: failed-first, text: "The first evaluation missed the question about queues and the gate exited with code 1" }
  - { id: improved, text: "After the embedding change, every question found its source" }
  - { id: grounding, text: "The answer that cited a passage it never retrieved was flagged" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: LangChain — vector stores
    url: https://docs.langchain.com/oss/python/integrations/vectorstores/index
    publisher: LangChain
    type: documentation
    level: intermediate
    official: true
    why: Adding documents with ids and searching by similarity — the retriever being evaluated.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: LlamaIndex — evaluating
    url: https://developers.llamaindex.ai/python/framework/module_guides/evaluating/
    publisher: LlamaIndex
    type: documentation
    level: advanced
    official: true
    why: Retrieval metrics such as hit rate and MRR, and evaluating responses for faithfulness.
    verification: { status: verified, checked_on: 2026-11-26 }
verification:
  method: executed
  details: Every step and the check script are run by DevForge's test suite in python:3.12-slim (pinned by digest) with langchain-core 1.8.4, after the previous lessons, and their output is compared with this page. The embedding is the lessons' hand-made keyword model and the answers come from a fake chat model, so no model is called and no API key is needed. The check script is also run in an empty folder, where it must fail.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

"The answers look fine" is not a test. You build a small **test set** — questions with the passage that should answer each — measure the retriever against it, use the result as a **gate**, fix the retriever until the gate passes, and finally check that generated answers only cite passages that were really retrieved.

## Before you start

Continue from *Embeddings and similarity*: the container `devforge-llm` running, your terminal in `llm-lab`, `py` and `put` defined (define them again from the first lesson if you opened a new terminal), and `keyword_embedding.py` saved in the container. Everything runs offline.

## Steps

### 1. The passages and the test set

```bash run
put passages.py <<'EOF'
PASSAGES = {
    "redis-ttl": "Redis keeps data in memory, and a cache entry can expire after a TTL.",
    "pg-index": "PostgreSQL stores rows in a table; an index makes a query faster.",
    "kafka-topics": "Kafka stores events in a topic with several partitions.",
    "docker-image": "Docker builds an image; a container is a running image.",
    "redis-pg-cache": "Redis can sit in front of PostgreSQL as a cache for slow queries.",
}
EOF
put testset.json <<'EOF'
[
  {"question": "When does a cache entry expire?", "source": "redis-ttl"},
  {"question": "How do I make an SQL query faster?", "source": "pg-index"},
  {"question": "Where does Kafka store events?", "source": "kafka-topics"},
  {"question": "What is a running image called?", "source": "docker-image"},
  {"question": "Which tool queues messages for consumers?", "source": "kafka-topics"},
  {"question": "Can Redis cache slow PostgreSQL queries?", "source": "redis-pg-cache"}
]
EOF
echo 'import json; print(len(json.load(open("/lab/testset.json"))), "test questions")' | py
```

```text output
6 test questions
```

Each test case says which passage *should* come back. Writing these down is the real work of evaluation: they encode what "correct" means for your application, including questions phrased the way users actually ask.

### 2. An evaluation script with a gate

```bash run
put evaluate.py <<'EOF'
# Usage: evaluate.py <embedding module>. Exit code 0 only if every question finds its source in the top K.
import importlib, json, sys
from langchain_core.vectorstores import InMemoryVectorStore
from passages import PASSAGES

K = 2
embedding = importlib.import_module(sys.argv[1]).KeywordEmbedding()
store = InMemoryVectorStore(embedding=embedding)
store.add_texts(list(PASSAGES.values()), ids=list(PASSAGES))

tests = json.load(open("/lab/testset.json"))
hits, reciprocal_ranks = 0, 0.0
for t in tests:
    if not any(embedding.embed_query(t["question"])):
        found = []  # the model sees none of its words in the question: nothing can match
    else:
        # Ignore passages with no similarity at all (score 0): they did not match, whatever their order.
        found = [doc.id for doc, score in store.similarity_search_with_score(t["question"], k=K) if score > 0]
    rank = found.index(t["source"]) + 1 if t["source"] in found else None
    hits += rank is not None
    reciprocal_ranks += 1 / rank if rank else 0
    print(f"{'hit ' if rank else 'MISS'}  {t['question']}  (expected {t['source']}, got {found})")
print(f"hit rate @{K}: {hits / len(tests):.2f}   MRR: {reciprocal_ranks / len(tests):.2f}")
sys.exit(0 if hits == len(tests) else 1)
EOF
docker exec -w /lab devforge-llm python evaluate.py keyword_embedding || echo "gate exit code: $?"
```

```text output
hit   When does a cache entry expire?  (expected redis-ttl, got ['redis-ttl', 'redis-pg-cache'])
hit   How do I make an SQL query faster?  (expected pg-index, got ['pg-index', 'redis-pg-cache'])
hit   Where does Kafka store events?  (expected kafka-topics, got ['kafka-topics'])
hit   What is a running image called?  (expected docker-image, got ['docker-image'])
MISS  Which tool queues messages for consumers?  (expected kafka-topics, got [])
hit   Can Redis cache slow PostgreSQL queries?  (expected redis-pg-cache, got ['redis-pg-cache', 'redis-ttl'])
hit rate @2: 0.83   MRR: 0.83
gate exit code: 1
```

- **Hit rate @2**: the share of questions whose expected passage is among the top 2 results.
- **MRR** (mean reciprocal rank): 1 when the right passage comes first, ½ when second, 0 when missing — averaged. It rewards putting the right passage *first*.
- The gate requires every question in this small, hand-picked set to pass, like a regression test suite. 0.83 sounds good; it still means one user in six gets nothing useful.

The miss is the lesson's known weakness: "queues", "messages" and "consumers" are not in the hand-made model's word lists, so the question becomes a vector of zeros and matches nothing. (The script checks for that case itself: langchain-core 1.8.4's in-memory store raises an error when asked to compare an all-zero vector.)

### 3. Improve the retriever, and evaluate again

A real fix would be a better embedding model. Here, extend the messaging topic's words — then let the evaluation decide whether that helped, *and* whether it broke anything else:

```bash run
docker exec devforge-llm sh -c "sed 's/\"event\", \"events\"\]/\"event\", \"events\", \"queue\", \"queues\", \"message\", \"messages\", \"consumers\"]/' /lab/keyword_embedding.py > /lab/keyword_embedding_v2.py"
docker exec -w /lab devforge-llm python evaluate.py keyword_embedding_v2 && echo "gate passed"
```

```text output
hit   When does a cache entry expire?  (expected redis-ttl, got ['redis-ttl', 'redis-pg-cache'])
hit   How do I make an SQL query faster?  (expected pg-index, got ['pg-index', 'redis-pg-cache'])
hit   Where does Kafka store events?  (expected kafka-topics, got ['kafka-topics'])
hit   What is a running image called?  (expected docker-image, got ['docker-image'])
hit   Which tool queues messages for consumers?  (expected kafka-topics, got ['kafka-topics'])
hit   Can Redis cache slow PostgreSQL queries?  (expected redis-pg-cache, got ['redis-pg-cache', 'redis-ttl'])
hit rate @2: 1.00   MRR: 1.00
gate passed
```

The fixed question now passes, and the other five still do — that second part is why you rerun the whole set, not just the failing question.

### 4. Check answers for grounded citations

Retrieval can be right and the answer still wrong. A simple, automatic check: an answer may only cite passages that were retrieved for its question. Here a fake chat model stands in for the LLM, with three answers — one of them citing a passage it was never given:

```bash run
put grade_answers.py <<'EOF'
import re
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.vectorstores import InMemoryVectorStore
from keyword_embedding_v2 import KeywordEmbedding
from passages import PASSAGES

store = InMemoryVectorStore(embedding=KeywordEmbedding())
store.add_texts(list(PASSAGES.values()), ids=list(PASSAGES))
model = FakeListChatModel(responses=[
    "A cache entry expires after its TTL [redis-ttl].",
    "Kafka stores events in topics [kafka-topics].",
    "Use an index, and run Docker [docker-image].",
])
for question in ["When does a cache entry expire?", "Where does Kafka store events?", "How do I make an SQL query faster?"]:
    retrieved = {doc.id for doc, score in store.similarity_search_with_score(question, k=2) if score > 0}
    answer = model.invoke(question).content
    cited = set(re.findall(r"\[([a-z0-9-]+)\]", answer))
    verdict = "grounded" if cited and cited <= retrieved else f"NOT grounded: cites {sorted(cited - retrieved)}"
    print(f"{verdict:42} {answer}")
EOF
docker exec -w /lab devforge-llm python grade_answers.py
```

```text output
grounded                                   A cache entry expires after its TTL [redis-ttl].
grounded                                   Kafka stores events in topics [kafka-topics].
NOT grounded: cites ['docker-image']       Use an index, and run Docker [docker-image].
```

The third answer cites `docker-image`, which was not among the passages retrieved for an SQL question — the model invented that support. This check cannot tell whether a grounded answer *says* the right thing; tools such as LlamaIndex's evaluators use a second model to judge that, which costs model calls. A cheap rule like this one still catches a whole class of fabricated sources on every run.

## Check your work

Run this inside `llm-lab` while the container is running.

```bash run check
bash <<'CHECK'
fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
run() { docker exec -w /lab devforge-llm python "$@"; }
check "the test set has at least 6 questions" '[ "$(docker exec devforge-llm python -c "import json; print(len(json.load(open(\"/lab/testset.json\"))))")" -ge 6 ]'
check "the original embedding fails the gate" '! run evaluate.py keyword_embedding'
check "the improved embedding passes the gate" 'run evaluate.py keyword_embedding_v2'
check "the improved retriever finds every source (hit rate 1.00)" 'run evaluate.py keyword_embedding_v2 | grep "hit rate @2: 1.00" > /dev/null'
check "the ungrounded citation is flagged" 'run grade_answers.py | grep "NOT grounded: cites \[.docker-image.\]" > /dev/null'
if [ "$fail" -eq 0 ]; then echo "All checks passed"; else echo "Some checks failed"; exit 1; fi
CHECK
```

```text output
PASS: the test set has at least 6 questions
PASS: the original embedding fails the gate
PASS: the improved embedding passes the gate
PASS: the improved retriever finds every source (hit rate 1.00)
PASS: the ungrounded citation is flagged
All checks passed
```

## Clean up

```bash run
docker rm -f devforge-llm
```

```text output
devforge-llm
```

## Reset

Remove the container (as above), start it again with step 1 of *Prompts, models and parsers*, redo step 1 of *Embeddings and similarity*, then begin this lab at step 1.

## What you practised

Evaluation turns "it seems to work" into numbers you can gate on: a test set of real questions with expected sources, hit rate and MRR for retrieval, a rerun of the whole set after every change, and cheap automatic checks on answers — such as citations that must point to retrieved passages — before any expensive model-graded evaluation.
