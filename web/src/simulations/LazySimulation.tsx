import { useEffect, useState } from "react";
import { ErrorState, Loading } from "../components/States.tsx";
import type { SimulationResponse } from "../lib/types.ts";
import { useApi } from "../lib/useApi.ts";
import { SIMULATIONS, type SimulationEntry } from "./registry.ts";
import { SimulationShell } from "./SimulationShell.tsx";

/**
 * Loads a simulation's content (API) and its model and view (a separate
 * JavaScript chunk, fetched only when a simulation is on screen).
 */
export function LazySimulation(props: { id: string; scenario?: string | null; headingLevel: 2 | 3; embedded?: boolean; title?: string; data?: SimulationResponse }) {
  // Not cached: the response includes the learner's completed challenges.
  const fetched = useApi<SimulationResponse>(props.data ? null : `/api/simulations/${encodeURIComponent(props.id)}`);
  const data = props.data ?? fetched.data;
  const [entry, setEntry] = useState<SimulationEntry | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = SIMULATIONS[props.id];
    if (!load) {
      setFailed(true);
      return;
    }
    load()
      .then((m) => alive && setEntry(m.default))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [props.id]);

  if (fetched.error) return <ErrorState error={fetched.error} onRetry={fetched.reload} />;
  if (failed) return <p className="notice notice--warn">This simulation could not be loaded. Reload the page to try again.</p>;
  if (!data || !entry) return <Loading label="Loading simulation" />;
  return (
    <SimulationShell
      sim={props.title ? { ...data.simulation, title: props.title } : data.simulation}
      entry={entry}
      completed={data.completed}
      initialScenario={props.scenario ?? null}
      headingLevel={props.headingLevel}
      embedded={props.embedded ?? false}
    />
  );
}
