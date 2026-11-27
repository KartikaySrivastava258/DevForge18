#!/usr/bin/env bash
# Acceptance check for "Event-driven notification service".
# Usage: bash check.sh path/to/your/project   (the folder with notifier.py)
# Needs Docker (and network access once, for pip). Starts a single-node Kafka 4.4.0 and a Python 3.12 container
# with confluent-kafka 2.16.1 and a stub notification gateway (some recipients fail on purpose), publishes
# good, duplicate and broken events, runs notifier.py twice and inspects the gateway log and the topics.
set -uo pipefail
src="$(cd "${1:-.}" 2> /dev/null && pwd)" || { echo "FAIL: folder ${1:-.} not found"; exit 1; }
kafka="apache/kafka:4.4.0@sha256:833b867a9585a141da455dc2b57431c65cbccb27f11c91f694444cca9f777e0f"
python="python:3.12-slim@sha256:191083cdf6c7bda8c76158983163ead5d5cf7b77cf3033e805bb0f5296f51b4b"
id="devforge-check-kafka-$$"
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
}
for f in notifier.py; do [ -f "$src/$f" ] || fail "$f is missing"; done
[ "$failures" -eq 0 ] || finish
work="$(mktemp -d)"
cleanup() { docker rm -f -v "$id-kafka" "$id-py" > /dev/null 2>&1; docker network rm "$id" > /dev/null 2>&1; rm -rf "$work"; }
trap cleanup EXIT
cp -a "$src/." "$work/" && chmod -R a+rwX "$work"

docker network create "$id" > /dev/null
docker run -d --name "$id-kafka" --hostname kafka --network "$id" --network-alias kafka \
  -e KAFKA_NODE_ID=1 -e KAFKA_PROCESS_ROLES=broker,controller \
  -e KAFKA_LISTENERS=PLAINTEXT://:9092,CONTROLLER://:9093 -e KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://kafka:9092 \
  -e KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER -e KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT \
  -e KAFKA_CONTROLLER_QUORUM_VOTERS=1@kafka:9093 -e KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1 \
  -e KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1 -e KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1 \
  -e KAFKA_SHARE_COORDINATOR_STATE_TOPIC_REPLICATION_FACTOR=1 -e KAFKA_SHARE_COORDINATOR_STATE_TOPIC_MIN_ISR=1 \
  -e KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS=0 "$kafka" > /dev/null
docker run -d --name "$id-py" --network "$id" -v "$work:/app" -w /app -e BOOTSTRAP=kafka:9092 "$python" sleep 900 > /dev/null
docker exec "$id-py" pip install -q --root-user-action=ignore --disable-pip-version-check confluent-kafka==2.16.1 > /dev/null 2>&1 || { fail "pip install confluent-kafka failed"; finish; }
topics() { docker exec "$id-kafka" /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 "$@"; }
for _ in $(seq 1 60); do topics --list > /dev/null 2>&1 && break; sleep 1; done
topics --create --topic assignment-events --partitions 3 --replication-factor 1 > /dev/null 2>&1 || { fail "Kafka did not start"; finish; }
topics --create --topic assignment-events.dlq --partitions 1 --replication-factor 1 > /dev/null
topics --create --topic assignment-events.sent --partitions 1 --replication-factor 1 --config cleanup.policy=compact > /dev/null

