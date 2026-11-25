import { Crumbs } from "../components/Crumbs.tsx";
import { ErrorState, Loading, NotFoundState } from "../components/States.tsx";
import { useLocation } from "../lib/router.tsx";
import type { SimulationResponse } from "../lib/types.ts";
import { useApi, useTitle } from "../lib/useApi.ts";
import { LazySimulation } from "../simulations/LazySimulation.tsx";

export function SimulationPage({ trackSlug, id }: { trackSlug: string; id: string }) {
  const { search } = useLocation();
  const { data, error, loading, reload } = useApi<SimulationResponse>(`/api/simulations/${encodeURIComponent(id)}`);
  useTitle(data ? `${data.simulation.title} (simulation)` : undefined);

  if (error) return <div className="page">{error.status === 404 ? <NotFoundState /> : <ErrorState error={error} onRetry={reload} />}</div>;
  if (loading || !data) return <div className="page"><Loading label="Loading simulation" /></div>;
  const { simulation, track } = data;
  if (simulation.track !== trackSlug) return <div className="page"><NotFoundState /></div>;

  return (
    <div className="page">
      <Crumbs
        items={[
          { label: "Tracks", to: "/tracks" },
          { label: track?.shortTitle ?? simulation.track, to: `/tracks/${simulation.track}` },
          { label: "Simulations", to: `/tracks/${simulation.track}#simulations` },
          { label: simulation.title },
        ]}
      />
      <header className="sim-page__head">
        <h1>{simulation.title}</h1>
        <p className="lede">{simulation.concept}</p>
        <section aria-labelledby="sim-objectives-h" className="objectives">
          <h2 id="sim-objectives-h">By the end you will be able to</h2>
          <ul>
            {simulation.learningObjectives.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </section>
      </header>
      <LazySimulation id={simulation.id} scenario={search.get("scenario")} headingLevel={2} title="Explore it" data={data} />
      <section className="section" aria-labelledby="sim-text-h" style={{ maxWidth: "var(--measure)" }}>
        <h2 id="sim-text-h">Using it without the picture</h2>
        <p>{simulation.textAlternative}</p>
      </section>
    </div>
  );
}
