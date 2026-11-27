#!/usr/bin/env bash
# Acceptance check for "College handbook assistant".
# Usage: bash check.sh path/to/your/project   (the folder with assistant.py, stand_ins.py, handbook/ and requirements.txt)
# Needs Docker. Starts one throwaway Python container (the image the track's lessons use), installs the pinned
# packages from requirements.txt once, then cuts the container off the network and runs the tests below inside it
# — so your code cannot call a real model or any paid service. The chat model is a scripted stand-in that records
# the prompt it receives. Prints PASS or FAIL per criterion and exits non-zero if any fails. Removes the container.
set -uo pipefail
dir="${1:-.}"
image="python:3.12-slim@sha256:191083cdf6c7bda8c76158983163ead5d5cf7b77cf3033e805bb0f5296f51b4b"
name="devforge-check-llm-handbook-$$"
# The only packages the check installs: the exact versions the track's lessons run.
allowed="langchain-core==1.8.4 numpy==2.5.5 llama-index-core==0.14.26"
failures=0
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
  exit 0
}

for f in assistant.py stand_ins.py handbook/attendance.md; do
  [ -f "$dir/$f" ] || { fail "$dir/$f is missing"; finish; }
done
pins=""
if [ -f "$dir/requirements.txt" ]; then
  while read -r line; do
    line="${line%%#*}"; line="$(echo "$line" | tr -d '[:space:]')"
    [ -z "$line" ] && continue
    case " $allowed " in *" $line "*) pins="$pins $line" ;; *) fail "requirements.txt: \"$line\" is not one of the pinned versions the check installs ($allowed)"; finish ;; esac
  done < "$dir/requirements.txt"
fi
[ -n "$pins" ] || pins=" langchain-core==1.8.4 numpy==2.5.5"
echo "PASS: requirements.txt pins only versions the lessons use:$pins"

trap 'docker rm -f -v "$name" > /dev/null 2>&1' EXIT
docker run -d --name "$name" "$image" sleep infinity > /dev/null || { fail "could not start the Python container in Docker"; finish; }
# shellcheck disable=SC2086  # $pins is a list of words
if ! out="$(docker exec "$name" pip install -q --root-user-action=ignore --disable-pip-version-check $pins 2>&1)"; then
  fail "pip could not install$pins: $(echo "$out" | tail -n 1)"; finish
fi
docker network disconnect bridge "$name" > /dev/null 2>&1 || true   # from here on: no network at all
docker exec "$name" mkdir -p /work
docker cp "$dir/." "$name:/work/" > /dev/null || { fail "could not copy $dir into the container"; finish; }

# The tests: Python, inside the container, importing your assistant.py.
results="$(timeout 240 docker exec -i -w /work "$name" python -B - 2>&1 <<'PY'
import re, sys, traceback
from pathlib import Path
sys.path.insert(0, "/work")

def ok(msg): print(f"PASS: {msg}")
def bad(msg): print(f"FAIL: {msg}")
def why(e): return f"{e.__class__.__name__}: {str(e).splitlines()[0] if str(e) else ''}"

from langchain_core.language_models.fake_chat_models import FakeListChatModel

class RecordingModel(FakeListChatModel):
    """The scripted stand-in model the check passes to answer(): fixed replies, and a record of every prompt."""
    received: list = []
    def _call(self, messages, stop=None, run_manager=None, **kwargs):
        self.received.append("\n".join(str(m.content) for m in messages))
        return super()._call(messages, stop=stop, run_manager=run_manager, **kwargs)
    def _stream(self, messages, stop=None, run_manager=None, **kwargs):
        self.received.append("\n".join(str(m.content) for m in messages))
        yield from super()._stream(messages, stop=stop, run_manager=run_manager, **kwargs)

def model(reply):
    return RecordingModel(responses=[reply], received=[])

try:
    import assistant
    missing = [f for f in ("load_chunks", "answer") if not callable(getattr(assistant, f, None))]
    if missing:
        raise AttributeError("assistant.py must define " + " and ".join(missing))
