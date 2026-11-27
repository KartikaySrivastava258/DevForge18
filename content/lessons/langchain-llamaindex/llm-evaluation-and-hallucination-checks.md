---
id: llm-evaluation-and-hallucination-checks
title: Evaluation and hallucination checks
track: langchain-llamaindex
order: 6
level: advanced
estimated_minutes: 50
prerequisites: [langchain-tool-calling-and-agents]
starts_fresh: true
learning_objectives:
  - Build a small evaluation set with reference facts, expected sources and unanswerable questions.
  - Show why exact-match scoring fails for generated text, and score answers by required facts instead.
  - Detect unsupported sentences (hallucinations) by checking each one against the context it cites, and score abstention separately.
  - Use an automated judge only after measuring its agreement with human labels, and turn the scores into a release gate.
resources:
  - title: Evaluation concepts (LangSmith documentation)
    url: https://docs.langchain.com/langsmith/evaluation-concepts
    publisher: LangChain
    type: documentation
    level: advanced
    official: true
    why: Datasets of examples with reference outputs, evaluators (code, human, LLM-as-judge) and comparing versions of an application.
    verification: { status: verified, checked_on: 2026-11-27 }
  - title: OWASP Top 10 for LLM Applications — Misinformation
    url: https://genai.owasp.org/llmrisk/llm092025-misinformation/
    publisher: OWASP Foundation
    type: article
    level: intermediate
    official: true
    why: Hallucination as a source of misinformation, and mitigations such as retrieval grounding, cross-verification and human oversight.
    verification: { status: verified, checked_on: 2026-11-27 }
self_check:
  - id: exact
    prompt: The reference answer is "When its TTL runs out." The system answered "A Redis entry expires once its time-to-live has elapsed [1]." How does exact match score it?
    options:
      - { id: a, text: "Correct" }
      - { id: b, text: "Wrong — the words differ although the meaning is the same; score required facts or meaning instead" }
      - { id: c, text: "Half correct" }
    answer: b
    explanation: The lab's exact-match score is 0 for both systems, which says nothing useful.
  - id: faithful
    prompt: An answer is correct but one sentence is not supported by any retrieved source. Is that a problem?
    options:
      - { id: a, text: "No, the answer is correct" }
      - { id: b, text: "Yes — it is a hallucination that happened to be harmless this time; faithfulness is measured separately from correctness" }
      - { id: c, text: "Only if the user notices" }
    answer: b
    explanation: Unsupported sentences are where wrong information enters; count them even when the final answer is right.
  - id: judge
    prompt: An LLM judge agrees with human reviewers on 4 of 6 examples, and it calls a hallucination "supported". Should it gate releases?
    options:
      - { id: a, text: "Yes, it is automatic" }
      - { id: b, text: "Not yet — it missed exactly the failure it is meant to catch; improve the judge (prompt, model, rubric) and measure agreement again first" }
      - { id: c, text: "Yes, 4 of 6 is a majority" }
    answer: b
    explanation: A judge is a model too; validate it against human labels like any other model.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with python:3.12-slim (pinned by digest) and langchain-core 1.8.4, starting from nothing, and its output is compared with this lesson. The two "systems" are fixed sets of answers and the judge is FakeListChatModel with fixed verdicts — labelled stand-ins, so the evaluation itself is what you see working. The word-overlap faithfulness check is a deliberately simple heuristic, not a standard metric. Checked against the LangSmith and OWASP documentation on 2026-11-27.
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## The idea in one sentence

You cannot improve or safely change an LLM application without **evaluating** it on a fixed set of questions — scoring **correctness** by required facts (not exact words), **faithfulness** by checking every sentence against its sources, and **abstention** on questions it should not answer — and any automated **judge** must itself be checked against human labels.

## Explain it like I'm twelve

