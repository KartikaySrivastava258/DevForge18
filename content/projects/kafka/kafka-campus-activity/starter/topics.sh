#!/usr/bin/env bash
# Creates the topics. Run where kafka-topics.sh is on the PATH, with BOOTSTRAP set (e.g. kafka:9092).
set -euo pipefail
kafka-topics.sh --bootstrap-server "$BOOTSTRAP" --create --if-not-exists --topic campus-activity --partitions 1 --replication-factor 1
kafka-topics.sh --bootstrap-server "$BOOTSTRAP" --create --if-not-exists --topic building-occupancy --partitions 1 --replication-factor 1