except Exception as e:
    bad(f"assistant.py cannot be imported with load_chunks() and answer(): {why(e)}")
    sys.exit(0)

WORD = re.compile(r"[a-z0-9]+")
def words(text): return WORD.findall(text.lower())

# The handbook as the check reads it: {(file, heading): text}.
sections = {}
for path in sorted(Path("/work/handbook").glob("*.md")):
    for m in re.finditer(r"^## +(.+?)\s*\n(.*?)(?=^## |\Z)", path.read_text(encoding="utf-8"), re.M | re.S):
        sections[(path.name, m.group(1).strip())] = m.group(2)

# --- Chunking keeps metadata ---------------------------------------------------------------------------------
try:
    chunks = list(assistant.load_chunks())
    problems, per_section = [], {}
    for c in chunks:
        meta = getattr(c, "metadata", None) or {}
        key = (meta.get("source"), meta.get("section"))
        text = getattr(c, "page_content", None) or getattr(c, "text", "")
        if key not in sections:
            problems.append(f"chunk with metadata {key} — source must be a handbook file name and section one of its ## headings")
            continue
        if len(text.split()) > 120:
            problems.append(f"a chunk of {key[0]} — {key[1]} has {len(text.split())} words (at most 120)")
        mine = set(words(text))
        share = {k: len(mine & set(words(v))) / max(len(mine), 1) for k, v in sections.items()}
        if share[key] < 0.9 or max(share.values()) > share[key]:
            problems.append(f"a chunk labelled {key[0]} — {key[1]} does not come from that section")
        per_section.setdefault(key, []).append(text)
    for key, text in sections.items():
        got = set().union(*(set(words(t)) for t in per_section.get(key, [""])))
        if len(set(words(text)) - got) > 0.1 * len(set(words(text))):
            problems.append(f"the text of {key[0]} — {key[1]} is missing from the chunks")
    long_key = ("attendance.md", "Condonation of shortage")
    if not problems and len(per_section.get(long_key, [])) < 2:
        problems.append("the long section attendance.md — Condonation of shortage (over 120 words) must be split into several chunks")
    if chunks and not problems:
        ok(f"load_chunks(): {len(chunks)} chunks, each at most 120 words, labelled with its file and section, covering all {len(sections)} sections")
    else:
        bad("chunking: " + ("; ".join(list(dict.fromkeys(problems))[:3]) if problems else "load_chunks() returned no chunks"))
except Exception as e:
    bad(f"load_chunks() failed: {why(e)}")

def ask(question, reply):
    m = model(reply)
    result = assistant.answer(question, m)
    if not isinstance(result, dict) or not {"answer", "sources", "refused"} <= set(result):
        raise TypeError('answer() must return a dict with "answer", "sources" and "refused"')
    return result, m.received

def source_keys(result):
    return [(s.get("source"), s.get("section")) for s in result["sources"]]

# --- Positive control: a grounded, cited reply is shown with its sources -----------------------------------
GROUNDED = "Students need at least 75 percent attendance in each course [1]. Lectures and laboratory classes are counted separately [1]."
QUESTION = "What attendance do I need to sit the end-semester exam?"
control = False
try:
    result, prompts = ask(QUESTION, GROUNDED)
    if result["refused"] or GROUNDED not in str(result["answer"]):
        bad(f"a grounded reply that cites a given source must be shown (refused={result['refused']!r}, answer={str(result['answer'])[:80]!r})")
    elif len(prompts) != 1:
        bad(f"answer() must call the model exactly once per question (it called it {len(prompts)} times)")
    elif ("attendance.md", "Minimum attendance") not in source_keys(result):
        bad(f"the answer must come with its sources, including attendance.md — Minimum attendance (got {source_keys(result)})")
    else:
        control = True
        ok("a grounded reply with citations is shown, with its sources (model called once)")
except Exception as e:
    bad(f"answer() failed on a handbook question: {why(e)}")