A teacher marking essays doesn't ask "is it word-for-word the textbook?" — they check whether the key facts are there, whether each claim can be found in the reading, and whether the student honestly wrote "I don't know" for the question about a chapter nobody read. If a classmate helps with the marking, the teacher first checks the classmate's marks against their own on a few essays.

## What problem it solves

Generated text varies from run to run, sounds confident when wrong, and can be partly right. "It looked fine when I tried it" does not survive a prompt change, a model upgrade or a new document set. A small, fixed evaluation set with the right scores tells you whether a change made things better, catches hallucinations before users do, and gives a release gate the same role tests have for ordinary code.

## How it works

![](media:langchain-llamaindex/evaluation.svg)

- **Dataset**: questions with *required facts*, the source that should support them, and some questions the knowledge base cannot answer.
- **Correctness**: does the answer contain the required facts? (Exact match fails for free text.)
- **Faithfulness**: is every sentence supported by the passage it cites? Unsupported sentences are hallucinations, even inside a correct answer.
- **Abstention**: on unanswerable questions the right answer is "I don't know"; on answerable ones it is a miss.
- **Judges**: an LLM can grade faithfulness at scale, but only after its verdicts agree with human labels well enough — and especially on the failures you care about.

## Try it yourself

> **Local lab** — needs Docker. Two versions of a support assistant are represented by their fixed answers, and the judge by fixed verdicts — labelled stand-ins, so you can watch the evaluation itself. Every command is run automatically in DevForge's tests.

### 1. An evaluation set and two systems' answers

```bash run
mkdir -p eval-lab && cd eval-lab
IMAGE=python:3.12-slim@sha256:191083cdf6c7bda8c76158983163ead5d5cf7b77cf3033e805bb0f5296f51b4b
docker pull -q "$IMAGE" > /dev/null
docker run -d --name devforge-llm -w /lab "$IMAGE" sleep infinity > /dev/null
docker exec devforge-llm pip install -q --root-user-action=ignore --disable-pip-version-check langchain-core==1.8.4
py() { docker exec -i devforge-llm python - "$@"; }
put() { docker exec -i devforge-llm sh -c "cat > /lab/$1"; }
put dataset.py <<'EOF'
SOURCES = {
    "redis-ttl": "A Redis cache entry expires when its TTL runs out; EXPIRE sets the TTL in seconds.",
    "kafka-order": "Kafka keeps the order of events within a partition, not across partitions.",
    "docker-image": "A Docker image is a read-only template; a container is a running instance of an image.",
}
# question, required facts (all must appear), expected source; None = not answerable from the sources
CASES = [
    ("When does a Redis cache entry expire?", ["ttl"], "redis-ttl", "When its TTL runs out."),
    ("Does Kafka keep events in order?", ["within a partition"], "kafka-order", "Only within a partition."),
    ("What is a Docker container?", ["running instance"], "docker-image", "A running instance of an image."),
    ("What is the office Wi-Fi password?", None, None, None),
]
# Answers from two versions of the assistant, each sentence citing the source it used.
SYSTEM_A = [
    "A Redis entry expires once its TTL has elapsed [redis-ttl]. The default TTL is 60 seconds [redis-ttl].",
    "Yes, Kafka keeps order within a partition [kafka-order].",
    "A container is a running instance of an image [docker-image].",
    "The Wi-Fi password is guest123 [redis-ttl].",
]
SYSTEM_B = [
    "A Redis entry expires once its TTL has elapsed [redis-ttl].",
    "Kafka keeps the order of events within a partition only [kafka-order].",
    "It is a running instance of a Docker image [docker-image].",
    "I don't know - the documentation does not cover that.",
]
EOF
py <<'EOF'
from dataset import CASES
answerable = sum(1 for c in CASES if c[1])
print(f"{len(CASES)} questions: {answerable} answerable, {len(CASES) - answerable} not answerable from the sources")
EOF
```

```text output
4 questions: 3 answerable, 1 not answerable from the sources
```

