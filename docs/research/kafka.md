# Apache Kafka — research notes

Checked 2026-11-26 (UTC). Reuse these in lessons; add to them instead of researching again.

## Versions

| Component | Version | Notes |
|---|---|---|
| `apache/kafka` image | 4.4.0 `@sha256:833b867a…` | pinned since milestone 4; JRE only (Temurin 25), no compiler, no Python |
| Apicurio Registry | 3.3.4 (2026-11-03) `@sha256:3ee4423c…` | 680 MB; in-memory storage by default; Confluent-compatible API at `/apis/ccompat/v7`. Karapace 6.2.4 was rejected: its image is 1.7 GB |
| `python:3.12-slim` | `@sha256:191083cd…` | same digest as the LangChain lessons |
| `postgres` | 16.15-alpine3.23 (pushed 2026-11-11) `@sha256:8dc5ce24…` | |
| confluent-kafka (Python) | 2.16.1 (2026-10-28) | Apache-2.0; based on librdkafka 2.16.0. 2.16.2 (2026-11-18) was too new |
| fastavro | 1.13.0 (2026-10-05) | MIT |
| psycopg[binary] | 3.3.7 (2026-11-03) | |

## Facts confirmed (source → wording)

- Producer configs (kafka.apache.org/44/configuration/producer-configs/): `acks` default `all`; acks=0 "offset given back for each record will always be set to -1"; `enable.idempotence` default true "if no conflicting configurations are set" (needs acks=all, retries>0, max.in.flight ≤ 5); `delivery.timeout.ms` default 120000, should be ≥ request.timeout.ms + linger.ms; `linger.ms` default 5; `max.in.flight.requests.per.connection` default 5; `transactional.id`: by default transactions need 3 brokers (`transaction.state.log.replication.factor`).
- Topic configs (…/topic-configs/): `retention.ms` default 604800000 (7 days); `retention.bytes` per partition, default -1; `segment.ms` default 7 days; `cleanup.policy` delete/compact/both; `min.insync.replicas` with acks=all → NotEnoughReplicas / NotEnoughReplicasAfterAppend; `unclean.leader.election.enable` default false.
- Consumer configs (…/consumer-configs/): `isolation.level` default read_uncommitted (Java); `auto.offset.reset` earliest/latest/by_duration/none; `enable.auto.commit` default true.
- Broker configs (…/broker-configs/): `auto.leader.rebalance.enable` true, `leader.imbalance.check.interval.seconds` 300, `replica.lag.time.max.ms` 30000, `log.retention.check.interval.ms` 300000, `log.cleaner.backoff.ms` 15000.
- Design (…/44/design/design/): a message is committed when all ISR replicas have applied it; not lost while one replica that has it stays alive.
- Docker image README (github.com/apache/kafka/tree/4.4.0/docker/examples): with env vars, all required properties must be set; `KAFKA_FOO_BAR` ↔ `foo.bar`; offsets topic RF must be set to 1 on a single node; cluster example uses shared `CLUSTER_ID` and three controller voters.
- librdkafka 2.16.0 CONFIGURATION.md: `enable.idempotence` default false, `isolation.level` default read_committed, `acks` default -1, `auto.offset.reset` default largest.
- Confluent docs: schema evolution — default compatibility BACKWARD; wire format byte 0 = 0, bytes 1–4 schema ID, then data.
- Avro 1.12.0 spec, schema resolution: reader field with default missing in writer → default used; without default → error; writer-only fields ignored.
- microservices.io transactional outbox: problem "How to atomically update the database and send messages to a message broker?"; 2PC usually not an option.

## Observed while building lessons

- `docker pause` freezes the broker but the kernel still accepts TCP data: requests sent during the pause are processed on unpause. Records a producer reported as `TimeoutException` (delivery.timeout.ms=3000) were in the log afterwards.
- `kafka-verifiable-producer.sh` prints one JSON line per ack; `--acks` takes -1/0/1; `--producer.config` is deprecated in favour of `--command-config`; `--message-create-time` sets the first timestamp, later records add elapsed time; `--throughput` sends in bursts that share a millisecond timestamp.
- Records stamped 2026-01-15 into a 7-day-retention topic were deleted within seconds (retention check every 1 s): retention compares record timestamps with now.
- `--reset-offsets` on an active group: "Assignments can only be reset if the group 'reports' is inactive, but the current state is Stable." Resetting below the log start warns and moves to the earliest offset.
- Compaction with segment.ms=2000 and min.cleanable.dirty.ratio=0.01 ran within seconds once the segment rolled; kept records keep their offsets.
- Three-node combined KRaft cluster: `docker stop` of one node removes it from every ISR immediately; leaders move to the next ISR member; leadership does not move back until the auto rebalance (300 s) or `kafka-leader-election.sh --election-type PREFERRED`.
- Transaction markers take offsets: 3 committed + 2 aborted records → end offset 7.
- Apicurio's compatibility starts at NONE; `PUT /config {"compatibility":"BACKWARD"}` sets it; incompatible registration → HTTP 409 with "num of incompatible diffs".
- fastavro error for a reader field without default: `SchemaResolutionError: No default value for field customer in shop.Order`.
- Run blocks use `set -o pipefail`: `… | grep -q` can fail when the writer gets SIGPIPE — use `grep … > /dev/null` (now enforced by the content build).