# --- Retrieval finds the right section for known questions -------------------------------------------------
KNOWN = [
    ("How do I get my absence excused when I was sick?", ("attendance.md", "Medical leave")),
    ("Can my attendance shortage be condoned, and what does condonation cost?", ("attendance.md", "Condonation of shortage")),
    ("What happens if I lose a library book?", ("library.md", "Late returns and lost books")),
    ("How much does re-evaluation of my answer script cost?", ("examinations.md", "Re-evaluation")),
    ("When do the hostel gates close?", ("hostel.md", "Curfew")),
    ("Do I get a refund if I withdraw?", ("fees.md", "Withdrawal and refunds")),
]
try:
    wrong, unsent = [], []
    for question, expected in KNOWN:
        result, prompts = ask(question, "This is covered in the handbook [1].")
        keys = source_keys(result)
        if result["refused"] or expected not in keys or len(keys) > 5:
            wrong.append(f"{question!r} → {keys or 'refused'}")
            continue
        # Every source returned to the student must really have been in the prompt.
        for key in set(keys):
            text = " ".join(sections[key].split()) if key in sections else ""
            spans = [" ".join(text.split()[i:i + 8]) for i in range(0, max(len(text.split()) - 7, 1), 4)]
            if not prompts or not any(s and s in " ".join(prompts[0].split()) for s in spans):
                unsent.append(f"{key[0]} — {key[1]}")
    if wrong:
        bad(f"retrieval must return the right section (and at most 5 sources) for known questions: {'; '.join(wrong[:3])}")
    else:
        ok(f"retrieval returns the right handbook section for {len(KNOWN)} known questions")
    if not wrong and unsent:
        bad(f"every returned source must have been given to the model in the prompt; not in the prompt: {', '.join(sorted(set(unsent)))}")
    elif not wrong:
        ok("every source returned with an answer was in the prompt the model received")
    else:
        bad("sources in the prompt cannot be checked until retrieval returns the right sections")
except Exception as e:
    bad(f"answer() failed on known handbook questions: {why(e)}")
    bad("sources in the prompt cannot be checked until answer() works")

# --- Negative cases: only meaningful once a good answer is accepted ----------------------------------------
BAD_REPLIES = [
    ("an invented citation", "Students need at least 75 percent attendance [9]."),
    ("a sentence without a citation", "Students need at least 75 percent attendance [1]. Attendance below that is always condoned free of charge."),
]
for label, reply in BAD_REPLIES:
    if not control:
        bad(f"a reply with {label} must be rejected — cannot be judged until a grounded reply is accepted")
        continue
    try:
        result, _ = ask(QUESTION, reply)
        if result["refused"] is True and reply not in str(result["answer"]) and "condoned free" not in str(result["answer"]):
            ok(f"a reply with {label} is rejected, not shown")
        else:
            bad(f"a reply with {label} must be rejected (refused=True) and not shown: got {str(result['answer'])[:90]!r}")
    except Exception as e:
        bad(f"answer() failed on a reply with {label}: {why(e)}")

OFF_TOPIC = ["Who won the cricket world cup?", "What is the capital of France?", "How do I reset my email password?"]
if not control:
    bad("out-of-scope questions must be refused without calling the model — cannot be judged until a grounded reply is accepted")
else:
    try:
        answered = []
        for question in OFF_TOPIC:
            result, prompts = ask(question, "It is in the handbook [1].")
            if result["refused"] is not True or result["sources"] or prompts:
                answered.append(f"{question!r} (refused={result['refused']!r}, model calls={len(prompts)})")
        if answered:
            bad(f"out-of-scope questions must be refused, with no sources and no model call: {'; '.join(answered)}")
        else:
            ok(f"{len(OFF_TOPIC)} out-of-scope questions are refused without calling the model")
    except Exception as e:
        bad(f"answer() failed on an out-of-scope question: {why(e)}")
PY
)"
status=$?
echo "$results"
if [ "$status" -ne 0 ] && ! echo "$results" | grep '^FAIL' > /dev/null; then fail "the tests did not finish (exit code $status)"; fi
failures=$((failures + $(echo "$results" | grep -c '^FAIL')))
finish