Real evaluation sets have dozens to hundreds of cases, drawn from real user questions; four keep the output readable. The unanswerable question matters as much as the others: it tests whether the system admits ignorance.

### 2. Exact match versus required facts

```bash run
put scores.py <<'EOF'
import re
from dataset import CASES, SOURCES

ABSTAIN = re.compile(r"\bI don't know\b", re.I)

def exact_match(answer, reference):
    return reference is not None and re.sub(r"\s*\[[^]]+\]", "", answer).strip().lower() == reference.lower()

def has_facts(answer, facts):
    return all(f in answer.lower() for f in facts)

STOP = set("a an the is of in it its when once has have and or not only to on for by with yes".split())
def content_words(text):
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in STOP}

def unsupported(answer):
    """Sentences whose content words are mostly missing from the source they cite (a simple heuristic)."""
    bad = []
    for sentence in [s for s in re.split(r"(?<=[.!?])\s+", answer.strip()) if s]:
        cites = re.findall(r"\[([a-z-]+)\]", sentence)
        words = content_words(re.sub(r"\[[^]]+\]", "", sentence))
        support = set().union(*(content_words(SOURCES.get(c, "")) for c in cites)) if cites else set()
        if not cites or len(words & support) / max(len(words), 1) < 0.6:
            bad.append(sentence)
    return bad

def evaluate(answers):
    rows = {"exact match": 0, "correct (facts)": 0, "unsupported sentences": 0, "abstained correctly": 0, "answered when it should abstain": 0}
    for (question, facts, source, reference), answer in zip(CASES, answers):
        abstained = bool(ABSTAIN.search(answer))
        if facts is None:
            rows["abstained correctly" if abstained else "answered when it should abstain"] += 1
            if not abstained:
                rows["unsupported sentences"] += len(unsupported(answer))
            continue
        rows["exact match"] += exact_match(answer, reference)
        rows["correct (facts)"] += has_facts(answer, facts)
        rows["unsupported sentences"] += len(unsupported(answer))
    return rows
EOF
py <<'EOF'
from scores import evaluate
from dataset import SYSTEM_A, SYSTEM_B
a, b = evaluate(SYSTEM_A), evaluate(SYSTEM_B)
print(f"{'':32}{'system A':>10}{'system B':>10}")
for key in a:
    print(f"{key:32}{a[key]:>10}{b[key]:>10}")
EOF
```

```text output
                                  system A  system B
exact match                              0         0
correct (facts)                          3         3
unsupported sentences                    2         0
abstained correctly                      0         1
answered when it should abstain          1         0
```

- **Exact match** gives both systems zero although every answerable question was answered correctly — useless for generated text.
- **Required facts** say both systems are correct on all three answerable questions.
- Only **faithfulness** and **abstention** separate them: system A added "The default TTL is 60 seconds" — a claim its cited source does not make — and invented a Wi-Fi password, citing an unrelated source. System B said nothing it could not support and admitted it did not know.

### 3. Which sentences were unsupported

```bash run
py <<'EOF'
from scores import unsupported
from dataset import SYSTEM_A
for answer in SYSTEM_A:
    for sentence in unsupported(answer):
        print("unsupported:", sentence)
EOF
```

```text output
unsupported: The default TTL is 60 seconds [redis-ttl].
unsupported: The Wi-Fi password is guest123 [redis-ttl].
```

The check compares each sentence's content words with the passage it cites. It is deliberately simple — real systems use an entailment model or an LLM judge — but even this catches a fabricated default and a fabricated password, both of which cite a real source to look trustworthy.

### 4. An automated judge, checked against people

An LLM can judge "is this sentence supported by its source?" at scale. Before relying on it, compare its verdicts with human labels:

