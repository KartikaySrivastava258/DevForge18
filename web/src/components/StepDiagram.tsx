import { useCallback, useEffect, useState } from "react";

/** Milliseconds each step stays on screen while playing. */
const PLAY_INTERVAL = 2800;

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

/**
 * Controls for one build-time step-through (scripts/lib/media.ts renders the
 * figure, the step list and an empty [data-controls] slot; this component is
 * portalled into that slot). Elements with data-step="N" appear at step N and
 * are highlighted while it is current; data-until="M" hides them after step M.
 * Play advances automatically and is offered only when the learner has not
 * asked for reduced motion; Previous/Next and the arrow keys always work.
 */
export function StepDiagram({ root }: { root: HTMLElement }) {
  const total = Number(root.dataset.steps) || 1;
  const captions = Array.from(root.querySelectorAll(".step-diagram__all li"), (li) => li.textContent ?? "");
  const [step, setStep] = useState(1);
  const [playing, setPlaying] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  const go = useCallback((next: number) => setStep(Math.min(total, Math.max(1, next))), [total]);

  // Reflect the current step in the SVG through data attributes styled in components.css.
  useEffect(() => {
    root.dataset.enhanced = "true";
    for (const el of root.querySelectorAll<SVGElement>("[data-step], [data-until]")) {
      const from = Number(el.dataset.step ?? 1);
      const until = el.dataset.until ? Number(el.dataset.until) : Infinity;
      el.dataset.stepState = step < from ? "future" : step > until ? "gone" : step === from && el.dataset.step ? "current" : "past";
    }
  }, [root, step]);

  // Playing: advance on a timer, stop at the end. Never runs under reduced motion.
  useEffect(() => {
    if (!playing || reducedMotion) return;
    if (step >= total) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setStep((s) => s + 1), PLAY_INTERVAL);
    return () => window.clearTimeout(timer);
  }, [playing, reducedMotion, step, total]);

  // Arrow keys anywhere in the figure, unless they are needed to scroll a cut-off figure.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const scroller = (e.target as HTMLElement).closest(".figure__scroll");
      if (scroller && scroller.scrollWidth > scroller.clientWidth) return;
      e.preventDefault();
      setPlaying(false);
      setStep((s) => Math.min(total, Math.max(1, s + (e.key === "ArrowRight" ? 1 : -1))));
    };
    root.addEventListener("keydown", onKey);
    return () => root.removeEventListener("keydown", onKey);
  }, [root, total]);

  const togglePlay = () => {
    if (playing) setPlaying(false);
    else {
      if (step >= total) setStep(1);
      setPlaying(true);
    }
  };

  return (
    <>
      <p className="step-diagram__caption" aria-live="polite">
        <span className="sr-only">Step {step} of {total}: </span>
        {captions[step - 1]}
      </p>
      {/* aria-disabled, not disabled: a disabled button would drop keyboard focus at the first or last step. */}
      <button type="button" className="btn btn--small" onClick={() => { setPlaying(false); go(step - 1); }} aria-disabled={step === 1}>
        Previous
      </button>
      <button type="button" className="btn btn--small" onClick={() => { setPlaying(false); go(step + 1); }} aria-disabled={step === total}>
        Next
      </button>
      {reducedMotion ? null : (
        <button type="button" className="btn btn--small btn--ghost" onClick={togglePlay}>
          {playing ? "Pause" : step >= total ? "Play again" : "Play"}
        </button>
      )}
      <span className="step-diagram__count" aria-hidden="true">
        Step {step} of {total}
      </span>
    </>
  );
}
