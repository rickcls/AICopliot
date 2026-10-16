/**
 * Which calendar day it is for the person looking.
 *
 * Date-only values (due dates, target dates) are stored at UTC midnight, and
 * every rule in src/lib/pm/rules.ts compares them at UTC-day granularity. That
 * stays true. What changes is the anchor: instead of "today in UTC", rules are
 * handed "today where the viewer is", expressed the same way — UTC midnight of
 * the viewer's local date. At 07:00 in Hong Kong it is still yesterday in UTC,
 * and a task due today would otherwise read as due tomorrow, or a task due
 * yesterday as not yet overdue.
 *
 * The anchor is for day comparisons only. Instants — `completedAt`,
 * `reviewedAt`, report windows — keep using the real `new Date()`.
 */

export const DEFAULT_TIME_ZONE = "Asia/Hong_Kong";

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** `YYYY-MM-DD` of `now` in `timeZone`. An invalid zone falls back to the default. */
export function localDateString(timeZone: string, now: Date): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** UTC midnight of the viewer's local date — the anchor for day comparisons. */
export function localToday(timeZone: string, now: Date = new Date()): Date {
  return new Date(`${localDateString(timeZone, now)}T00:00:00.000Z`);
}
