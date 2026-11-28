---
id: llamaindex-index-course-pdfs
title: Index a set of course PDFs
track: langchain-llamaindex
level: intermediate
mode: local
estimated_minutes: 45
prerequisites: [llamaindex-chunking-and-retrieval]
objectives:
  - Extract text from PDF files page by page with pypdf, and notice pages that have no text layer.
  - Turn each page into a LlamaIndex Document with the file name and page number as metadata, so answers can cite "file, page".
  - Chunk, embed and index the pages, save the index to disk and load it again without re-reading the PDFs.
checkpoints:
  - { id: empty-page, text: "The extraction step reported that scanned-handout.pdf has no text on its page" }
  - { id: citation, text: "The reloaded index answered the TTL question from redis-notes.pdf, page 2" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: Documents and Nodes (LlamaIndex)
    url: https://developers.llamaindex.ai/python/framework/module_guides/loading/documents_and_nodes/
    publisher: LlamaIndex
    type: documentation
    level: intermediate
    official: true
    why: How LlamaIndex represents your data (Documents) and their chunks (Nodes), including metadata.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: VectorStoreIndex (LlamaIndex)
    url: https://developers.llamaindex.ai/python/framework/module_guides/indexing/vector_store_index/
    publisher: LlamaIndex
    type: documentation
    level: intermediate
    official: true
    why: Building an index from nodes and querying it.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: pypdf documentation — extract text from a PDF
    url: https://pypdf.readthedocs.io/en/stable/user/extract-text.html
    publisher: pypdf
    type: documentation
    level: intermediate
    official: true
    why: How page.extract_text() works, and that pypdf never extracts text from images, so a scanned page without an OCR text layer needs OCR (for example Tesseract).
    verification: { status: verified, checked_on: 2026-11-28 }
verification:
  method: executed
  details: Every step and the check script are run by DevForge's test suite on a disposable Docker engine with python:3.12-slim (pinned by digest), llama-index-core 0.14.26, pypdf 7.0.1 and fpdf2 2.9.0 (used only to generate the sample PDFs), and their output is compared with this page. The check script is also run in an empty folder, where it must fail. The embedding is a hand-made keyword model, labelled as a teaching stand-in, and no language model is called.
starts_fresh: true
owner: content-team
last_reviewed: 2026-11-28
content_version: 1
---

## Goal

Your course notes are PDFs, not neat text files. You build the first half of a question-answering system over them: read every page, keep track of which file and page each piece of text came from, index the text, save the index, and retrieve passages that cite *file and page* — then prove it with a check script. Along the way you meet the PDF that has no text at all.

## Before you start

You need Docker, as in *Chunking, retrieval and the prompt a RAG system builds*. Everything runs in a Python container, so nothing is installed on your machine. The lab downloads about 60 MB of Python packages, at exact versions.

As in the earlier lessons, the **embedding is a teaching stand-in**: one number per topic, counted from keywords, so you can see why a passage matched. A real system uses an embedding model; the PDF handling, metadata and index steps stay the same. No language model is called.

## Steps

### 1. A container with pinned packages

```bash run
mkdir pdf-lab && cd pdf-lab
IMAGE=python:3.12-slim@sha256:191083cdf6c7bda8c76158983163ead5d5cf7b77cf3033e805bb0f5296f51b4b
docker pull -q "$IMAGE" > /dev/null
docker run -d --name devforge-llm-pdf -w /lab "$IMAGE" sleep infinity > /dev/null
docker exec devforge-llm-pdf pip install -q --root-user-action=ignore --disable-pip-version-check \
  llama-index-core==0.14.26 pypdf==7.0.1 fpdf2==2.9.0
py() { docker exec -i devforge-llm-pdf python - "$@"; }
put() { docker exec -i devforge-llm-pdf sh -c "cat > /lab/$1"; }
py <<'EOF'
from importlib.metadata import version
for p in ("llama-index-core", "pypdf", "fpdf2"):
    print(p, version(p))
EOF
```

```text output
llama-index-core 0.14.26
pypdf 7.0.1
fpdf2 2.9.0
```

`py` runs the Python you pipe into it inside the container; `put name` saves what you pipe into it as `/lab/name`. If you open a new terminal, define them again.

### 2. Three course PDFs

Your own PDFs would come from a course site. Here a short script makes three: two with text, and one that imitates a **scanned** handout — a page that is only a picture, with no text inside the PDF.

```bash run
put make_pdfs.py <<'EOF'
from fpdf import FPDF

def make(name, pages):
    pdf = FPDF()
    pdf.set_font("Helvetica", size=12)
    for text in pages:
        pdf.add_page()
        pdf.multi_cell(0, 8, text)
    pdf.output(f"pdfs/{name}")

make("redis-notes.pdf", [
    "Week 4: Redis. Redis keeps data in memory, which makes reads very fast. "
    "It is often used as a cache in front of a slower database such as PostgreSQL.",
    "Expiry. Every cache entry can be given a TTL. When the TTL runs out, the entry expires "
    "and Redis deletes it, so the next read goes to the database again.",
])
make("kafka-notes.pdf", [
    "Week 6: Kafka. Kafka stores events in topics. A topic is split into partitions, "
    "and the events of one partition keep their order.",
    "Consumers. A consumer group shares the partitions of a topic between its members. "
    "Events are not deleted when a consumer reads them; they stay until the retention time passes.",
])
scan = FPDF()
scan.add_page()
scan.rect(20, 20, 170, 120, style="F")   # a picture of a page: no text layer
scan.output("pdfs/scanned-handout.pdf")
EOF
docker exec devforge-llm-pdf sh -c 'mkdir -p pdfs && python make_pdfs.py && ls pdfs'
```

```text output
kafka-notes.pdf
redis-notes.pdf
scanned-handout.pdf
```

### 3. Extract the text, page by page

```bash run
put extract.py <<'EOF'
import re
from pathlib import Path
from pypdf import PdfReader

def pages(folder="pdfs"):
    """Yield (file, page number, text) for every page; page numbers start at 1, as people count them."""
    for path in sorted(Path(folder).glob("*.pdf")):
        for number, page in enumerate(PdfReader(path).pages, start=1):
            # PDF text comes with the line breaks of the layout; join it into plain sentences.
            text = re.sub(r"\s+", " ", page.extract_text() or "").strip()
            yield path.name, number, text
EOF
py <<'EOF'
from extract import pages
for file, number, text in pages():
    print(f"{file} p.{number}: {len(text.split())} words" + ("" if text else "  <- no text layer (scanned?)"))
EOF
```

```text output
kafka-notes.pdf p.1: 23 words
kafka-notes.pdf p.2: 29 words
redis-notes.pdf p.1: 29 words
redis-notes.pdf p.2: 30 words
scanned-handout.pdf p.1: 0 words  <- no text layer (scanned?)
```

`extract_text()` reads the text *objects* inside a PDF. A scanned page is a picture of text, so there is nothing to extract: it needs **OCR** (optical character recognition) first — a separate tool, with its own errors to check. An index built without noticing this simply misses that handout, and nobody sees an error.

### 4. Pages become Documents with citations

```bash run
put course_index.py <<'EOF'
import re
from llama_index.core import Document, Settings, VectorStoreIndex
from llama_index.core.embeddings import BaseEmbedding
from llama_index.core.node_parser import SentenceSplitter
from extract import pages

TOPICS = {
    "containers": ["docker", "image", "container"],
    "databases": ["postgresql", "database", "sql", "query"],
    "caching": ["redis", "cache", "ttl", "expires", "expiry"],
    "messaging": ["kafka", "topic", "topics", "partition", "partitions", "consumer", "events"],
}

def vector(text):
    words = re.findall(r"[a-z]+", text.lower())
    return [float(sum(words.count(w) for w in keywords)) for keywords in TOPICS.values()]

class KeywordEmbedding(BaseEmbedding):
    """Teaching stand-in for an embedding model: one number per topic."""
    def _get_text_embedding(self, text):
        return vector(text)
    def _get_query_embedding(self, query):
        return vector(query)
    async def _aget_query_embedding(self, query):
        return vector(query)

Settings.embed_model = KeywordEmbedding()

def documents():
    docs, skipped = [], []
    for file, number, text in pages():
        if text:
            docs.append(Document(text=text, metadata={"file": file, "page": number}))
        else:
            skipped.append(f"{file} p.{number}")
    return docs, skipped

def build():
    docs, skipped = documents()
    nodes = SentenceSplitter(chunk_size=60, chunk_overlap=0, tokenizer=str.split).get_nodes_from_documents(docs)
    return VectorStoreIndex(nodes), docs, skipped
EOF
py <<'EOF'
from course_index import build
index, docs, skipped = build()
print(f"{len(docs)} pages indexed, skipped: {', '.join(skipped)}")
for node in index.docstore.docs.values():
    print(f"  {node.metadata['file']} p.{node.metadata['page']}: {node.text[:50]}...")
EOF
```

```text output
4 pages indexed, skipped: scanned-handout.pdf p.1
  kafka-notes.pdf p.1: Week 6: Kafka. Kafka stores events in topics. A to...
  kafka-notes.pdf p.2: Consumers. A consumer group shares the partitions ...
  redis-notes.pdf p.1: Week 4: Redis. Redis keeps data in memory, which m...
  redis-notes.pdf p.2: Expiry. Every cache entry can be given a TTL. When...
```

One Document per **page**, not per file, so every chunk knows its page. `SentenceSplitter` copies the metadata to every chunk it cuts.

### 5. Save the index, load it, retrieve with citations

Embedding every page again for each question would be slow and, with a paid embedding model, expensive. `persist` writes the index to a folder; `load_index_from_storage` reads it back.

```bash run
py <<'EOF'
from course_index import build
index, _, _ = build()
index.storage_context.persist(persist_dir="storage")
EOF
docker exec devforge-llm-pdf ls storage
py <<'EOF'
import course_index  # sets the same embedding model, which the loaded index needs for questions
from llama_index.core import StorageContext, load_index_from_storage
index = load_index_from_storage(StorageContext.from_defaults(persist_dir="storage"))
for question in ["What happens when the TTL of a cache entry runs out?", "Are events deleted when a consumer reads them?"]:
    print(question)
    hits = index.as_retriever(similarity_top_k=2).retrieve(question)
    # Ties are printed in file and page order, so the output is the same on every run.
    for hit in sorted(hits, key=lambda h: (-round(h.score, 2), h.node.metadata["file"], h.node.metadata["page"])):
        if hit.score > 0:
            print(f"  {hit.score:.2f} [{hit.node.metadata['file']}, page {hit.node.metadata['page']}] {hit.node.text[:60]}...")
EOF
```

```text output
default__vector_store.json
docstore.json
graph_store.json
image__vector_store.json
index_store.json
What happens when the TTL of a cache entry runs out?
  0.99 [redis-notes.pdf, page 2] Expiry. Every cache entry can be given a TTL. When the TTL r...
  0.89 [redis-notes.pdf, page 1] Week 4: Redis. Redis keeps data in memory, which makes reads...
Are events deleted when a consumer reads them?
  1.00 [kafka-notes.pdf, page 1] Week 6: Kafka. Kafka stores events in topics. A topic is spl...
  1.00 [kafka-notes.pdf, page 2] Consumers. A consumer group shares the partitions of a topic...
```

Both Kafka pages score 1.00 for the second question: the teaching embedding only counts topic words, so it cannot tell the page about deletion from the page about partitions — a real embedding model, which captures meaning, would rank page 2 first. Either way, the citation is what makes an answer checkable: a reader can open `redis-notes.pdf` at page 2 and see the sentence. A question-answering app passes these passages to a model, as in *A RAG pipeline with citations, in depth*.

## Check your work

Run this inside `pdf-lab` while the container is running. It loads the saved index itself.

```bash run check
bash <<'CHECK'
fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
inpy() { docker exec -i devforge-llm-pdf python - ; }
check "the container devforge-llm-pdf is running" '[ "$(docker inspect -f "{{.State.Running}}" devforge-llm-pdf)" = true ]'
check "the index was saved to /lab/storage" 'docker exec devforge-llm-pdf test -s /lab/storage/docstore.json'
check "every saved chunk names its file and page" 'echo "
import json
d = json.load(open(\"storage/docstore.json\"))[\"docstore/data\"]
meta = [v[\"__data__\"][\"metadata\"] for v in d.values()]
assert meta and all(m.get(\"file\", \"\").endswith(\".pdf\") and isinstance(m.get(\"page\"), int) for m in meta)
" | inpy'
check "the scanned handout produced no empty chunks" 'echo "
import json
d = json.load(open(\"storage/docstore.json\"))[\"docstore/data\"]
assert all(v[\"__data__\"][\"text\"].strip() for v in d.values())
" | inpy'
check "the reloaded index cites redis-notes.pdf, page 2 for the TTL question" 'echo "
import course_index
from llama_index.core import StorageContext, load_index_from_storage
index = load_index_from_storage(StorageContext.from_defaults(persist_dir=\"storage\"))
hits = index.as_retriever(similarity_top_k=2).retrieve(\"What happens when the TTL of a cache entry runs out?\")
assert any(h.node.metadata == {\"file\": \"redis-notes.pdf\", \"page\": 2} and \"expires\" in h.node.text for h in hits)
" | inpy'
if [ "$fail" -eq 0 ]; then echo "All checks passed"; else echo "Some checks failed"; exit 1; fi
CHECK
```

```text output
PASS: the container devforge-llm-pdf is running
PASS: the index was saved to /lab/storage
PASS: every saved chunk names its file and page
PASS: the scanned handout produced no empty chunks
PASS: the reloaded index cites redis-notes.pdf, page 2 for the TTL question
All checks passed
```

## Clean up

```bash run
docker rm -f devforge-llm-pdf
```

```text output
devforge-llm-pdf
```

All the lab's files lived in the container, so removing it removes them too.

## Reset

- **The name is already in use?** A container from an earlier attempt still exists: `docker rm -f devforge-llm-pdf`.
- **Start again:** remove the container, delete the `pdf-lab` folder — `cd .. && rm -rf pdf-lab` — and begin at step 1.

## What you practised

Indexing real documents is mostly careful bookkeeping: extract text page by page, notice what could not be extracted, keep the file and page with every chunk, and save the index so it is built once. Those citations are what let a reader — or an evaluation script — check an answer against its source.
