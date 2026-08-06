/**
 * Compact timestamps for the thread rail.
 *
 * Takes `now` as an argument rather than calling `Date.now()`, because the rail
 * renders inside a client component: computing "2h" from a different instant at
 * hydration than at server render is a mismatch, and one that only shows up
 * across a bucket boundary. Older entries use an explicit locale and UTC for the
 * same reason — `undefined` would resolve to the server's locale on one pass and
 * the browser's on the other.
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatThreadTime(iso: string, nowIso: string): string {
  const elapsed = new Date(nowIso).getTime() - new Date(iso).getTime();

  if (!Number.isFinite(elapsed)) return "";
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d ago`;

  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
