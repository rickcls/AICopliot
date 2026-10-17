import type { Translate } from "@/lib/i18n/translate";

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

export function formatThreadTime(
  iso: string,
  nowIso: string,
  t: Translate,
  dateLocale: string,
): string {
  const elapsed = new Date(nowIso).getTime() - new Date(iso).getTime();

  if (!Number.isFinite(elapsed)) return "";
  if (elapsed < MINUTE) return t("relativeTime.justNow");
  if (elapsed < HOUR) return t("relativeTime.minutes", { count: Math.floor(elapsed / MINUTE) });
  if (elapsed < DAY) return t("relativeTime.hours", { count: Math.floor(elapsed / HOUR) });
  if (elapsed < 7 * DAY) return t("relativeTime.days", { count: Math.floor(elapsed / DAY) });

  return new Date(iso).toLocaleDateString(dateLocale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
