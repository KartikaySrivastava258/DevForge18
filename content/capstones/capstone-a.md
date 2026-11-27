---
id: capstone-a
letter: A
title: Production-style e-commerce platform
summary: A campus shop split into services — orders written with an outbox, events through Kafka to independent consumers, a Redis-backed catalogue, Nginx in front, all on Kubernetes, and observable end to end with traces, metrics and SLO alerts.
level: advanced
estimated_hours: 80
tracks: [postgresql, redis, kafka, nginx, docker, kubernetes, opentelemetry, prometheus-grafana]
architecture: media:capstones/capstone-a-architecture.svg
user_stories:
  - As a shopper, I want my order confirmed within a second even during a sale so that I do not abandon the checkout.
  - As a payments developer, I want every placed order delivered to us exactly once in effect so that no order is charged twice or never charged.
  - As an on-call engineer, I want to follow one order across every service and see which step is slow so that I fix the right thing during an incident.
  - As a product owner, I want an error budget for checkout so that we can decide with data whether to ship features or fix reliability.
milestones:
  - id: orders-and-outbox
    title: Orders that never lose their events
    goal: Accept orders in a PostgreSQL transaction that also writes an outbox row, and relay the outbox to Kafka so that an order and its event are never out of step.
    deliverables:
      - Orders service with its schema and migrations.
      - An outbox relay publishing OrderPlaced events keyed by order id.
    acceptance:
      - Killing the service between writing the order and publishing the event loses nothing — the event is published after restart.
      - Two concurrent orders for the last item in stock cannot both succeed.
      - Events of one order are read in the order they happened.
    reuses:
      - { kind: lesson, id: kafka-outbox-pattern }
      - { kind: lesson, id: postgresql-isolation-and-anomalies }
      - { kind: project, id: kafka-order-pipeline }
      - { kind: lab, id: postgresql-transactions-and-isolation }
  - id: async-fulfilment
    title: Independent consumers with safe retries
    goal: Payment, shipping and email consumers each read the order events in their own consumer group, retry temporary failures and park poison events in a dead-letter topic.
    deliverables:
      - Three consumers with idempotent handling and a dead-letter topic.
      - A runbook entry for inspecting and replaying dead letters.
    acceptance:
      - A duplicated event charges and emails once.
      - A malformed event is dead-lettered with a reason, and the consumer carries on.
      - Two instances of a consumer share the partitions; stopping one moves its work to the other.
    reuses:
      - { kind: project, id: kafka-notification-service }
      - { kind: project, id: kafka-campus-activity }
      - { kind: lab, id: kafka-retry-and-dead-letter }
  - id: catalogue-cache
    title: A catalogue that survives a sale
    goal: Serve the catalogue through a Redis cache with correct invalidation and stampede protection, and hold stock briefly while a shopper checks out.
    deliverables:
      - Cache-aside catalogue reads with TTLs and invalidation on price or stock changes.
      - Stock holds with expiry.
    acceptance:
      - A hundred concurrent requests for a cold product cause one database query.
      - A price change is visible on the next request.
      - An abandoned checkout releases its hold when the hold expires.
    reuses:
      - { kind: project, id: redis-catalogue-cache }
      - { kind: lesson, id: redis-cache-stampede-and-failures }
      - { kind: lab, id: redis-cache-under-load }
  - id: platform
    title: Running it on Kubernetes behind Nginx
    goal: Package every service as a small non-root image and run the system on a local Kubernetes cluster with probes, resource limits and rolling updates, with Nginx routing and limiting traffic at the edge.
    deliverables:
      - Dockerfiles, Kubernetes manifests and an Nginx configuration.
      - A rollout and rollback rehearsed and written down.
    acceptance:
      - Deleting a pod of any service causes no failed checkout while another replica runs.
      - A broken release is held back by readiness and rolled back with one command.
      - Every container has memory and CPU limits and runs as a non-root user.
    reuses:
      - { kind: lab, id: kubernetes-self-healing-and-rollouts }
      - { kind: lab, id: kubernetes-debug-broken-deployments }
      - { kind: project, id: nginx-load-balancing-demo }
      - { kind: project, id: docker-event-health }
  - id: observability
    title: Seeing one order end to end
    goal: Trace every order across HTTP and Kafka hops, expose RED metrics and consumer lag, and alert on the checkout SLO with burn-rate alerts.
    deliverables:
      - OpenTelemetry instrumentation and a Collector pipeline.
      - Dashboards and alert rules with unit tests.
    acceptance:
      - One order appears as one trace from Nginx through the orders service and Kafka to each consumer.
      - A deliberately slowed consumer shows up as growing lag and a burn-rate alert, not as a silent backlog.
      - Alert rules pass their promtool unit tests.
    reuses:
      - { kind: project, id: otel-tracing-microservices }
      - { kind: lesson, id: otel-context-propagation }
      - { kind: project, id: prom-slo-dashboard }
