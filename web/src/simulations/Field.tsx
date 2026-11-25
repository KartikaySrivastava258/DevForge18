import { useId, type ReactNode } from "react";

/**
 * A labelled control. The label is linked with htmlFor/id rather than by
 * wrapping, so a select's accessible name is its label alone, not the label
 * plus every option's text.
 */
export function Field({ label, grow, children }: { label: string; grow?: boolean; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className={`sim__field${grow ? " sim__field--grow" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}
