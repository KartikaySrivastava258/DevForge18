---
id: kafka-replication-and-fault-tolerance
title: Replication and fault tolerance
track: kafka
order: 6
level: intermediate
estimated_minutes: 45
prerequisites: [kafka-producers-acks-and-retries]
starts_fresh: true
learning_objectives:
  - Run a three-node Kafka cluster in KRaft mode and read a partition's leader, replicas and in-sync replicas (ISR).
  - Stop a broker and explain what happens to leadership, the ISR and writes with acks=all.
  - Use min.insync.replicas with acks=all to refuse writes that would not be durable, and compare acks=1.
  - Bring a broker back, watch it catch up, and move leadership back to the preferred replica.
resources:
  - title: Design — replication, ISR and unclean leader election
    url: https://kafka.apache.org/44/design/design/
    publisher: Apache Software Foundation
    type: documentation
    level: advanced
    official: true
    why: A message is committed only when all in-sync replicas have applied it, and is not lost as long as one replica that has it stays alive; why unclean leader election trades durability for availability.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Topic configs — min.insync.replicas and unclean.leader.election.enable
    url: https://kafka.apache.org/44/configuration/topic-configs/
    publisher: Apache Software Foundation
    type: reference
    level: intermediate
    official: true
    why: With acks=all and fewer in-sync replicas than min.insync.replicas, the producer gets NotEnoughReplicas; unclean leader election is off by default.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Broker configs — leader balancing and follower lag
    url: https://kafka.apache.org/44/configuration/broker-configs/
    publisher: Apache Software Foundation
    type: reference
    level: advanced
    official: true
    why: auto.leader.rebalance.enable (default true) checks every leader.imbalance.check.interval.seconds (300); replica.lag.time.max.ms (30 s) removes a lagging follower from the ISR.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Apache Kafka Docker image — cluster examples (4.4.0)
    url: https://github.com/apache/kafka/tree/4.4.0/docker/examples
    publisher: Apache Software Foundation
    type: documentation
    level: intermediate
    official: true
    why: The combined-mode three-node cluster settings (node IDs, controller quorum voters, a shared CLUSTER_ID) this lab follows.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: isr
    prompt: A partition has Replicas 1,2,3 and Isr 1,2. What does that tell you?
    options:
      - { id: a, text: "Broker 3 has been deleted" }
      - { id: b, text: "Broker 3 holds a replica but is not keeping up (stopped, slow or partitioned), so it is out of the in-sync set until it catches up" }
      - { id: c, text: "The partition has lost data" }
    answer: b
    explanation: The replica list is where copies should be; the ISR is which copies are currently up to date. The lab shows the ISR shrink on stop and grow back on restart.
  - id: minisr
    prompt: replication.factor=3, min.insync.replicas=2, acks=all. Two brokers go down. What happens to writes?
    options:
      - { id: a, text: "They succeed on the last broker" }
      - { id: b, text: "They are rejected with NotEnoughReplicas — Kafka refuses to acknowledge a write that only one copy holds" }
      - { id: c, text: "They are queued on the broker" }
    answer: b
    explanation: The lab reproduces this with min.insync.replicas=3 and one broker down. Availability is traded for durability on purpose.
  - id: acks1
    prompt: Why did the acks=1 write succeed on the topic that refused acks=all?
    options:
      - { id: a, text: "acks=1 is faster" }
      - { id: b, text: "min.insync.replicas only applies to acks=all; with acks=1 the leader alone acknowledges, so if it fails before followers copy the record, the record is lost" }
      - { id: c, text: "The topic was misconfigured" }
    answer: b
    explanation: min.insync.replicas is a promise to acks=all producers only.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with three containers of the official apache/kafka 4.4.0 image (pinned by digest), starting from nothing, and its output is compared with this lesson. Partition placement is fixed with --replica-assignment so leaders are the same on every run. Checked against the Apache Kafka 4.4 documentation and the image's cluster example on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

