---
id: redis-cache-under-load
title: Keep a cache stampede off the database
track: redis
level: intermediate
mode: simulation
estimated_minutes: 25
prerequisites: [redis-caching-and-rate-limiting, redis-memory-and-eviction]
objectives:
  - Predict, then measure, how cache-aside and the TTL change database load and the hit ratio over a minute of traffic.
  - Recognise a cache stampede when a hot key expires during a traffic spike, and explain why a high hit ratio can hide it.
  - Keep the database under its limit by letting only one request refill a missing key, both after an expiry and from a cold start.
checkpoints:
  - { id: predicted, text: "I wrote down a prediction before each experiment and compared it with the event log" }
  - { id: challenges, text: "The two challenges below show Done" }
simulation:
  id: redis-cache-load
  challenges: [survive-the-spike, from-cold]
resources:
  - title: Redis documentation
    url: https://redis.io/docs/latest/
    publisher: Redis
    type: documentation
    level: all
    official: true
    why: Command reference for SET with EX, INCR, EXPIRE (including the NX option) and TTL.
    verification: { status: verified, checked_on: 2026-11-25 }
verification:
  method: docs-checked
  details: The simulation is a labelled teaching model. Its reads follow the cache-aside pattern taught in the Redis lessons (read from the cache; on a miss, read the database and store the result with a TTL), with fixed traffic and a perfect single flight. Challenges are verified on the server by replaying your actions through the same model.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

Use the cache simulation like a scientist: **predict** what the database will see, **run** the minute of traffic, and **compare** with the chart and the event log. You finish when the server has verified both challenges.

This lab runs in your browser. It is a model of a cache in front of a database, not Redis itself; the lessons *Caching and rate limiting with Redis* and *Memory limits and eviction policies* use a real Redis server.

## Steps

### 1. Survive the spike

Choose the scenario **The hot key expires in the spike**. Traffic is 100 requests a second, rising to 400 from second 20 to 39, and 60 % of requests ask for one hot key. The database copes with 60 queries a second. Before you touch anything, write down:

- How many requests a second ask for the hot key during the spike?
- The hot key expires at second 25. With cache-aside, how many of those requests go to the database in that second?
- Will the hit ratio for the whole minute be high or low?

Now press **Step** a few times, then **Run the rest of the minute**. Read the event log for second 25, and compare the **Hit ratio** with the **Peak database load**. Is there a second spike later in the minute? Why does it happen then?

Settings can only change before the traffic starts, so press **Reset** before each new experiment. Try a different **TTL (seconds)** first. Predict whether it can change what happens at second 25, then test it.

Then look at the other settings. The challenge hint asks: what if only one of those requests went to the database, and the rest waited for it?

### 2. From a cold start

Choose **No cache yet**. Every request reads the database, which copes with 60 queries a second.

- With the cache off, predict the database load in a normal second and in a spike second.
- If you turn on **Cache-aside** and nothing else, what happens in second 0, when the cache is empty? And again when the keys expire together?

Run each idea for the whole minute and compare the peak with the limit. An empty cache misses on everything at once, just like an expired hot key. Which setting from step 1 also helps here, and why?

## Simulation

```simulation redis-cache-load
```

## Reset

The simulation has a **Reset** button that restores the scenario's starting state; you need it before changing any setting. Your verified challenges stay recorded.

## What you practised

A cache only protects the database while its keys are present. When a popular key expires, or before the cache has warmed up, every request for it misses at the same moment, and a good hit ratio over the minute can hide that spike. Letting one request refill the key while the others wait keeps the database's peak load under control.
