export const levelLabel = (level: string): string => level.charAt(0).toUpperCase() + level.slice(1);
export const hours = (h: { min: number; max: number }): string => (h.min === h.max ? `About ${h.min} h` : `About ${h.min}–${h.max} h`);
export const statusLabel: Record<string, string> = {
  outline: "Curriculum outline",
  "in-progress": "Lessons in progress",
  complete: "Complete",
};
export function formatDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}
