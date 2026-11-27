---
id: langchain-handbook-assistant
track: langchain-llamaindex
title: College handbook assistant
level: beginner
estimated_hours: 6
prerequisites: [langchain-prompts-models-and-parsers, langchain-embeddings-and-similarity, llamaindex-chunking-and-retrieval, langchain-rag-with-citations]
related_tracks: [docker]
user_stories:
  - As a first-year student, I want to ask the handbook a question in my own words so that I do not have to read five files to find one rule.
  - As a student, I want every sentence of an answer to show which handbook section it came from so that I can check it before I rely on it.
  - As a help-desk worker, I want the assistant to say "I don't know" when the handbook does not cover a question so that students are never given made-up rules.
acceptance_criteria:
  - load_chunks() splits every handbook section into chunks of at most 120 words, splits the long section into several chunks, covers all the text, and labels every chunk with its file (source) and ## heading (section).
  - For a handbook question, a reply in which every sentence cites a source that was sent is returned with its sources, and the model is called once.
  - For six known questions, the returned sources include the handbook section that answers it (at most five sources).
  - Every source returned with an answer was in the prompt the model received.
  - A reply that cites a source number that was not sent, or has a sentence without a citation, is refused and not shown.
  - Questions the handbook does not cover are refused with no sources, without calling the model.
rubric:
  - { criterion: "Chunking", excellent: "Chunks follow the document's structure (sections, then paragraphs, then sentences), never cut a sentence, and the choice of 120 words is justified by a retrieval experiment.", good: "Chunks are small enough and keep their file and section.", needs_work: "Fixed-size cuts mid-sentence, or chunks that no longer know where they came from." }
  - { criterion: "Grounding and citations", excellent: "The prompt numbers its sources, the reply is checked sentence by sentence, and a rejected reply produces a clear message — not a silent empty answer; the limits of the check (a citation does not prove the source says it) are stated in the README.", good: "Invented and missing citations are rejected.", needs_work: "The reply is shown as the model wrote it." }
  - { criterion: "Refusing", excellent: "The relevance threshold was chosen by trying in-scope and out-of-scope questions and printing their scores; no model call is spent on a question with no relevant source.", good: "Off-topic questions are refused without a model call.", needs_work: "The model is always called, and its \"I don't know\" is trusted." }
  - { criterion: "Code quality", excellent: "Small functions with one job each, the store is built once, constants are named and explained, and the stand-ins could be swapped for real models without touching the pipeline.", good: "Readable and works.", needs_work: "One long function, magic numbers, or the store rebuilt on every question." }
hints:
  - Start with load_chunks() and print every chunk's metadata and word count. The regular expression ^## +(.+)$ (with re.M) finds the headings.
  - Retrieve with similarity_search_with_score and print the scores for a few in-scope and out-of-scope questions before choosing the threshold, as in "A RAG pipeline with citations, in depth".
  - The citation check in that lesson splits the reply into sentences and looks for [n] in each one. A citation is valid when 1 ≤ n ≤ the number of sources you sent.
  - try_it.py calls answer() with scripted replies. Add a reply with a bad citation and one with an uncited sentence to see your checks work before running check.sh.
stretch_goals:
  - Ask the model to correct a rejected reply once, stating the problem, before refusing — and count how often that helps.
  - Replace KeywordEmbedding with a real embedding model and compare which sections are retrieved for the same questions.
  - Chunk with LlamaIndex's SentenceSplitter, as in "Chunking and retrieval with LlamaIndex", and compare the chunks with yours.
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

Students at Northfield College (a fictional college) ask the help desk the same questions every week: how much
attendance they need, what a lost library book costs, when the hostel gates close. Every answer is in the
student handbook — five Markdown files — but nobody reads five files to find one sentence. The help desk wants
an assistant that answers from the handbook, and only from the handbook.

Fluent answers are easy; trustworthy ones are the work. Your assistant must split the handbook into small,
labelled chunks, retrieve the ones that match a question, send them to the model as numbered sources, and then
**check** the reply: every sentence must cite a source that was actually sent. When nothing in the handbook is
relevant it must say so — without asking the model at all.

The model and the embedding are labelled teaching stand-ins (`stand_ins.py`), as in the track's lessons: a
keyword embedding and LangChain's scripted `FakeListChatModel`. No API key is needed, and the check runs your
code with the network switched off. Because the model only says what it is scripted to say, the check can try
good and bad replies on purpose and see whether your pipeline accepts and rejects the right ones.

## Getting started

1. Copy the starter into a new folder. Read `stand_ins.py` and the handbook files.
2. Implement `load_chunks()` in `assistant.py`, then `answer()`. Try them in the lessons' container:

   ```bash
   IMAGE=python:3.12-slim@sha256:191083cdf6c7bda8c76158983163ead5d5cf7b77cf3033e805bb0f5296f51b4b
   docker run --rm -it -e PYTHONDONTWRITEBYTECODE=1 -v "$PWD":/work -w /work "$IMAGE" \
     sh -c "pip install -q -r requirements.txt && python try_it.py"
   ```

3. Run the check. It needs Docker, installs the pinned packages in a throwaway container, and removes it:

   ```bash
   bash check.sh path/to/your/project
   ```
