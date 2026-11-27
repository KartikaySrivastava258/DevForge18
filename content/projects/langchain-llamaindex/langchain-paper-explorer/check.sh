#!/usr/bin/env bash
# Acceptance check for "Research-paper explorer".
# Usage: bash check.sh path/to/your/project   (the folder with explorer.py, eval_set.json, papers.json, stand_ins.py)
# Needs Docker. Starts one throwaway Python container (the image the track's lessons use), installs the pinned
# packages from requirements.txt once, then cuts the container off the network and runs the tests below inside it.
# Besides your own evaluation set it uses twelve questions of its own, so a hit rate cannot be reached by tuning
# for your questions only. Prints PASS or FAIL per criterion and exits non-zero if any fails. Removes the container.
set -uo pipefail
dir="${1:-.}"
image="python:3.12-slim@sha256:191083cdf6c7bda8c76158983163ead5d5cf7b77cf3033e805bb0f5296f51b4b"
name="devforge-check-llm-papers-$$"
# The only packages the check installs: the exact versions the track's lessons run.
allowed="langchain-core==1.8.4 numpy==2.5.5 llama-index-core==0.14.26"
failures=0
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
  exit 0
}

for f in explorer.py stand_ins.py papers.json eval_set.json; do
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

results="$(timeout 240 docker exec -i -w /work "$name" python -B - 2>&1 <<'PY'
import json, sys
sys.path.insert(0, "/work")

def ok(msg): print(f"PASS: {msg}")
def bad(msg): print(f"FAIL: {msg}")
def why(e): return f"{e.__class__.__name__}: {str(e).splitlines()[0] if str(e) else ''}"

try:
    import explorer
    missing = [f for f in ("load_papers", "search", "evaluate") if not callable(getattr(explorer, f, None))]
    if missing:
        raise AttributeError("explorer.py must define " + ", ".join(missing))
except Exception as e:
    bad(f"explorer.py cannot be imported with load_papers(), search() and evaluate(): {why(e)}")
    sys.exit(0)

PAPERS = {p["id"]: p for p in json.load(open("/work/papers.json", encoding="utf-8"))["papers"]}

# --- Documents carry the metadata the filters need -----------------------------------------------------------
try:
    docs = list(explorer.load_papers())
    wrong = []
    for d in docs:
        m = getattr(d, "metadata", {}) or {}
        p = PAPERS.get(m.get("paper_id"))
        if not p or m.get("title") != p["title"] or m.get("year") != p["year"] or not isinstance(m.get("year"), int) \
                or list(m.get("authors") or []) != p["authors"]:
            wrong.append(str(m.get("paper_id")))
    if len(docs) == len(PAPERS) and not wrong and len({d.metadata["paper_id"] for d in docs}) == len(PAPERS):
        ok(f"load_papers(): {len(docs)} documents with paper_id, title, year (a number) and authors (a list) as metadata")
    else:
        bad(f"load_papers() must return one document per paper ({len(PAPERS)}) with paper_id, title, year as int and the authors list as metadata (wrong: {', '.join(wrong[:4]) or '-'}; documents: {len(docs)})")
except Exception as e:
    bad(f"load_papers() failed: {why(e)}")

def ids(results): return [r["paper_id"] for r in results]

# --- Positive control: an unfiltered search -------------------------------------------------------------------
control = False
try:
    res = explorer.search("Which paper detects crop diseases from images?", k=3)
    keys_ok = isinstance(res, list) and all(isinstance(r, dict) and {"paper_id", "title", "year", "authors", "score"} <= set(r) for r in res)
    if not keys_ok or not res:
        bad(f"search() must return a list of dicts with paper_id, title, year, authors and score (got {str(res)[:100]})")
    elif ids(res)[0] != "p01" or len(res) > 3 or [r["score"] for r in res] != sorted((r["score"] for r in res), reverse=True):
        bad(f"search('Which paper detects crop diseases from images?', k=3) must return at most 3 papers, best first, starting with p01 (got {ids(res)})")
    else:
        control = True
        ok(f"search() without filters returns the best papers first: {ids(res)}")
except Exception as e:
    bad(f"search() failed on a plain question: {why(e)}")

def guarded(label, test):
    """Run a negative or filter test only after the positive control passed; otherwise it proves nothing."""
    if not control:
        bad(f"{label} — cannot be judged until a plain search works")
        return
    try:
        problem = test()
        (bad(f"{label}: {problem}") if problem else ok(label))
    except Exception as e:
        bad(f"{label}: {why(e)}")

def year_filters():
    # Unfiltered, the two best matches are from 2019 and 2020. A filter applied after taking the top 2 finds nothing.
    newest = explorer.search("detecting objects in camera images", k=2, year_from=2024)
    if sorted(ids(newest)) != ["p11", "p14"]:
        return f"with year_from=2024 and k=2, expected p11 and p14 (similarity about 0.57 each) — apply the filter before ranking, not to the top k afterwards (got {ids(newest)})"
    older = explorer.search("answering questions from retrieved passages with citations", k=3, year_to=2023)
    if not older or any(r["year"] > 2023 for r in older) or ids(older)[0] != "p06":
        return f"with year_to=2023, expected p06 first and nothing after 2023 (got {[(r['paper_id'], r['year']) for r in older]})"
    window = explorer.search("forecasting", k=3, year_from=2021, year_to=2021)
    if ids(window) != ["p04"]:
        return f"with year_from=2021 and year_to=2021 (both inclusive), expected only p04 (got {ids(window)})"
guarded("year filters (year_from, year_to, inclusive) are applied before ranking", year_filters)

