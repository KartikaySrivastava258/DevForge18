#!/usr/bin/env bash
# Acceptance check for "Live campus activity stream".
# Usage: bash check.sh path/to/your/project   (the folder with topics.sh and occupancy.py)
# Needs Docker (and network access once, for pip). Starts a single-node Kafka 4.4.0 and a Python 3.12 container
# with confluent-kafka 2.16.1 on a private network, runs your topics.sh, produces 360 badge swipes, runs two
# copies of occupancy.py side by side and then one more, and reads the occupancy topic. PASS or FAIL per criterion.
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
for f in topics.sh occupancy.py; do [ -f "$src/$f" ] || fail "$f is missing"; done
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
docker cp "$work/topics.sh" "$id-kafka:/tmp/topics.sh" > /dev/null
if out="$(docker exec -e BOOTSTRAP=localhost:9092 -e PATH="/opt/kafka/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" "$id-kafka" bash /tmp/topics.sh 2>&1)"; then pass "topics.sh runs"; else fail "topics.sh failed: $(echo "$out" | tail -n 2 | tr '\n' ' ')"; fi
parts="$(topics --describe --topic campus-activity 2>/dev/null | grep -o 'PartitionCount: *[0-9]*' | grep -o '[0-9]*$')"
if [ "$parts" = "6" ]; then pass "campus-activity has 6 partitions"; else fail "campus-activity needs 6 partitions (has ${parts:-none})"; fi
policy="$(docker exec "$id-kafka" /opt/kafka/bin/kafka-configs.sh --bootstrap-server localhost:9092 --describe --entity-type topics --entity-name building-occupancy 2>/dev/null | grep -o 'cleanup.policy=[a-z,]*' | head -n 1)"
if [ "$policy" = "cleanup.policy=compact" ]; then pass "building-occupancy is a compacted topic"; else fail "building-occupancy needs cleanup.policy=compact (found: ${policy:-none})"; fi
[ "$parts" = "6" ] || topics --create --if-not-exists --topic campus-activity --partitions 6 --replication-factor 1 > /dev/null 2>&1
topics --create --if-not-exists --topic building-occupancy --partitions 1 --replication-factor 1 > /dev/null 2>&1

# produce <first> <count>: deterministic swipes for six buildings, keyed by building.
produce() { docker exec -i "$id-py" python - "$1" "$2" <<'PY'
import json, sys
from confluent_kafka import Producer
first, count = int(sys.argv[1]), int(sys.argv[2])
B = ["library", "lab-block", "canteen", "hostel-a", "hostel-b", "sports"]
p = Producer({"bootstrap.servers": "kafka:9092", "acks": "all"})
for i in range(first, first + count):
    b = B[i % 6]
    swipe = {"building": b, "student": f"s{i % 97:04d}", "direction": "out" if (i // 6) % 4 == 3 else "in", "at": f"2026-02-03T08:{i // 60 % 60:02d}:{i % 60:02d}Z"}
    p.produce("campus-activity", key=b.encode(), value=json.dumps(swipe).encode())
p.flush(30)
PY
}
expected() { python3 - "$1" <<'PY'
import json, sys
B = ["library", "lab-block", "canteen", "hostel-a", "hostel-b", "sports"]
occ = {b: 0 for b in B}
for i in range(int(sys.argv[1])):
    occ[B[i % 6]] += -1 if (i // 6) % 4 == 3 else 1
print(json.dumps(occ, sort_keys=True))
PY
}
latest() { docker exec -i "$id-py" python - <<'PY'
import json
from confluent_kafka import Consumer, TopicPartition, OFFSET_BEGINNING
c = Consumer({"bootstrap.servers": "kafka:9092", "group.id": "devforge-check-latest", "enable.auto.commit": False})
c.assign([TopicPartition("building-occupancy", 0, OFFSET_BEGINNING)])
state, idle, unkeyed = {}, 0, 0
while idle < 2:
    m = c.poll(2.0)
    if m is None: idle += 1; continue
    if m.error(): continue
    if not m.key(): unkeyed += 1; continue
    state[m.key().decode()] = json.loads(m.value()).get("inside")
c.close()
print(json.dumps({"state": state, "unkeyed": unkeyed}, sort_keys=True))
PY
}
produce 0 300
docker exec "$id-py" sh -c 'timeout 120 python occupancy.py > /tmp/a.out 2>&1 & timeout 120 python occupancy.py > /tmp/b.out 2>&1 & wait'
a="$(docker exec "$id-py" tail -n 1 /tmp/a.out)"; b="$(docker exec "$id-py" tail -n 1 /tmp/b.out)"
na="$(echo "$a" | python3 -c 'import json,sys; print(json.load(sys.stdin)["processed"])' 2>/dev/null)"; nb="$(echo "$b" | python3 -c 'import json,sys; print(json.load(sys.stdin)["processed"])' 2>/dev/null)"
if [ -n "$na" ] && [ -n "$nb" ] && [ $((na + nb)) -eq 300 ]; then pass "two copies together processed all 300 swipes exactly once ($na + $nb)"; else fail "two copies should process 300 swipes between them, each printing {\"processed\": n} (got: $(echo "$a" | head -c 80) / $(echo "$b" | head -c 80))"; fi
if [ -n "$na" ] && [ -n "$nb" ] && [ "$na" -gt 0 ] && [ "$nb" -gt 0 ]; then pass "both copies did part of the work (the group shared the partitions)"; else fail "both copies should get partitions and process swipes (processed: ${na:-?} and ${nb:-?})"; fi
check_state() { # <label> <swipes so far>
  local got want
  got="$(latest)"; want="$(expected "$2")"
  python3 - "$got" "$want" "$1" <<'PY'
import json, sys
got, want, label = json.loads(sys.argv[1]), json.loads(sys.argv[2]), sys.argv[3]
if got["unkeyed"]:
    print(f"FAIL: {label}: {got['unkeyed']} occupancy messages have no key — key them by building so compaction keeps each building's latest value"); sys.exit(1)
if got["state"] == want:
    print(f"PASS: {label}: building-occupancy holds every building's correct occupancy"); sys.exit(0)
print(f"FAIL: {label}: building-occupancy should end with {want}, got {got['state']}"); sys.exit(1)
PY
}
check_state "after 300 swipes" 300 || failures=$((failures + 1))
produce 300 60
c="$(docker exec "$id-py" timeout 120 python occupancy.py 2>&1 | tail -n 1)"
nc="$(echo "$c" | python3 -c 'import json,sys; print(json.load(sys.stdin)["processed"])' 2>/dev/null)"
if [ "$nc" = "60" ]; then pass "a copy started later processes only the 60 new swipes"; else fail "after 60 new swipes, a new run should process exactly 60 (got: $(echo "$c" | head -c 80))"; fi
check_state "after a restart and 60 more swipes" 360 || failures=$((failures + 1))
finish