```bash run
py <<'EOF'
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from dataset import SOURCES
# (sentence, cited source, human label)
labelled = [
    ("A Redis entry expires once its TTL has elapsed.", "redis-ttl", "supported"),
    ("The default TTL is 60 seconds.", "redis-ttl", "unsupported"),
    ("Kafka keeps order within a partition.", "kafka-order", "supported"),
    ("Kafka keeps order across all partitions.", "kafka-order", "unsupported"),
    ("A container is a running instance of an image.", "docker-image", "supported"),
    ("The Wi-Fi password is guest123.", "redis-ttl", "unsupported"),
]
# Stand-in judges: fixed verdicts, one per sentence, as a real judge model might return.
judges = {
    "lenient judge": FakeListChatModel(responses=["supported", "supported", "supported", "supported", "supported", "unsupported"]),
    "strict judge":  FakeListChatModel(responses=["supported", "unsupported", "supported", "unsupported", "supported", "unsupported"]),
}
for name, judge in judges.items():
    verdicts = [judge.invoke(f"Source: {SOURCES[src]}\nSentence: {s}\nAnswer supported or unsupported.").content
                for s, src, _ in labelled]
    agree = sum(v == human for v, (_, _, human) in zip(verdicts, labelled))
    missed = [s for v, (s, _, human) in zip(verdicts, labelled) if human == "unsupported" and v == "supported"]
    print(f"{name}: agrees with people on {agree}/{len(labelled)}; hallucinations it missed: {len(missed)}")
    for s in missed:
        print("   missed:", s)
EOF
```

```text output
lenient judge: agrees with people on 4/6; hallucinations it missed: 2
   missed: The default TTL is 60 seconds.
   missed: Kafka keeps order across all partitions.
strict judge: agrees with people on 6/6; hallucinations it missed: 0
```

The lenient judge would wave through two of the three hallucinations — including a claim that directly contradicts its source. Measure agreement on the cases that matter (here, the unsupported ones), improve the judge's prompt or model until it is good enough, and re-check it whenever the judge changes.

### 5. A release gate

```bash run
put gate.py <<'EOF'
import sys
from scores import evaluate
import dataset
answers = getattr(dataset, sys.argv[1])
s = evaluate(answers)
failures = [f"{k} = {s[k]}" for k, ok in [("correct (facts)", s["correct (facts)"] == 3),
                                           ("unsupported sentences", s["unsupported sentences"] == 0),
                                           ("answered when it should abstain", s["answered when it should abstain"] == 0)] if not ok]
print(f"{sys.argv[1]}: " + ("PASS" if not failures else "FAIL (" + "; ".join(failures) + ")"))
sys.exit(1 if failures else 0)
EOF
for system in SYSTEM_A SYSTEM_B; do docker exec devforge-llm python /lab/gate.py "$system" || echo "  (exit code $?: this version would not ship)"; done
```

```text output
SYSTEM_A: FAIL (unsupported sentences = 2; answered when it should abstain = 1)
  (exit code 1: this version would not ship)
SYSTEM_B: PASS
```

The gate is an ordinary program with an exit code, so a CI job can run it on every prompt, model or document change — exactly like a test suite — and block a version that starts making things up.

### 6. Clean up

```bash run
docker rm -f devforge-llm > /dev/null
echo removed
```

```text output
removed
```

## Common mistakes

- **Evaluating by eye on a few favourite questions.** Keep a fixed, versioned dataset and grow it from real failures.
- **Exact match or word overlap with a reference as the main score.** Score required facts or meaning.
- **Measuring only correctness.** Faithfulness and abstention catch the failures that hurt users most.
- **Trusting an LLM judge without calibration.** Check it against human labels, especially on the failure cases.
- **No unanswerable questions in the set.** Then you never learn whether the system can say "I don't know".

## Where this fits in a real system

The evaluation set lives in Git next to the prompts; a **GitHub Actions** or **Jenkins** job runs the gate on every change; results and per-case traces are stored (in **MLflow** or an evaluation platform) so versions can be compared; production samples, labelled by people, flow back into the set. The next lesson adds the adversarial cases: prompt injection and data the user may not see.