def author_filter():
    res = explorer.search("crop images", k=3, author="s. bhatt")
    if ids(res) != ["p08"]:
        return f"author='s. bhatt' (any capitalisation) must return only S. Bhatt's crop paper p08 (got {ids(res)})"
    res = explorer.search("images", k=3, author="R. MENON")
    if not res or any("R. Menon" not in r["authors"] for r in res):
        return f"author='R. MENON' must return only R. Menon's papers (got {[(r['paper_id'], r['authors']) for r in res]})"
    if explorer.search("images", k=3, author="Nobody Known") != []:
        return "an author with no papers must give an empty list"
guarded("the author filter matches one of a paper's authors, ignoring case", author_filter)

def invalid_filters():
    for kwargs in ({"year_from": 2025, "year_to": 2020}, {"k": 0}):
        try:
            explorer.search("images", **kwargs)
        except ValueError:
            continue
        return f"search('images', {', '.join(f'{k}={v}' for k, v in kwargs.items())}) must raise ValueError"
guarded("impossible filters (year_from after year_to, k below 1) raise ValueError", invalid_filters)

def off_topic():
    for q in ("How do I cook biryani?", "What is the weather today?"):
        res = explorer.search(q, k=3)
        if res:
            return f"{q!r} matches no paper, so the result must be [] (got {ids(res)} — set a minimum score)"
guarded("questions about no paper return no results (minimum score)", off_topic)

# --- evaluate() reports the true hit rate -------------------------------------------------------------------
def true_hits(cases):
    hits = 0
    for c in cases:
        filters = {f: c[f] for f in ("year_from", "year_to", "author") if f in c}
        hits += c["expected"] in ids(explorer.search(c["question"], k=3, **filters))
    return hits

def evaluate_counts():
    cases = [
        {"question": "Which paper detects crop diseases from images?", "expected": "p01"},
        {"question": "Predicting traffic speed at road junctions", "expected": "p05"},
        {"question": "Which paper detects crop diseases from images?", "expected": "p13"},
        {"question": "Answering questions from retrieved passages with citations", "expected": "p12", "year_to": 2023},
    ]
    report = explorer.evaluate(cases)
    expected = true_hits(cases)
    if report.get("hits") != expected or report.get("total") != 4 or abs(float(report.get("hit_rate", -1)) - expected / 4) > 1e-9:
        return f"for 4 cases of which search() finds {expected}, expected hits={expected}, total=4, hit_rate={expected / 4} (got {report})"
    if len(report.get("misses", [])) != 4 - expected:
        return f"misses must list the {4 - expected} missed cases (got {report.get('misses')})"
guarded("evaluate() counts hits at k=3, applies each case's filters, and lists the misses", evaluate_counts)

def learner_set():
    cases = json.load(open("/work/eval_set.json", encoding="utf-8"))
    if not isinstance(cases, list) or len(cases) < 8:
        return f"eval_set.json needs at least 8 cases (has {len(cases) if isinstance(cases, list) else 'no list'})"
    unknown = [c.get("expected") for c in cases if c.get("expected") not in PAPERS]
    if unknown:
        return f"unknown expected paper ids: {unknown}"
    if len({c["expected"] for c in cases}) < 6:
        return f"cover at least 6 different papers (covers {len({c['expected'] for c in cases})})"
    if sum(1 for c in cases if any(f in c for f in ("year_from", "year_to", "author"))) < 2:
        return "at least 2 cases must use a filter (year_from, year_to or author)"
    report = explorer.evaluate(cases)
    hits = true_hits(cases)
    if report.get("hits") != hits:
        return f"evaluate() reports {report.get('hits')} hits on your set, but search() finds {hits}"
    if hits / len(cases) < 0.8:
        return f"hit rate {hits}/{len(cases)} = {hits / len(cases):.2f} is below 0.80"
    print(f"      your evaluation set: {hits}/{len(cases)} hits at k=3")
guarded("eval_set.json: at least 8 cases over 6 papers, 2 with filters, and a measured hit rate of at least 0.80", learner_set)

HIDDEN = [
    {"question": "Which paper tells farmers the disease from a photograph of a leaf?", "expected": "p01"},
    {"question": "Helping radiologists see urgent X-ray images first", "expected": "p02"},
    {"question": "Recognising speech in languages with little recorded audio", "expected": "p03"},
    {"question": "How much power will the solar panels on campus produce tomorrow?", "expected": "p04"},
    {"question": "Predicting traffic speed at road junctions", "expected": "p05"},
    {"question": "How often do retrieval-augmented systems produce hallucinations?", "expected": "p06"},
    {"question": "Can hospitals train a model together without sharing patient records?", "expected": "p07"},
    {"question": "Which students are likely to drop out of a course?", "expected": "p09"},
    {"question": "Stopping e-mails that try to steal passwords", "expected": "p10"},
    {"question": "When should an electric scooter battery be replaced?", "expected": "p13"},
    {"question": "Detecting weeds in camera images", "expected": "p14", "year_from": 2024},
    {"question": "Answering questions from retrieved passages with citations", "expected": "p06", "year_to": 2023},
]
def hidden_set():
    hits = true_hits(HIDDEN)
    if hits / len(HIDDEN) < 0.8:
        return f"hit rate at k=3 on the check's own questions is {hits}/{len(HIDDEN)} = {hits / len(HIDDEN):.2f}, below 0.80"
    print(f"      the check's questions: {hits}/{len(HIDDEN)} hits at k=3")
guarded("hit rate at k=3 on the check's own 12 questions is at least 0.80", hidden_set)
PY
)"
status=$?
echo "$results"
if [ "$status" -ne 0 ] && ! echo "$results" | grep '^FAIL' > /dev/null; then fail "the tests did not finish (exit code $status)"; fi
failures=$((failures + $(echo "$results" | grep -c '^FAIL')))
finish
