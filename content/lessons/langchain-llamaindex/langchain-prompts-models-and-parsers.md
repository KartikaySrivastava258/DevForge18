---
id: langchain-prompts-models-and-parsers
title: Prompts, models and output parsers
track: langchain-llamaindex
order: 1
level: beginner
estimated_minutes: 35
prerequisites: [docker-images-vs-containers]
learning_objectives:
  - Explain what an LLM application adds around a model — prompts, parsing, validation — and what it does not.
  - Build a LangChain chain from a prompt template, a chat model and an output parser.
  - Validate a model's structured output and handle replies that are not what you asked for.
resources:
  - title: LangChain documentation (Python)
    url: https://docs.langchain.com/oss/python/langchain/overview
    publisher: LangChain
    type: documentation
    level: all
    official: true
    why: The current LangChain documentation, including chat models, structured output and integrations.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: LangChain chat models
    url: https://docs.langchain.com/oss/python/langchain/models
    publisher: LangChain
    type: documentation
    level: beginner
    official: true
    why: How real chat models are configured, and structured output from them.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: what-framework-does
    prompt: What does LangChain do in this lesson's chain?
    options:
      - { id: a, text: "It is the language model" }
      - { id: b, text: "It fills in the prompt, sends the messages to a model, and turns the reply into data your code can use — the model itself is a separate component" }
      - { id: c, text: "It guarantees the model's answers are correct" }
    answer: b
    explanation: The framework connects pieces — prompts, a model, parsers. Swapping the fake model for a real one changes the answers, not the structure, and nothing in the framework makes an answer true.
  - id: validate
    prompt: The model replied with valid JSON, {"tool":"Docker","level":"expert"}, but your code only allows beginner, intermediate or advanced. What should happen?
    options:
      - { id: a, text: "Accept it — it is valid JSON" }
      - { id: b, text: "Validate it against a schema, reject it, and retry or report the error" }
      - { id: c, text: "Change the code to accept anything" }
    answer: b
    explanation: You see this in the lesson. Parsing JSON only checks the syntax; a schema (here a Pydantic model) checks that the values are ones your program can handle.
  - id: why-fake
    prompt: Why does this lesson use a fake chat model?
    options:
      - { id: a, text: "Fake models are better than real ones" }
      - { id: b, text: "So that it runs without an API key or cost, and gives the same output every time — which also makes it the right tool for testing your own code" }
      - { id: c, text: "LangChain cannot use real models" }
    answer: b
    explanation: LangChain's fake chat models are documented as being for testing. Real models need a provider account and a key, cost money per call, and may answer differently each time.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with python:3.12-slim (pinned by digest) and langchain-core 1.8.4; the output shown was recorded from that run. No real model is called. Facts about the classes used were checked against the langchain-core 1.8.4 source and docstrings on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

An **LLM application** is ordinary code around a language model: it builds the **prompt** from your data, sends it to a **model**, and **parses and validates** the reply — and **LangChain** gives each of those steps a standard building block that can be chained together.

## Explain it like I'm twelve

Imagine asking a very well-read friend for help by letter. You write the letter the same way every time — "Dear friend, about *this topic*, please answer *this question* in one sentence" — and only fill in the blanks. When the answer comes back, you check it says what you need before you use it.

The letter with blanks is the **prompt template**, your friend is the **model**, and checking the reply is **parsing and validation**. LangChain is the stationery set that makes all three easy to connect.

Where the analogy breaks: your friend sometimes answers confidently and wrongly. Nothing about the letter-writing makes the answer true.

## What problem it solves

Calling a model directly is one HTTP request. A real application needs more: the same prompt filled from different data, the reply turned into something a program can use, errors handled when the reply is not what was asked for, and the freedom to change model provider without rewriting everything. LangChain provides those pieces with one interface, so they can be combined and tested.

## How it works

![](media:langchain-llamaindex/chain-parts.svg)

- A **prompt template** turns variables into a list of **messages** (system, human…).
- A **chat model** takes messages and returns a message. Every provider's model has the same interface, and so do LangChain's **fake** models for tests.
- An **output parser** turns the reply into a string, JSON or other data.
- Each piece is a **Runnable** — in langchain-core's words, "a unit of work that can be invoked, batched, streamed, transformed and composed". `prompt | model | parser` composes them into one runnable chain.

## Try it yourself

> **Local lab** — needs Docker. Python and LangChain run in a container, so nothing is installed on your computer, and **no real model is called**: no API key, no cost, the same output every time. Every command is run automatically in DevForge's tests. Run it where nothing else is called `devforge-llm`; the last lesson of this series removes it.

### 1. A Python container with LangChain

```bash run
mkdir -p llm-lab && cd llm-lab
IMAGE=python:3.12-slim@sha256:191083cdf6c7bda8c76158983163ead5d5cf7b77cf3033e805bb0f5296f51b4b
docker pull -q "$IMAGE"
docker run -d --name devforge-llm -w /lab "$IMAGE" sleep infinity > /dev/null
docker exec devforge-llm pip install -q --root-user-action=ignore --disable-pip-version-check langchain-core==1.8.4 numpy==2.5.5
py() { docker exec -i devforge-llm python - "$@"; }
put() { docker exec -i devforge-llm sh -c "cat > /lab/$1"; }
echo 'import langchain_core; print("langchain-core", langchain_core.__version__)' | py
```

