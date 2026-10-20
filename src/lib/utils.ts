import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/**
 * Formats an instant — when something was created, reviewed, or observed — as
 * a date and time in the viewer's time zone.
 *
 * Locale and zone are both required. Left to the runtime, the server (UTC on
 * Vercel) and the browser (the viewer's zone) print different text for the
 * same instant, which is a hydration mismatch, and a timestamp from 01:00 in
 * Hong Kong reads as the previous day.
 */
export function formatDate(value: string | Date, locale: string, timeZone: string): string {
  return new Date(value).toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
}

/** The calendar day an instant fell on, for the viewer. See `formatDate`. */
export function formatInstantDay(value: string | Date, locale: string, timeZone: string): string {
  return new Date(value).toLocaleDateString(locale, { dateStyle: "medium", timeZone });
}

/**
 * Formats a date-only value — a task due date or milestone target date. For an
 * instant (createdAt and the like) use `formatInstantDay` instead: this pins
 * UTC, which is right for a date and wrong for a moment.
 *
 * These are stored at UTC midnight (see src/lib/pm/rules.ts), so rendering them
 * in the viewer's local zone would show the previous day for anyone west of UTC
 * and disagree with the overdue calculation. Pinned to UTC, and with no time
 * component, because the user never entered one.
 */
export function formatDay(value: string | Date, locale?: string): string {
  // `locale` is passed by pages that know the viewer's language; without it
  // the runtime default applies, which can differ between server and browser.
  return new Date(value).toLocaleDateString(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  });
}
