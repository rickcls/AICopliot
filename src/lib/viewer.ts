import "server-only";
import { cache } from "react";
import { getSessionUser, getUserPreferences } from "@/lib/auth-guard";
import { DEFAULT_TIME_ZONE, localToday } from "@/lib/time";

/**
 * The viewer's "today" as UTC midnight of their local date — the anchor every
 * day comparison on a page uses (overdue, due soon, the timeline's today
 * marker). Not an instant: never use it for completedAt or report windows.
 */
export const getViewerToday = cache(async (): Promise<Date> => {
  const user = await getSessionUser();
  const preferences = user ? await getUserPreferences(user.id) : null;
  return localToday(preferences?.timeZone ?? DEFAULT_TIME_ZONE, new Date());
});