```text output
docker.io/library/python:3.12-slim@sha256:191083cdf6c7bda8c76158983163ead5d5cf7b77cf3033e805bb0f5296f51b4b
langchain-core 1.8.4
```

- The container runs `sleep infinity` so it stays up; the lessons run Python inside it.
- `pip install … langchain-core==1.8.4 numpy==2.5.5` installs LangChain's core package at an exact version, and numpy, which its in-memory vector store needs for the similarity maths (next lesson).
- Two small shell functions: `py` runs the Python you pipe into it inside the container; `put name.py` saves what you pipe into it as `/lab/name.py`, so later scripts can import it. If you open a new terminal, define them again.

### 2. A prompt template

```bash run
put course_prompt.py <<'EOF'
from langchain_core.prompts import ChatPromptTemplate

prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a teaching assistant for {course}. Answer in one sentence."),
    ("human", "{question}"),
])
EOF
py <<'EOF'
from course_prompt import prompt

for message in prompt.invoke({"course": "DevForge", "question": "What does Docker do?"}).to_messages():
    print(f"{message.type}: {message.content}")
EOF
```

```text output
system: You are a teaching assistant for DevForge. Answer in one sentence.
human: What does Docker do?
```

The template has two blanks, `{course}` and `{question}`. `invoke` fills them and produces the exact messages a model would receive: a **system** message that sets the rules, and a **human** message with the question.

### 3. A chain: prompt → model → parser

```bash run
py <<'EOF'
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.output_parsers import StrOutputParser
from course_prompt import prompt

model = FakeListChatModel(responses=["Docker packages an application and everything it needs into an image that runs the same way everywhere."])
chain = prompt | model | StrOutputParser()
print(type(chain).__name__)
print(chain.invoke({"course": "DevForge", "question": "What does Docker do?"}))
EOF
```

```text output
RunnableSequence
Docker packages an application and everything it needs into an image that runs the same way everywhere.
```

- `FakeListChatModel` is a chat model "for testing purposes" (its own description): it replies with the answers you give it, in order. It stands where a real model would.
- `prompt | model | StrOutputParser()` is a **RunnableSequence**: the prompt's messages go to the model, and the model's reply message is turned into a plain string.
- To use a real model, you would replace only the `model = …` line with a provider's chat model — for example from the `langchain-openai` or `langchain-anthropic` package — and set that provider's API key. That costs money per call and is never run in DevForge's tests.

### 4. Structured output, validated

Programs need data, not prose. Ask for JSON — and check what comes back. Here, three fake replies: a good one, one that is not JSON, and valid JSON with a value your program does not allow:

```bash run
py <<'EOF'
from typing import Literal
from pydantic import BaseModel, ValidationError
from langchain_core.exceptions import OutputParserException
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.prompts import ChatPromptTemplate

class TrackInfo(BaseModel):
    tool: str
    level: Literal["beginner", "intermediate", "advanced"]

prompt = ChatPromptTemplate.from_messages([("human", "Reply with JSON: the tool in '{text}' and its level.")])
replies = ['{"tool": "Docker", "level": "beginner"}', "Sure! Docker is a beginner topic.", '{"tool": "Docker", "level": "expert"}']
for reply in replies:
    chain = prompt | FakeListChatModel(responses=[reply]) | JsonOutputParser()
    try:
        info = TrackInfo.model_validate(chain.invoke({"text": "Docker for beginners"}))
        print("accepted:", info)
    except OutputParserException as e:
        print("not JSON:", str(e).splitlines()[0])
    except ValidationError as e:
        print("rejected:", e.errors()[0]["loc"][0], "-", e.errors()[0]["msg"])
EOF
```

```text output
accepted: tool='Docker' level='beginner'
not JSON: Invalid json output: Sure! Docker is a beginner topic.
rejected: level - Input should be 'beginner', 'intermediate' or 'advanced'
```

- `JsonOutputParser` turns the reply into a Python dictionary — or raises an error when the reply is not JSON at all.
- It does not check the *values*. The **Pydantic** model `TrackInfo` does: `level` must be one of three words, so `"expert"` is rejected with a clear reason.
- A real application would retry, ask the model to fix its answer, or report the error — never pass unchecked model output on to the rest of the program.

**Keep the container running** for the next lesson.

## Common mistakes

- **Trusting the model's output without validation.** Models can return prose instead of JSON, or plausible but invalid values. Parse *and* validate.
- **Building prompts by string concatenation everywhere.** Templates keep the prompt in one place, make the variables explicit and are easy to test.
- **Putting API keys in code or prompts.** Keys belong in environment variables or a secret manager; a prompt is data sent to someone else's server.
- **Testing against a real model only.** Fake models make tests fast, free and repeatable; keep a few separate checks against the real model.
- **Thinking the framework makes answers true.** It moves text around reliably; checking facts is still your job (later lessons: retrieval and citations).

## Where this fits in a real system

An API built with any web framework, behind **Nginx**, calls a chain like this one; the model provider's key lives in the platform's secret store. Requests and costs are watched with **Prometheus** and traced with **OpenTelemetry**, and tests in **GitHub Actions** run the chain against fake models on every change.