Each partition is copied to several brokers: one **leader** takes reads and writes, **followers** copy it, and the **in-sync replicas (ISR)** are the copies that are up to date — with `acks=all` and **`min.insync.replicas`**, a write is acknowledged only once enough copies have it, so losing a broker loses no acknowledged data.

## Explain it like I'm twelve

Three classmates keep copies of the class notes. One — the leader — writes during the lesson; the other two copy from them at break. The "in-sync" ones are those whose copy is complete right now. If the leader is ill, an in-sync classmate takes over with nothing missing. A rule like "a note only counts once two people have it" means that even if one notebook is lost, every counted note survives.

## What problem it solves

Disks fail, machines reboot for patches, and whole availability zones go dark. Without copies, every outage is data loss and downtime. Replication lets a cluster keep serving through a broker failure, and the ISR rules decide exactly when a write is safe to acknowledge — and when Kafka should refuse a write rather than pretend it is safe.

## How it works

![](media:kafka/replication.svg)

- **Replicas**: `replication.factor` copies of each partition on different brokers. The first replica in the list is the **preferred leader**.
- **ISR**: replicas that are caught up. A follower that stops fetching or falls behind for `replica.lag.time.max.ms` (30 s) is removed; it rejoins once it catches up. A broker shutting down cleanly leaves the ISR at once.
- **Leader election**: if a leader fails, a member of the ISR becomes leader. With `unclean.leader.election.enable=false` (the default), an out-of-sync replica is never chosen, so committed records are not lost — the partition waits instead.
- **`min.insync.replicas`**: with `acks=all`, if fewer replicas than this are in sync, the write is rejected with `NotEnoughReplicas`. A common setting is replication factor 3 with `min.insync.replicas=2`: one broker can fail with no loss and no downtime.
- **KRaft controllers** keep the cluster metadata (who leads what). In this lab each node is both broker and controller; the controller quorum needs a majority of its 3 voters, so this cluster tolerates one node down.

## Try it yourself

> **Local lab** — needs Docker and about 2 GB of free memory: three Kafka nodes, each limited to a 512 MB heap. They run on the `devforge-kafka-net` network as `kafka-1`, `kafka-2` and `kafka-3`; tools run in their own client containers. Every command is run automatically in DevForge's tests.

### 1. Three nodes, one cluster

```bash run
IMAGE=apache/kafka:4.4.0@sha256:833b867a9585a141da455dc2b57431c65cbccb27f11c91f694444cca9f777e0f
docker pull -q "$IMAGE" > /dev/null
docker network create devforge-kafka-net > /dev/null
for n in 1 2 3; do
  cat > kafka-$n.env <<ENV
KAFKA_NODE_ID=$n
KAFKA_PROCESS_ROLES=broker,controller
KAFKA_LISTENERS=PLAINTEXT://:9092,CONTROLLER://:9093
KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://kafka-$n:9092
KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER
KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT
KAFKA_CONTROLLER_QUORUM_VOTERS=1@kafka-1:9093,2@kafka-2:9093,3@kafka-3:9093
KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT
CLUSTER_ID=4L6g3nShT-eMCtK--X86sw
KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS=0
KAFKA_HEAP_OPTS=-Xmx512m -Xms512m
ENV
done
docker run -d --name devforge-kafka-1 --hostname kafka-1 --network devforge-kafka-net --env-file kafka-1.env "$IMAGE" > /dev/null
docker run -d --name devforge-kafka-2 --hostname kafka-2 --network devforge-kafka-net --env-file kafka-2.env "$IMAGE" > /dev/null
docker run -d --name devforge-kafka-3 --hostname kafka-3 --network devforge-kafka-net --env-file kafka-3.env "$IMAGE" > /dev/null
client() { docker run --rm -i --network devforge-kafka-net "$IMAGE" "/opt/kafka/bin/$1" "${@:2}"; }
ALL=kafka-1:9092,kafka-2:9092,kafka-3:9092
for i in $(seq 1 90); do [ "$(client kafka-broker-api-versions.sh --bootstrap-server "$ALL" 2> /dev/null | grep -c '^kafka-[123]:9092')" = 3 ] && break; sleep 1; done
client kafka-metadata-quorum.sh --bootstrap-server "$ALL" describe --status 2> /dev/null | grep '^CurrentVoters' | grep -o 'CONTROLLER://kafka-[0-9]:9093'
```