rubric:
  - { criterion: "Consistency", excellent: "No lost or duplicated effects under crashes and retries, demonstrated with fault-injection tests; the trade-offs of eventual consistency explained to a non-engineer.", good: "Outbox and idempotent consumers work in the tested scenarios.", needs_work: "Dual writes, or consumers that charge twice on a retry." }
  - { criterion: "Resilience", excellent: "Pods, brokers and caches can fail one at a time without failed checkouts; limits, probes and back-pressure are justified.", good: "Self-healing and rollbacks work.", needs_work: "A single failure takes checkout down." }
  - { criterion: "Observability", excellent: "Any slow or failed order can be explained from one trace and a dashboard within minutes; alerts are symptom-based and tested.", good: "Traces, dashboards and alerts exist and work.", needs_work: "Logs only." }
  - { criterion: "Design communication", excellent: "Architecture decision records for the main choices (outbox vs. transactions, cache strategy, partition keys), with alternatives considered.", good: "A clear README and diagram.", needs_work: "Undocumented design." }
  - { criterion: "Teamwork and delivery", excellent: "Small reviewed pull requests, CI for every service, a release plan and a short incident review of one rehearsed failure.", good: "Pull requests and CI throughout.", needs_work: "Big-bang integration at the end." }
stretch_goals:
  - Replace polling of the outbox with change data capture and compare the two.
  - Add a saga for cancellations that refunds and restocks across services.
  - Run a load test of a flash sale and publish the latency percentiles before and after your best optimisation.
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The college's student society runs a small online shop for merchandise and event tickets. On launch days thousands
of students try to buy at once, and the current single-process app either slows to a crawl or sells the same
last ticket twice. Rebuild it as a small distributed system: orders accepted synchronously and quickly, everything
else — payment, shipping, email — handled asynchronously by independent services that can fail and recover on
their own.

This is the hardest capstone. Its value is not the number of services but the guarantees between them: no lost
orders, no double charges, a catalogue that survives a sale, and enough observability to explain any slow order.

## Architecture

The orders service is the only writer of orders. It writes the order and an **outbox** row in one database
transaction, and a relay publishes the outbox to Kafka — the event exists if and only if the order does. Every
consumer is **idempotent**, so redelivery is safe. Redis is a performance layer: the system must stay correct, if
slower, without it. Kubernetes restarts and replaces pods; Nginx is the only public entry point.

Record the main decisions (why the outbox, which partition key, which cache invalidation) as short architecture
decision records in `docs/adr/`.

## Getting started

1. Start with milestone 1 on Docker Compose; move to Kubernetes only in milestone 4, when the services work.
2. Write a fault-injection test for each guarantee as you build it — kill the service mid-order, duplicate an event,
   stop Redis — and keep those tests in CI.
3. Split the team by service but integrate weekly: an end-to-end order must work at the end of every week.
4. Present a live demo: a flash sale with a pod deleted in the middle, followed by the trace and dashboard that
   explain what happened.
