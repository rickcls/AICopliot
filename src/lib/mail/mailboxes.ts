/**
 * The read-only mailboxes a person can connect, and where each one's routes
 * live. Client-safe: the panels and Settings share one shape for both.
 */

export type MailboxKind = "gmail" | "outlook";

export interface MailboxStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  needsReconnect: boolean;
}

export interface MailListItem {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  captureId: string | null;
}

export const MAILBOX_ROUTES: Record<
  MailboxKind,
  { start: string; account: string; list: string; capture: (id: string) => string }
> = {
  gmail: {
    start: "/api/integrations/google/start",
    account: "/api/integrations/google",
    list: "/api/gmail/messages",
    capture: (id) => `/api/gmail/messages/${id}/capture`,
  },
  outlook: {
    start: "/api/integrations/microsoft/start",
    account: "/api/integrations/microsoft",
    list: "/api/outlook/messages",
    // Graph ids can hold "/" and "+", so the segment is encoded.
    capture: (id) => `/api/outlook/messages/${encodeURIComponent(id)}/capture`,
  },
};
