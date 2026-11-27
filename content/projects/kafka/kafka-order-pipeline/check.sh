#!/usr/bin/env bash
# Acceptance check for "Order event pipeline".
# Usage: bash check.sh path/to/your/project   (the folder with producer.py, consumer.py and orders.jsonl)
# Needs Docker (and network access once, for pip). Starts a single-node Kafka 4.4.0 and a Python 3.12 container
# with confluent-kafka 2.16.1 on a private network, creates the topic "orders" with 3 partitions, runs your
# producer and consumer, and inspects the topic. Prints PASS or FAIL per criterion; exits non-zero if any fails.
set -uo pipefail
# grep -q stops reading at its first match; under pipefail the writer then dies of SIGPIPE and the pipeline
# fails at random (CI run 46038301566). grep_quiet reads all of its input.
grep_quiet() { grep "$@" > /dev/null; }
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
for f in producer.py consumer.py orders.jsonl; do [ -f "$src/$f" ] || fail "$f is missing"; done
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
topics --create --topic orders --partitions 3 --replication-factor 1 > /dev/null 2>&1 || { fail "Kafka did not start"; finish; }

out="$(docker exec "$id-py" timeout 60 python producer.py 2>&1)"; status=$?
expected="$(grep -c . "$work/orders.jsonl")"
if [ "$status" -eq 0 ] && echo "$out" | grep_quiet "^sent $expected$"; then pass "producer.py runs and reports sent $expected"; else fail "producer.py should exit 0 and print \"sent $expected\" (got: $(echo "$out" | tail -n 2 | tr '\n' ' '))"; fi

# Read everything back with a throwaway group, recording partition, offset and key of each event.
docker exec -i "$id-py" python - > "$work/.topic.json" <<'PY'
import json
from confluent_kafka import Consumer
c = Consumer({"bootstrap.servers": "kafka:9092", "group.id": "devforge-check-reader", "auto.offset.reset": "earliest", "enable.auto.commit": False})
c.subscribe(["orders"])
rows, idle = [], 0
while idle < 3:
    m = c.poll(2.0)
    if m is None:
        idle += 1; continue
    if m.error(): continue
    idle = 0
    rows.append({"p": m.partition(), "o": m.offset(), "key": m.key().decode() if m.key() else None, "value": m.value().decode(errors="replace")})
c.close()
print(json.dumps(rows))
PY
python3 - "$work/.topic.json" "$work/orders.jsonl" <<'PY' || failures=$((failures + $?))
import json, sys
fails = 0
def ok(m): print(f"PASS: {m}")
def bad(m):
    global fails
    fails += 1
    print(f"FAIL: {m}")
rows = json.load(open(sys.argv[1]))
source = [json.loads(l) for l in open(sys.argv[2]) if l.strip()]
if len(rows) == len(source): ok(f"all {len(source)} events are in the topic")
else: bad(f"the topic holds {len(rows)} of {len(source)} events — produce() only queues; wait for delivery before the program exits")
values = []
for r in rows:
    try: values.append(json.loads(r["value"]))
    except ValueError: values.append(None)
if rows and all(isinstance(v, dict) and {"order_id", "status"} <= set(v) for v in values): ok("every event is a JSON object with order_id and status")
elif rows: bad("every event value must be the JSON object from orders.jsonl")
keyed = [r for r, v in zip(rows, values) if v and r["key"] == v.get("order_id")]
if rows and len(keyed) == len(rows): ok("every event's key is its order_id")
elif rows: bad(f"{len(rows) - len(keyed)} events do not have their order_id as the key")
by_order = {}
for r, v in zip(rows, values):
    if v: by_order.setdefault(v["order_id"], []).append((r["p"], r["o"], v["status"]))
split = sorted(o for o, evs in by_order.items() if len({p for p, _, _ in evs}) > 1)
expected_seq = {}
for e in source: expected_seq.setdefault(e["order_id"], []).append(e["status"])
misordered = sorted(o for o, evs in by_order.items() if [s for _, _, s in sorted(evs, key=lambda x: (x[0], x[1]))] != expected_seq.get(o))
if rows and not split and not misordered: ok("each order's events share one partition and are stored in the order they happened")
elif rows: bad(f"events of an order must go to one partition, in order (split: {', '.join(split[:4]) or '-'}; out of order: {', '.join(misordered[:4]) or '-'})")
sys.exit(fails)
PY

first="$(docker exec "$id-py" timeout 90 python consumer.py 2>&1 | tail -n 1)"
expected_status="$(python3 -c '
import json, sys
latest = {}
for line in open(sys.argv[1]):
    if line.strip():
        e = json.loads(line); latest[e["order_id"]] = e["status"]
print(json.dumps(latest, sort_keys=True))' "$work/orders.jsonl")"
if python3 -c 'import json,sys; sys.exit(0 if json.loads(sys.argv[1]) == json.loads(sys.argv[2]) else 1)' "$first" "$expected_status" 2> /dev/null; then
  pass "consumer.py prints every order's latest status"
else
  fail "consumer.py should print each order's latest status (expected $(echo "$expected_status" | head -c 90)…, got: $(echo "$first" | head -c 120))"
fi
second="$(docker exec "$id-py" timeout 90 python consumer.py 2>&1 | tail -n 1)"
if [ "$first" = "{}" ] || [ -z "$first" ]; then fail "a second run of consumer.py could not be checked: the first run processed nothing"
elif [ "$second" = "{}" ]; then pass "a second run of consumer.py processes nothing again (offsets were committed)"; else fail "a second run of consumer.py should print {} — commit the offsets of processed events (got: $(echo "$second" | head -c 120))"; fi
lag="$(docker exec "$id-kafka" /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group order-status 2>/dev/null | awk '$2 == "orders" { s += $6 } END { print s + 0 }')"
if [ "$lag" = "0" ] && [ "$first" != "{}" ]; then pass "the consumer group order-status has no lag on orders"; else fail "the consumer group order-status should have read everything (total lag $lag)"; fi
finish