# The stub gateway: records every attempt; flaky@ fails twice then succeeds; broken@ always fails.
docker exec -i "$id-py" sh -c 'cat > /tmp/gateway.py' <<'PY'
import json, time
from http.server import BaseHTTPRequestHandler, HTTPServer
attempts = {}
class H(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        to = body.get("to", "")
        attempts[to] = attempts.get(to, 0) + 1
        code = 500 if to.startswith("broken@") else 503 if to.startswith("flaky@") and attempts[to] <= 2 else 200
        with open("/tmp/gateway.jsonl", "a") as f:
            f.write(json.dumps({"t": time.time(), "code": code, **body}) + "\n")
        self.send_response(code); self.end_headers()
    def log_message(self, *a): pass
HTTPServer(("0.0.0.0", 8099), H).serve_forever()
PY
docker exec -d "$id-py" python /tmp/gateway.py
for _ in $(seq 1 20); do docker exec "$id-py" python -c 'import socket; socket.create_connection(("localhost", 8099), 1)' 2> /dev/null && break; sleep 0.5; done
docker exec -i "$id-py" sh -c 'cat > /tmp/publish.py' <<'PY'
import sys
from confluent_kafka import Producer
p = Producer({"bootstrap.servers": "kafka:9092", "acks": "all"})
for line in sys.stdin.read().splitlines():
    key, _, value = line.partition(" ")
    p.produce("assignment-events", key=key.encode(), value=value.encode())
p.flush(30)
PY
publish() { docker exec -i "$id-py" python /tmp/publish.py; }
ev() { printf '%s {"event_id": "%s", "student_email": "%s", "title": "%s", "due": "2026-02-10"}\n' "$1" "$1" "$2" "$3"; }
{
  for n in 1 2 3 4 5 6; do ev "evt-000$n" "student$n@college.example" "Lab $n"; done
  ev evt-0003 student3@college.example "Lab 3"
  ev evt-0007 flaky@college.example "Lab 7"
  ev evt-0008 broken@college.example "Lab 8"
  echo 'evt-bad {not json'
  echo 'evt-0009 {"event_id": "evt-0009", "title": "No student"}'
} | publish

run() { docker exec -e NOTIFY_URL=http://localhost:8099 "$id-py" timeout 120 python notifier.py 2>&1 | tail -n 1; }
first="$(run)"
report="$(docker exec "$id-py" sh -c 'cat /tmp/gateway.jsonl 2>/dev/null')"
dlq="$(docker exec -i "$id-py" python - <<'PY'
import json
from confluent_kafka import Consumer, TopicPartition, OFFSET_BEGINNING
c = Consumer({"bootstrap.servers": "kafka:9092", "group.id": "devforge-check-dlq", "enable.auto.commit": False})
c.assign([TopicPartition("assignment-events.dlq", 0, OFFSET_BEGINNING)])
rows, idle = [], 0
while idle < 2:
    m = c.poll(2.0)
    if m is None: idle += 1; continue
    if m.error(): continue
    rows.append({"value": m.value().decode(errors="replace"), "headers": {k: (v or b"").decode() for k, v in (m.headers() or [])}})
print(json.dumps(rows))
PY
)"
python3 - "$first" "$report" "$dlq" <<'PY' || failures=$((failures + $?))
import json, sys
first, report, dlq = sys.argv[1], sys.argv[2], json.loads(sys.argv[3] or "[]")
fails = 0
def ok(m): print(f"PASS: {m}")
def bad(m):
    global fails
    fails += 1
    print(f"FAIL: {m}")
calls = [json.loads(l) for l in report.splitlines() if l.strip()]
good = {}
for c in calls:
    if c["code"] == 200: good[c["event_id"]] = good.get(c["event_id"], 0) + 1
expected = {f"evt-000{n}" for n in range(1, 8)}
if set(good) == expected and all(v == 1 for v in good.values()): ok("every valid event was emailed exactly once (7 emails, the duplicate evt-0003 skipped)")
else: bad(f"expected exactly one successful email for each of {sorted(expected)}; got {good}")
flaky = [c for c in calls if c.get("to", "").startswith("flaky@")]
if [c["code"] for c in flaky] == [503, 503, 200]:
    gaps = [b["t"] - a["t"] for a, b in zip(flaky, flaky[1:])]
    if all(g >= 0.15 for g in gaps) and gaps[1] > gaps[0]: ok(f"a failing send is retried with a growing wait ({', '.join(f'{g:.2f} s' for g in gaps)}) and succeeds on attempt 3")
    else: bad(f"retries should wait a little longer each time (waits: {', '.join(f'{g:.2f} s' for g in gaps)})")
else: bad(f"the flaky recipient should be tried 3 times — 503, 503, then 200 (got: {[c['code'] for c in flaky]})")
broken = [c for c in calls if c.get("to", "").startswith("broken@")]
if len(broken) == 3: ok("a recipient that keeps failing is tried exactly 3 times")
else: bad(f"a recipient that keeps failing should be tried exactly 3 times (tried {len(broken)})")
reasons = [r["headers"].get("error", "") for r in dlq]
values = " ".join(r["value"] for r in dlq)
if len(dlq) == 3 and all(reasons) and "{not json" in values and "evt-0009" in values and "evt-0008" in values: ok("the invalid, incomplete and undeliverable events are in assignment-events.dlq with an error header")
else: bad(f"assignment-events.dlq should hold the 3 bad events (not JSON, missing student_email, undeliverable) with their original value and an 'error' header (found {len(dlq)}: {[r[:40] for r in reasons]})")
try: summary = json.loads(first)
except ValueError: summary = None
if summary == {"sent": 7, "dead_lettered": 3, "duplicates": 1}: ok('notifier.py reports {"sent": 7, "dead_lettered": 3, "duplicates": 1}')
else: bad(f'notifier.py should print {{"sent": 7, "dead_lettered": 3, "duplicates": 1}} (got: {first[:160]})')
sys.exit(fails)
PY

{ ev evt-0002 student2@college.example "Lab 2"; ev evt-0010 student10@college.example "Lab 10"; } | publish
second="$(run)"
report="$(docker exec "$id-py" sh -c 'cat /tmp/gateway.jsonl 2>/dev/null')"
again="$(echo "$report" | grep -c '"code": 200, "event_id": "evt-0002"')"
if [ "$second" = '{"sent": 1, "dead_lettered": 0, "duplicates": 1}' ] && [ "$again" = "1" ]; then
  pass "after a restart, only the new event is sent and a late duplicate (evt-0002) is still recognised"
else
  fail "a second run should print {\"sent\": 1, \"dead_lettered\": 0, \"duplicates\": 1} without emailing evt-0002 again (got: $(echo "$second" | head -c 120); evt-0002 emailed $again time(s))"
fi
finish
