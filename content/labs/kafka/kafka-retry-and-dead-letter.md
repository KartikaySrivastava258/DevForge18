---
id: kafka-retry-and-dead-letter
title: Implement retry and dead-letter handling
track: kafka
level: advanced
mode: local
estimated_minutes: 40
prerequisites: [kafka-topics-and-partitions]
objectives:
  - Separate failures that a retry can fix from failures it cannot, and route each kind differently.
  - Retry through a separate topic with an attempt count, so a failing event never blocks the ones behind it.
  - Send events that cannot be processed to a dead-letter topic with the reason, and confirm no event was lost.
checkpoints:
  - { id: routed, text: "The first pass processed 2 events, retried 2 and dead-lettered 2" }
  - { id: exhausted, text: "p6 reached the dead-letter topic after its third attempt" }
  - { id: accounted, text: "All six events are accounted for: three processed, three in the dead-letter topic" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: Apache Kafka documentation — Consumer configs and the console tools
    url: https://kafka.apache.org/documentation/
    publisher: Apache Kafka
    type: documentation
    level: intermediate
    official: true
    why: Consumer groups, committed offsets, and the command-line tools used in this lab.
    verification: { status: verified, checked_on: 2026-11-26 }
verification:
  method: executed
  details: Every step and the check script are run by DevForge's test suite against Apache Kafka 4.4.0 in Docker, and their output is compared with this page. The "payment gateway" is simulated by fields in each event, so the same events fail the same way on every run. The check script is also run in an empty folder, where it must fail.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

A payment consumer meets bad events. Some are **permanently** broken (no amount, a negative amount): retrying will never help. Others hit a **temporary** problem (the payment gateway is down): a later attempt may succeed. You build a processor that retries the second kind through a **retry topic**, sends the first kind — and retries that run out — to a **dead-letter topic** with the reason, and keeps the main topic flowing the whole time.

## Before you start

You need Docker and the broker from *Topics, partitions and keys* (container `devforge-kafka`, with the `kafka` shell function defined). If you stopped it, run that lesson's step 1 again.

The payment gateway is simulated: an event containing `gateway=down` fails on its first attempt only; `gateway=broken` fails every time. Real consumers learn this from the error they get back.

## Steps

### 1. Three topics

```bash run
for t in payments payments.retry payments.dlq; do
  kafka kafka-topics.sh --bootstrap-server localhost:9092 --create --topic "$t" --partitions 1 --replication-factor 1 > /dev/null
done
kafka kafka-topics.sh --bootstrap-server localhost:9092 --list | grep '^payments'
```

```text output
payments
payments.dlq
payments.retry
```

One partition each keeps the order easy to follow; the same design works with many.

### 2. Six payment events

```bash run
printf '%s\n' \
  'id=p1 amount=250' \
  'id=p2 amount=-40' \
  'id=p3 amount=120 gateway=down' \
  'id=p4' \
  'id=p5 amount=75' \
  'id=p6 amount=60 gateway=broken' \
  | kafka kafka-console-producer.sh --bootstrap-server localhost:9092 --topic payments
```

### 3. A processor that sorts failures

```bash run
cat > process.sh <<'EOF'
#!/usr/bin/env bash
# Usage: bash process.sh <topic> <consumer group>
# Reads the topic's new events as the group and handles each one:
#   valid                 -> processed
#   invalid amount        -> payments.dlq at once (retrying cannot fix it)
#   gateway failure       -> payments.retry with attempt+1, up to 3 attempts, then payments.dlq
set -euo pipefail
topic=$1 group=$2
MAX_ATTEMPTS=3
kafka() { docker exec -i devforge-kafka "/opt/kafka/bin/$1" "${@:2}"; }
send() { printf '%s\n' "$2" | kafka kafka-console-producer.sh --bootstrap-server localhost:9092 --topic "$1"; }
field() { printf '%s\n' "$1" | grep -o "$2=[^ ]*" | cut -d= -f2 || true; }

kafka kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic "$topic" --group "$group" --from-beginning --timeout-ms 15000 < /dev/null 2> /dev/null |
while read -r event; do
  attempt=$(field "$event" attempt); attempt=${attempt:-1}
  amount=$(field "$event" amount)
  gateway=$(field "$event" gateway)
  base=$(printf '%s\n' "$event" | sed -E 's/ attempt=[0-9]+//')
  if [ -z "$amount" ] || [ "$amount" -le 0 ]; then
    echo "DLQ    $base (invalid amount)"
    send payments.dlq "$base reason=invalid-amount"
  elif { [ "$gateway" = down ] && [ "$attempt" -lt 2 ]; } || [ "$gateway" = broken ]; then
    if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
      echo "DLQ    $base (gateway failed $attempt times)"
      send payments.dlq "$base reason=retries-exhausted attempts=$attempt"
    else
      echo "RETRY  $base (attempt $attempt failed)"
      send payments.retry "$base attempt=$((attempt + 1))"
    fi
  else
    echo "OK     $base (attempt $attempt)"
  fi
done
EOF
bash process.sh payments main
```

```text output
OK     id=p1 amount=250 (attempt 1)
DLQ    id=p2 amount=-40 (invalid amount)
RETRY  id=p3 amount=120 gateway=down (attempt 1 failed)
DLQ    id=p4 (invalid amount)
OK     id=p5 amount=75 (attempt 1)
RETRY  id=p6 amount=60 gateway=broken (attempt 1 failed)
```

`--from-beginning` only matters the first time a group reads a topic: a new group starts at the earliest event instead of only new ones; after that, the group's committed offsets decide where it continues. The main topic was read to the end in one pass. p3 and p6 did not block p4 and p5: they were handed to `payments.retry` with the next attempt number, and the main consumer moved on. p2 and p4 went straight to the dead-letter topic — no number of retries can give `p4` an amount.

### 4. Work through the retries

A separate consumer group reads the retry topic. In production it would run continuously; here you run it by hand, twice, and predict first: how many lines will each pass print?

```bash run
echo "--- retry pass 1"; bash process.sh payments.retry retry
echo "--- retry pass 2"; bash process.sh payments.retry retry
```

```text output
--- retry pass 1
OK     id=p3 amount=120 gateway=down (attempt 2)
RETRY  id=p6 amount=60 gateway=broken (attempt 2 failed)
DLQ    id=p6 amount=60 gateway=broken (gateway failed 3 times)
--- retry pass 2
```

p3's gateway had recovered, so its second attempt succeeded. p6 failed again and was put back on `payments.retry` with `attempt=3` — and the *same* pass read it, because a consumer keeps reading events that arrive while it runs. Its third attempt failed too, so it went to the dead-letter topic: an endless retry loop would cost resources forever and hide the problem. The second pass found nothing new; the group's committed offset was already at the end.

Here the retries happened within seconds. Real systems usually space them out — for example with several retry topics, each read after a longer delay — so that a gateway that is down for a minute has time to recover.

### 5. Read the dead-letter topic

```bash run
kafka kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic payments.dlq --from-beginning --timeout-ms 8000 2> /dev/null
```

```text output
id=p2 amount=-40 reason=invalid-amount
id=p4 reason=invalid-amount
id=p6 amount=60 gateway=broken reason=retries-exhausted attempts=3
```

Every dead letter says *why* it is there. Someone — or a tool — inspects these, fixes the data or the cause, and can publish corrected events again. Without a dead-letter topic, these events would either block the consumer or vanish silently.

### 6. Nothing is left unread

```bash run
kafka kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --all-groups 2> /dev/null \
  | awk '$2 ~ /^payments/ { print $1, $2, "lag=" $6 }' | sort
```

```text output
main payments lag=0
retry payments.retry lag=0
```

Both groups have committed offsets at the end of their topics: six events in, three processed (p1, p5, p3) and three dead-lettered (p2, p4, p6).

## Check your work

Run this in the folder with `process.sh`, while the broker is running.

```bash run check
bash <<'CHECK'
fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
kafka() { docker exec devforge-kafka "/opt/kafka/bin/$1" "${@:2}"; }  # no -i: these commands read nothing from the script's input
read_topic() { kafka kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic "$1" --from-beginning --timeout-ms 8000 2> /dev/null; }
lag() { kafka kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group "$1" 2> /dev/null | awk -v t="$2" '$2 == t { print $6 }'; }
check "process.sh exists" '[ -f process.sh ]'
dlq=$(read_topic payments.dlq)
check "p2 and p4 were dead-lettered as invalid" 'echo "$dlq" | grep -q "^id=p2 .*reason=invalid-amount" && echo "$dlq" | grep -q "^id=p4 reason=invalid-amount"'
check "p6 was dead-lettered after 3 attempts" 'echo "$dlq" | grep -q "^id=p6 .*reason=retries-exhausted attempts=3"'
check "p1, p3 and p5 are not in the dead-letter topic" '! echo "$dlq" | grep -qE "^id=p(1|3|5) "'
check "p3 was retried once" '[ "$(read_topic payments.retry | grep -c "^id=p3 ")" = 1 ]'
check "the main group has read every payment" '[ "$(lag main payments)" = 0 ]'
check "the retry group has read every retry" '[ "$(lag retry payments.retry)" = 0 ]'
if [ "$fail" -eq 0 ]; then echo "All checks passed"; else echo "Some checks failed"; exit 1; fi
CHECK
```

```text output
PASS: process.sh exists
PASS: p2 and p4 were dead-lettered as invalid
PASS: p6 was dead-lettered after 3 attempts
PASS: p1, p3 and p5 are not in the dead-letter topic
PASS: p3 was retried once
PASS: the main group has read every payment
PASS: the retry group has read every retry
All checks passed
```

## Clean up

This removes the broker and every event in it:

```bash run
docker rm -f devforge-kafka
```

```text output
devforge-kafka
```

## Reset

Remove the broker (as above), start it again with step 1 of *Topics, partitions and keys*, and begin this lab at step 1.

## What you practised

A consumer must keep moving. Permanent failures go to a dead-letter topic at once, with a reason; temporary failures go to a retry topic with an attempt count and a limit; and committed offsets plus a count of where every event ended up prove nothing was lost.
