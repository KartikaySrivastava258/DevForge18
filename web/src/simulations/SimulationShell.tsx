import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import { Link } from "../lib/router.tsx";
import type { PublicSimulation, VerifyResponse } from "../lib/types.ts";
import { Field } from "./Field.tsx";
import type { SimulationEntry } from "./registry.ts";

const SPEEDS = { slow: 1400, normal: 800, fast: 400 } as const;
type Speed = keyof typeof SPEEDS;

function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

interface LogEntry {
  id: number;
  command: string;
  lines: string[];
  refused?: boolean;
}

interface Props {
  sim: PublicSimulation;
  entry: SimulationEntry;
  completed: string[];
  initialScenario?: string | null;
  /** Heading level for the shell's title: 2 on the simulation page, 3 inside a lesson section. */
  headingLevel: 2 | 3;
  /** Embedded in a lesson: show a link to the full simulation page. */
  embedded?: boolean;
}

/**
 * Shared chrome for every simulation (REMAINING_WORK.md §4.3): the
 * "Simulation" badge and what the model simplifies, scenario picker,
 * step/play/pause/reset and speed for time-based models, text mode, an event
 * log that explains every change, and challenges whose completion is
 * verified by the server replaying the same actions (ADR 0008).
 */
export function SimulationShell({ sim, entry, completed: initiallyCompleted, initialScenario, headingLevel, embedded }: Props) {
  const { model, View, command } = entry;
  const { user } = useAuth();
  const reducedMotion = usePrefersReducedMotion();
  const timeBased = model.tick !== undefined;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const titleId = `sim-${sim.id}-title`;

  const [challengeId, setChallengeId] = useState<string | null>(() => {
    if (initialScenario) return sim.challenges.find((c) => c.scenario === initialScenario)?.id ?? null;
    return sim.challenges[0]?.id ?? null;
  });
  const challenge = sim.challenges.find((c) => c.id === challengeId) ?? null;
  const [scenarioId, setScenarioId] = useState<string>(() => initialScenario ?? challenge?.scenario ?? sim.scenarios[0]?.id ?? "");
  const scenario = sim.scenarios.find((s) => s.id === scenarioId) ?? sim.scenarios[0];

  // Scenario params arrive already validated and normalised by the content build.
  const params = scenario?.params;
  const start = useMemo(() => model.init(params), [model, params]);
  // The current state lives in a ref as well, so rapid actions (Play) always build on the latest one.
  const stateRef = useRef<unknown>(start.state);
  const [state, setStateValue] = useState<unknown>(start.state);
  const commit = (next: unknown) => {
    stateRef.current = next;
    setStateValue(next);
  };
  const [actions, setActions] = useState<unknown[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>("normal");
  const [textMode, setTextMode] = useState(false);
  const [completed, setCompleted] = useState(initiallyCompleted);
  const [result, setResult] = useState<"idle" | "solved" | "saved" | "error">("idle");
  const reported = useRef(false);
  const nextLogId = useRef(0);
  const root = useRef<HTMLElement>(null);

  const reset = useCallback(() => {
    commit(start.state);
    setActions([]);
    setPlaying(false);
    setResult("idle");
    reported.current = false;
    setLog([{ id: nextLogId.current++, command: "Scenario", lines: start.events }]);
    setAnnouncement(`Scenario reset: ${scenario?.title ?? ""}.`);
  }, [start, scenario]);
  useEffect(reset, [reset]);

  const dispatch = useCallback(
    (action: unknown) => {
      const r = model.step(stateRef.current, action);
      const label = command(action);
      if (r.error) {
        setLog((l) => [{ id: nextLogId.current++, command: label, lines: [r.error ?? ""], refused: true }, ...l].slice(0, 80));
        setAnnouncement(`Not possible: ${r.error}`);
        return;
      }
      commit(r.state);
      // Merge consecutive ticks so the action list sent for verification stays short.
      setActions((list) => {
        const last = list.at(-1) as { type?: string; count?: number } | undefined;
        const a = action as { type?: string; count?: number };
        if (a.type === "tick" && last?.type === "tick" && (last.count ?? 1) + (a.count ?? 1) <= 60) {
          return [...list.slice(0, -1), { type: "tick", count: (last.count ?? 1) + (a.count ?? 1) }];
        }
        return [...list, action];
      });
      if (r.events.length) {
        setLog((l) => [{ id: nextLogId.current++, command: label, lines: r.events }, ...l].slice(0, 80));
        setAnnouncement(r.events.join(" "));
      }
    },
    [model, command],
  );

  // Challenge: checked instantly here; when it passes, the server replays the
  // same actions through the same model to confirm and save it (ADR 0008).
  const initial = start.state;
  const challengeHere = challenge && challenge.scenario === scenarioId ? challenge : null;
  const solvedHere = useMemo(() => {
    const check = challengeHere ? model.checks[challengeHere.check] : undefined;
    return check ? check(state, initial) : false;
  }, [challengeHere, model, state, initial]);

  const verify = useCallback(async () => {
    if (!challenge || reported.current || actions.length === 0) return;
    reported.current = true;
    try {
      const res = await api<VerifyResponse>(`/api/simulations/${sim.id}/challenges/${challenge.id}/verify`, { method: "POST", body: { actions } });
      if (res.passed) {
        setCompleted(res.completed.length ? res.completed : completed);
        setResult(res.saved ? "saved" : "solved");
        setAnnouncement(`Challenge complete: ${challenge.title}.${res.saved ? " Saved to your progress." : ""}`);
      } else {
        reported.current = false;
      }
    } catch (err) {
      reported.current = false;
      setResult("error");
      setAnnouncement(err instanceof ApiError ? err.message : "Could not check the challenge.");
    }
  }, [challenge, actions, sim.id, completed]);

  useEffect(() => {
    if (solvedHere) void verify();
  }, [solvedHere, verify]);

  // Play: advance time on a timer. Pauses off-screen and in background tabs; not offered under reduced motion.
  useEffect(() => {
    if (!playing || !timeBased || reducedMotion) return;
    const timer = window.setInterval(() => dispatch(model.tick), SPEEDS[speed]);
    return () => window.clearInterval(timer);
  }, [playing, timeBased, reducedMotion, speed, dispatch, model]);
  useEffect(() => {
    if (!playing || !root.current) return;
    const io = new IntersectionObserver(([e]) => { if (e && !e.isIntersecting) setPlaying(false); });
    io.observe(root.current);
    const onHide = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [playing]);

  const chooseChallenge = (id: string) => {
    const c = sim.challenges.find((x) => x.id === id);
    setChallengeId(id);
    if (c && c.scenario !== scenarioId) setScenarioId(c.scenario);
    else reset();
  };
  const chooseScenario = (id: string) => {
    setScenarioId(id);
    const c = sim.challenges.find((x) => x.scenario === id);
    setChallengeId(c?.id ?? null);
  };

  const done = (id: string) => completed.includes(id);

  return (
    <section ref={root} className="sim" aria-labelledby={titleId} data-simulation-ready="true">
      <header className="sim__head">
        <div className="sim__title">
          <Heading id={titleId}>{sim.title}</Heading>
          <span className="tag tag--sim">Simulation</span>
        </div>
        <p className="muted">{sim.concept}</p>
        <details className="sim__limits">
          <summary>A teaching model, not the real tool: what it simplifies</summary>
          <ul>
            {sim.simplifications.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </details>
        {embedded ? (
          <p className="small">
            <Link to={`/tracks/${sim.track}/simulations/${sim.id}`}>Open the full simulation page</Link> for every scenario and challenge.
          </p>
        ) : null}
      </header>

      <div className="sim__bar" role="group" aria-label="Simulation controls">
        <Field label="Scenario">
          {(id) => (
            <select id={id} value={scenarioId} onChange={(e) => chooseScenario(e.target.value)}>
              {sim.scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          )}
        </Field>
        <button type="button" className="btn btn--small" onClick={reset}>
          Reset
        </button>
        {timeBased ? (
          <>
            <button type="button" className="btn btn--small" onClick={() => { setPlaying(false); dispatch(model.tick); }}>
              Step
            </button>
            {reducedMotion ? null : (
              <>
                <button type="button" className="btn btn--small" onClick={() => setPlaying((p) => !p)}>
                  {playing ? "Pause" : "Play"}
                </button>
                <Field label="Speed">
                  {(id) => (
                    <select id={id} value={speed} onChange={(e) => setSpeed(e.target.value as Speed)}>
                      <option value="slow">Slow</option>
                      <option value="normal">Normal</option>
                      <option value="fast">Fast</option>
                    </select>
                  )}
                </Field>
              </>
            )}
          </>
        ) : null}
        <button type="button" className="btn btn--small btn--ghost" aria-pressed={textMode} onClick={() => setTextMode((t) => !t)}>
          Text mode
        </button>
      </div>
      <p className="small muted sim__scenario">{scenario?.description}</p>

      <div className="sim__body">
        <div className="sim__stage">
          {textMode ? (
            <ul className="sim__text">
              {model.describe(state).map((line: string, i: number) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          ) : (
            <View state={state} dispatch={dispatch} />
          )}
        </div>

        <aside className="sim__side">
          {sim.challenges.length ? (
            <div className="sim__challenges">
              <Heading className="sim__side-title">Challenges</Heading>
              <ul className="sim__challenge-list">
                {sim.challenges.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="sim__challenge" aria-pressed={c.id === challengeId} onClick={() => chooseChallenge(c.id)}>
                      <span>{c.title}</span>
                      {done(c.id) ? <span className="tag tag--done">Done</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
              {challengeHere ? (
                <div className="sim__goal">
                  <p>
                    <strong>Goal:</strong> {challengeHere.goal}
                  </p>
                  <details>
                    <summary>Hint</summary>
                    <p>{challengeHere.hint}</p>
                  </details>
                  <p className="sim__status" data-state={result}>
                    {result === "saved"
                      ? "Solved and saved to your progress."
                      : result === "solved"
                        ? user
                          ? "Solved."
                          : "Solved. Sign in to save your progress."
                        : result === "error"
                          ? "Could not check right now; keep going and it will retry."
                          : done(challengeHere.id)
                            ? "You have solved this before. Reset to try again."
                            : "Not solved yet."}
                  </p>
                </div>
              ) : (
                <p className="small muted">Pick a challenge, or explore this scenario freely.</p>
              )}
            </div>
          ) : null}

          <div className="sim__log">
            <Heading className="sim__side-title">What happened</Heading>
            <ol reversed>
              {log.map((entry) => (
                <li key={entry.id} data-refused={entry.refused ? "true" : undefined}>
                  <code>{entry.command}</code>
                  {entry.lines.map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}