```text output
CONTROLLER://kafka-1:9093
CONTROLLER://kafka-2:9093
CONTROLLER://kafka-3:9093
```

- Every node gets the same `CLUSTER_ID` and the same list of three **controller voters**; `KAFKA_NODE_ID` and the advertised name differ.
- `kafka-metadata-quorum.sh describe --status` describes the controller quorum; its `CurrentVoters` line lists the three voters, one per node, on the controller port 9093.

### 2. A replicated topic

`--replica-assignment` places the partitions by hand — `1:2:3,2:3:1,3:1:2` means partition 0 on brokers 1, 2, 3 (leader 1), partition 1 on 2, 3, 1 (leader 2), partition 2 on 3, 1, 2 (leader 3). Normally Kafka spreads them itself, starting from a random broker; fixing them here makes every run look the same.

```bash run
client kafka-topics.sh --bootstrap-server "$ALL" --create --topic orders --replica-assignment 1:2:3,2:3:1,3:1:2 \
  --config min.insync.replicas=2
# one line per partition: leader, replicas, and the in-sync replicas (sorted)
show() {
  client kafka-topics.sh --bootstrap-server "$1" --describe --topic "$2" 2> /dev/null | awk '$3 == "Partition:" {print $4, $6, $8, $10}' |
  while read -r p leader replicas isr; do
    echo "partition $p: leader $leader, replicas $replicas, in sync $(echo "$isr" | tr , '\n' | sort -n | paste -sd, -)"
  done
}
show "$ALL" orders
client kafka-verifiable-producer.sh --bootstrap-server "$ALL" --topic orders --max-messages 6 --acks -1 2> /dev/null | grep -o '"sent":[0-9]*,"acked":[0-9]*'
```

```text output
Created topic orders.
partition 0: leader 1, replicas 1,2,3, in sync 1,2,3
partition 1: leader 2, replicas 2,3,1, in sync 1,2,3
partition 2: leader 3, replicas 3,1,2, in sync 1,2,3
"sent":6,"acked":6
```

Every partition has three copies and all three are in sync; each broker leads one partition, so the work is spread.

### 3. Lose a broker

```bash run
docker stop devforge-kafka-3 > /dev/null
UP=kafka-1:9092,kafka-2:9092
for i in $(seq 1 60); do [ "$(show "$UP" orders | grep -c 'in sync [12],[12]$')" = 3 ] && break; sleep 1; done
show "$UP" orders
client kafka-topics.sh --bootstrap-server "$UP" --describe --under-replicated-partitions 2> /dev/null | awk '{print $2, $4}'
client kafka-verifiable-producer.sh --bootstrap-server "$UP" --topic orders --max-messages 6 --acks -1 2> /dev/null | grep -o '"sent":[0-9]*,"acked":[0-9]*'
```

```text output
partition 0: leader 1, replicas 1,2,3, in sync 1,2
partition 1: leader 2, replicas 2,3,1, in sync 1,2
partition 2: leader 1, replicas 3,1,2, in sync 1,2
orders 0
orders 1
orders 2
"sent":6,"acked":6
```

- Broker 3 left every ISR as soon as it shut down. Partition 2 lost its leader; broker 1, the next in-sync replica in its list, took over.
- All three partitions are now **under-replicated** — the standard alert for "a copy is missing".
- Writes with `acks=all` still succeed: two in-sync replicas meet `min.insync.replicas=2`. No acknowledged record has only one copy.

