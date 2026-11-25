import { useState } from "react";
import { assignment, consumerGroups, KEYS, lagOf, totalLag, type KafkaAction, type KafkaState, type Key } from "../../../shared/simulations/kafka/consumer-groups.ts";
import { Field } from "./Field.tsx";
import type { SimulationEntry, ViewProps } from "./registry.ts";

const SHOWN = 12; // most recent events drawn per partition

function command(a: KafkaAction): string {
  switch (a.type) {
    case "tick":
      return `(${a.count ?? 1} tick${(a.count ?? 1) === 1 ? "" : "s"} pass)`;
    case "addConsumer":
      return "start a consumer in the group";
    case "crashConsumer":
      return `${a.name} crashes`;
    case "burst":
      return `produce ${a.count} × key ${a.key}`;
    case "addPartitions":
      return `kafka-topics.sh --alter --partitions (+${a.count})`;
    case "resetOffsets":
      return "kafka-consumer-groups.sh --reset-offsets --to-earliest --execute";
  }
}

function KafkaGroupsView({ state, dispatch }: ViewProps<KafkaState, KafkaAction>) {
  const [key, setKey] = useState<Key>("zoya");
  const owners = new Map<number, string>();
  const groups = assignment(state);
  for (const [name, parts] of groups) for (const p of parts) owners.set(p, name);

  return (
    <div className="kafka-sim">
      <dl className="k8s-sim__summary">
        <div>
          <dt>Tick</dt>
          <dd>{state.tick}</dd>
        </div>
        <div>
          <dt>Arriving each tick</dt>
          <dd>{state.incoming.length} events</dd>
        </div>
        <div>
          <dt>Each member processes</dt>
          <dd>up to {state.capacity} per tick</dd>
        </div>
        <div>
          <dt>Total lag</dt>
          <dd>{totalLag(state)}</dd>
        </div>
      </dl>

      <ol className="kafka-sim__partitions" aria-label="Partitions of the topic orders">
        {state.partitions.map((log, p) => {
          const start = Math.max(0, log.length - SHOWN);
          return (
            <li key={p} className="kafka-sim__partition">
              <div className="kafka-sim__meta">
                <strong>P{p}</strong>
                <span>{owners.get(p) ?? "no reader"}</span>
                <span className={lagOf(state, p) > 0 ? "kafka-sim__lag kafka-sim__lag--behind" : "kafka-sim__lag"}>lag {lagOf(state, p)}</span>
              </div>
              <ol className="kafka-sim__log" aria-label={`Partition ${p}: ${log.length} events, offset ${state.committed[p]}, lag ${lagOf(state, p)}`}>
                {start > 0 ? <li className="kafka-sim__more">…{start} earlier</li> : null}
                {log.slice(start).map((e, i) => {
                  const offset = start + i;
                  const read = offset < (state.committed[p] ?? 0);
                  return (
                    <li key={e.seq} className="kafka-sim__event" data-read={read ? "true" : "false"} title={`offset ${offset}, key ${e.key}${read ? ", read" : ", not read yet"}`}>
                      {e.key}
                    </li>
                  );
                })}
              </ol>
            </li>
          );
        })}
      </ol>
      <p className="small muted">Solid cells have been read by the group; dashed cells are waiting (they count as lag).</p>

      <div className="kafka-sim__members">
        <strong>Group members</strong>
        {state.members.length ? (
          <ul>
            {[...groups].map(([name, parts]) => (
              <li key={name}>
                <span>
                  {name}: {parts.length ? parts.map((p) => `P${p}`).join(", ") : "idle — no partition"}
                </span>
                <button type="button" className="btn btn--small btn--ghost" onClick={() => dispatch({ type: "crashConsumer", name })}>
                  Crash {name}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">No members: nothing is being read.</p>
        )}
      </div>

      <div className="prom-sim__query">
        <button type="button" className="btn btn--small" onClick={() => dispatch({ type: "addConsumer" })}>
          Add a consumer
        </button>
        <Field label="Burst key">
          {(id) => (
            <select id={id} value={key} onChange={(e) => setKey(e.target.value as Key)}>
              {KEYS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          )}
        </Field>
        <button type="button" className="btn btn--small" onClick={() => dispatch({ type: "burst", key, count: 10 })}>
          Send 10 events
        </button>
        <button type="button" className="btn btn--small" onClick={() => dispatch({ type: "addPartitions", count: 1 })}>
          Add a partition
        </button>
        <button type="button" className="btn btn--small btn--ghost" onClick={() => dispatch({ type: "resetOffsets" })}>
          Reset offsets to earliest
        </button>
      </div>
    </div>
  );
}

const entry: SimulationEntry = { model: consumerGroups, View: KafkaGroupsView, command: (a) => command(a as KafkaAction) };
export default entry;
