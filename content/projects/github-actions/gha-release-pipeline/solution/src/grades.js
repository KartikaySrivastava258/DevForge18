// gradebook-lib: grade calculations shared by the campus gradebook and the course feedback tool.

const BANDS = [
  [90, "A"],
  [80, "B"],
  [70, "C"],
  [60, "D"],
];

/** The letter grade for a score from 0 to 100. Throws a RangeError outside that range. */
export function letterGrade(score) {
  if (typeof score !== "number" || Number.isNaN(score) || score < 0 || score > 100) throw new RangeError(`score must be 0-100, got ${score}`);
  return BANDS.find(([min]) => score >= min)?.[1] ?? "F";
}

/**
 * The weighted average of items such as [{ score: 80, weight: 0.4 }, { score: 90, weight: 0.6 }], rounded to
 * one decimal place. Weights must be positive; they do not have to add up to 1.
 */
export function weightedAverage(items) {
  if (!Array.isArray(items) || items.length === 0) throw new TypeError("give at least one item");
  let total = 0;
  let weights = 0;
  for (const { score, weight } of items) {
    if (!(weight > 0)) throw new RangeError("weights must be positive");
    letterGrade(score); // validates the score
    total += score * weight;
    weights += weight;
  }
  return Math.round((total / weights) * 10) / 10;
}
