/**
 * Content ages (REMAINING_WORK.md §9): tools change monthly, so anything whose `last_reviewed` date is more than
 * twelve months before today (UTC) is reported — as a warning by `npm run content:build` (and a GitHub Actions
 * annotation in CI), and in its own section by `npm run content:audit`. It never fails the build.
 *
 * Every function takes "now" as an argument, so tests do not depend on the real clock.
 */

export const REVIEW_MAX_MONTHS = 12;

/** A content file whose last review is overdue. `file` is relative to the content root. */
export interface OverdueReview {
  file: string;
  last_reviewed: string;
  /** Whole calendar months between last_reviewed and today (UTC). */
  months: number;
}

const ymd = (date: string) => date.split("-").map(Number) as [number, number, number];

/**
 * The oldest last_reviewed date that is still within the limit on `now` (UTC): the same calendar day `months`
 * earlier. A day that month does not have rolls over (29 February 2028 → 1 March 2027).
 */
export function reviewCutoff(now: Date, months = REVIEW_MAX_MONTHS): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate())).toISOString().slice(0, 10);
}

/** Whole calendar months from `lastReviewed` (YYYY-MM-DD) to `now` (UTC). */
export function monthsSince(lastReviewed: string, now: Date): number {
  const [y, m, d] = ymd(lastReviewed);
  const months = (now.getUTCFullYear() - y) * 12 + (now.getUTCMonth() + 1 - m);
  return now.getUTCDate() < d ? months - 1 : months;
}

/** The overdue review for this file, or undefined when it was reviewed within the last `months` months. */
export function overdueReview(file: string, lastReviewed: string, now: Date, months = REVIEW_MAX_MONTHS): OverdueReview | undefined {
  if (lastReviewed >= reviewCutoff(now, months)) return undefined;
  return { file, last_reviewed: lastReviewed, months: monthsSince(lastReviewed, now) };
}

/** The build warning for an overdue review. */
export function reviewAgeWarning(r: OverdueReview): string {
  return `${r.file}: last reviewed ${r.last_reviewed}, ${r.months} months ago (more than ${REVIEW_MAX_MONTHS}) — check it against current documentation, then update last_reviewed`;
}

/**
 * A GitHub Actions workflow command that shows a warning annotation on the file in the run summary
 * (docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands). Values are escaped as the Actions
 * toolkit's escapeData/escapeProperty do, so a message cannot end the command early or start a new one.
 */
export function githubWarning(message: string, props: { file?: string; title?: string } = {}): string {
  const data = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const prop = (s: string) => data(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
  const list = Object.entries(props)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${prop(v as string)}`)
    .join(",");
  return `::warning${list ? ` ${list}` : ""}::${data(message)}`;
}

/** The content audit's section, as lines of Markdown. */
export function overdueReviewSection(overdue: OverdueReview[]): string[] {
  const lines = [`## Reviewed more than ${REVIEW_MAX_MONTHS} months ago (${overdue.length})`, ""];
  const sorted = [...overdue].sort((a, b) => a.last_reviewed.localeCompare(b.last_reviewed) || a.file.localeCompare(b.file));
  for (const r of sorted) lines.push(`- ${r.file}: last reviewed ${r.last_reviewed} (${r.months} months ago)`);
  if (!sorted.length) lines.push("- none");
  return lines;
}
