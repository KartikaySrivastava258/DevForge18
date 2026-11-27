# Canteen order events

The canteen's ordering app records every change to an order as an event in `orders.jsonl`:
`placed`, then `paid`, then `shipped` (or `cancelled`). The billing team wants them in Kafka so several services
can read them. The topic `orders` has **3 partitions**.

- `producer.py` publishes every event from `orders.jsonl` to `orders` and prints `sent <n>`. Every event must
  arrive, and the events of one order must be read in the order they happened.
- `consumer.py`, in the consumer group `order-status`, reads the events it has not processed yet, stops after 5
  seconds without new events, and prints a JSON object of each order's latest status, for example
  `{"ord-0001": "shipped", …}`. Run it again and it prints `{}` — nothing is processed twice.

Both read the broker address from the `BOOTSTRAP` environment variable.

The current versions lose events, mix up the order of events, and read almost nothing.
