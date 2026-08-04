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

export function formatDate(value: string | Date): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Formats a date-only value — a task due date or milestone target date.
 *
 * These are stored at UTC midnight (see src/lib/pm/rules.ts), so rendering them
 * in the viewer's local zone would show the previous day for anyone west of UTC
 * and disagree with the overdue calculation. Pinned to UTC, and with no time
 * component, because the user never entered one.
 */
export function formatDay(value: string | Date): string {
  return new Date(value).toLocaleDateString(undefined, {
    dateStyle: "medium",
    timeZone: "UTC",
  });
}