### 4. When Kafka refuses a write

Create a topic that demands **three** in-sync replicas, while only two brokers are up:

```bash run
client kafka-topics.sh --bootstrap-server "$UP" --create --topic payments --replica-assignment 1:2:3 --config min.insync.replicas=3
send() { client kafka-verifiable-producer.sh --bootstrap-server "$UP" --topic payments --max-messages 1 --acks "$1" 2> /dev/null; }
echo "acks=all: $(send -1 | grep -o 'NotEnoughReplicasException","message":"[^"]*' | sed 's/","message":"/ — /')"
echo "acks=1:   $(send 1 | grep -o '"sent":[0-9]*,"acked":[0-9]*')"
```

```text output
Created topic payments.
acks=all: NotEnoughReplicasException — Messages are rejected since there are fewer in-sync replicas than required.
acks=1:   "sent":1,"acked":1
```

With `acks=all`, the leader refuses: it cannot get three copies, so it will not claim the payment is safe. With `acks=1` the same topic accepts the write — `min.insync.replicas` only protects `acks=all` producers. If broker 1 failed now, that payment could be gone. (`NotEnoughReplicasException` is retriable, so a real producer keeps retrying until `delivery.timeout.ms`; the test tool reports the first refusal.)

### 5. Bring the broker back

```bash run
docker start devforge-kafka-3 > /dev/null
for i in $(seq 1 90); do [ "$(show "$ALL" orders | grep -c 'in sync 1,2,3$')" = 3 ] && break; sleep 1; done
show "$ALL" orders
client kafka-leader-election.sh --bootstrap-server "$ALL" --election-type PREFERRED --topic orders --partition 2 2> /dev/null
show "$ALL" orders | grep 'partition 2'
client kafka-console-consumer.sh --bootstrap-server "$ALL" --topic orders --from-beginning --timeout-ms 5000 2> /dev/null | sort -n | tr '\n' ' '; echo
```

```text output
partition 0: leader 1, replicas 1,2,3, in sync 1,2,3
partition 1: leader 2, replicas 2,3,1, in sync 1,2,3
partition 2: leader 1, replicas 3,1,2, in sync 1,2,3
Successfully completed leader election (PREFERRED) for partitions orders-2
partition 2: leader 3, replicas 3,1,2, in sync 1,2,3
0 0 1 1 2 2 3 3 4 4 5 5 
```

- Broker 3 copied what it missed and rejoined every ISR.
- Leadership did not move back by itself straight away: partition 2 was still led by broker 1, leaving broker 1 with two partitions to lead. Kafka rebalances leaders automatically (`auto.leader.rebalance.enable`, checked every 300 s); `kafka-leader-election.sh` does it now.
- Both rounds of six records are there — values `0`–`5` twice — with nothing lost during the outage.

### 6. Clean up

```bash run
docker rm -f devforge-kafka-1 devforge-kafka-2 devforge-kafka-3 > /dev/null
docker network rm devforge-kafka-net > /dev/null
echo removed
```

```text output
removed
```

## Common mistakes

- **Replication factor 3 with `acks=1`.** The copies exist, but acknowledged records can still be lost if the leader fails first.
- **`min.insync.replicas` equal to the replication factor.** Any single broker restart then blocks all `acks=all` writes, as step 4 shows.
- **Turning on unclean leader election to "stay available".** An out-of-date replica becomes leader and acknowledged records disappear.
- **Two brokers in one rack or zone holding the same partition.** Set `broker.rack` so replicas are spread across failure domains.
- **Ignoring under-replicated partitions.** One more failure turns them into unavailable partitions.

## Where this fits in a real system

In **Kubernetes**, brokers run as a StatefulSet with persistent volumes and a PodDisruptionBudget so that a node drain never takes two replicas of a partition at once. **Prometheus** alerts on under-replicated partitions and offline partitions, and **Grafana** dashboards show ISR shrink and expand rates. Managed services run the same model across availability zones.
