#!/usr/bin/env bash
# Creates the topics. Run where kafka-topics.sh is on the PATH, with BOOTSTRAP set (e.g. kafka:9092).
set -euo pipefail
# Six partitions: up to six copies of occupancy.py can share the swipes. (More consumers than partitions
# would sit idle.) Replication factor 1 only because the lab has one broker.
kafka-topics.sh --bootstrap-server "$BOOTSTRAP" --create --if-not-exists --topic campus-activity \
  --partitions 6 --replication-factor 1
# Compacted: Kafka may delete older values of a key but keeps at least the latest one, so the topic always
# holds every building's current occupancy, however long it runs.
kafka-topics.sh --bootstrap-server "$BOOTSTRAP" --create --if-not-exists --topic building-occupancy \
  --partitions 1 --replication-factor 1 --config cleanup.policy=compact
