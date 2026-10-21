import "server-only";
import type { SessionUser, WorkspaceAccess } from "@/lib/auth-guard";
import { createCapture, getCapture, type CaptureAccess } from "@/lib/capture/service";
import { open, parseKey, seal } from "@/lib/crypto/secretbox";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import type { MailboxStatus, MailListItem } from "@/lib/mail/mailboxes";
import { htmlToText, mailCaptureBody, stripQuotedReply } from "@/lib/mail/text";
import { OAuthError, refreshAccessToken } from "@/lib/outlook/oauth";

/**
 * Read-only Outlook through Microsoft Graph, read only when the person asks —
 * the same contract as Gmail (invariant 23), for a company Microsoft 365
 * account or a personal one.
 *
 * "Check Outlook" lists recent inbox headers: no model call, nothing stored.
 * Only a message the person picks is read in full, and it becomes a private
 * capture (`source: email`, `externalId: outlook:{id}`) once per person. Its
 * text is someone else's words, which the capture prompt treats as data.
 */

const PROVIDER = "microsoft";
const GRAPH = "https://graph.microsoft.com/v1.0";
const MAX_LISTED = 20;
const LOOKBACK_DAYS = 3;
/** Graph ids are base64-like, sometimes with "/", "+" and padding. */
const MESSAGE_ID = /^[A-Za-z0-9+/=_-]{10,512}$/;

export type OutlookStatus = MailboxStatus;
export type OutlookListItem = MailListItem;

export class OutlookError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 502 | 503,
    readonly code: "not_configured" | "not_connected" | "reconnect" | "bad_id" | "microsoft",
  ) {
    super(message);
    this.name = "OutlookError";
  }
}

export function outlookConfig() {
  const env = getEnv();
  const key = parseKey(env.INTEGRATION_ENCRYPTION_KEY);
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET || !key) return null;
  return { clientId: env.MICROSOFT_CLIENT_ID, clientSecret: env.MICROSOFT_CLIENT_SECRET, key };
}

/** The callback URL Microsoft redirects to; must match the app registration. */
export function outlookRedirectUri(requestUrl: string): string {
  const origin = getEnv().APP_URL ?? new URL(requestUrl).origin;
  return new URL("/api/integrations/microsoft/callback", origin).toString();
}

export async function getOutlookStatus(userId: string): Promise<OutlookStatus> {
  const configured = outlookConfig() !== null;
  const account = configured
    ? await prisma.integrationAccount.findUnique({
        where: { userId_provider: { userId, provider: PROVIDER } },
        select: { email: true, needsReconnect: true },
      })
    : null;
  return {
    configured,
    connected: account !== null,
    email: account?.email ?? null,
    needsReconnect: account?.needsReconnect ?? false,
  };
}

function sealedToken(refreshToken: string, key: Buffer) {
  const sealed = seal(refreshToken, key);
  return { encryptedToken: sealed.ciphertext, iv: sealed.iv, authTag: sealed.tag };
}

export async function saveOutlookConnection(
  userId: string,
  input: { refreshToken: string; scope: string; email: string },
) {
  const config = outlookConfig();
  if (!config) throw new OutlookError("Outlook is not set up on this server", 503, "not_configured");
  const data = {
    email: input.email,
    scopes: input.scope,
    ...sealedToken(input.refreshToken, config.key),
    needsReconnect: false,
  };
  await prisma.integrationAccount.upsert({
    where: { userId_provider: { userId, provider: PROVIDER } },
    create: { userId, provider: PROVIDER, ...data },
    update: { ...data, connectedAt: new Date() },
  });
}

/**
 * Forgets the connection here. Microsoft has no endpoint to revoke a single
 * app's refresh token short of signing the person out everywhere, so the
 * person removes the app's access in their Microsoft account if they want it
 * gone there too; without the token this app can no longer read anything.
 */
export async function disconnectOutlook(userId: string) {
  await prisma.integrationAccount.deleteMany({ where: { userId, provider: PROVIDER } });
}

/** A fresh access token; the rotated refresh token replaces the stored one. */
async function accessTokenFor(userId: string, fetcher: typeof fetch): Promise<string> {
  const config = outlookConfig();
  if (!config) throw new OutlookError("Outlook is not set up on this server", 503, "not_configured");
  const account = await prisma.integrationAccount.findUnique({
    where: { userId_provider: { userId, provider: PROVIDER } },
  });
  if (!account) throw new OutlookError("Outlook is not connected", 409, "not_connected");
  if (account.needsReconnect) throw new OutlookError("Reconnect Outlook", 409, "reconnect");

  const stored = open({ ciphertext: account.encryptedToken, iv: account.iv, tag: account.authTag }, config.key);
  try {
    const tokens = await refreshAccessToken(fetcher, {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: stored,
    });
    if (tokens.refreshToken !== stored) {
      await prisma.integrationAccount.update({
        where: { id: account.id },
        data: sealedToken(tokens.refreshToken, config.key),
      });
    }
    return tokens.accessToken;
  } catch (error) {
    // invalid_grant: revoked, expired, or a password change. interaction_required:
    // the company now wants a fresh sign-in (MFA, conditional access).
    if (error instanceof OAuthError && (error.code === "invalid_grant" || error.code === "interaction_required")) {
      await prisma.integrationAccount.update({ where: { id: account.id }, data: { needsReconnect: true } });
      throw new OutlookError("Reconnect Outlook", 409, "reconnect");
    }
    throw new OutlookError("Microsoft could not be reached", 502, "microsoft");
  }
}

async function graphGet<T>(
  fetcher: typeof fetch,
  token: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetcher(`${GRAPH}${path}`, {
    headers: { Authorization: `Bearer ${token}`, ...headers },
  });
  if (!response.ok) throw new OutlookError(`Microsoft Graph returned ${response.status}`, 502, "microsoft");
  return (await response.json()) as T;
}

interface GraphAddress {
  emailAddress?: { name?: string; address?: string };
}

function formatAddress(sender: GraphAddress | undefined): string {
  const name = sender?.emailAddress?.name ?? "";
  const address = sender?.emailAddress?.address ?? "";
  return name && address && name !== address ? `${name} <${address}>` : name || address;
}

interface GraphListMessage {
  id: string;
  subject?: string;
  from?: GraphAddress;
  receivedDateTime?: string;
  bodyPreview?: string;
  inferenceClassification?: "focused" | "other";
}

/** Headers of recent inbox mail. No model call, nothing stored but a timestamp. */
export async function listRecentOutlookMail(
  access: WorkspaceAccess,
  fetcher: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<OutlookListItem[]> {
  const token = await accessTokenFor(access.userId, fetcher);
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  // Filtering on the date and sorting by it is the combination Graph allows;
  // Focused Inbox is applied here rather than in the query.
  const query = new URLSearchParams({
    $top: String(MAX_LISTED * 2),
    $select: "id,subject,from,receivedDateTime,bodyPreview,inferenceClassification",
    $filter: `receivedDateTime ge ${since}`,
    $orderby: "receivedDateTime desc",
  });
  const list = await graphGet<{ value?: GraphListMessage[] }>(
    fetcher,
    token,
    `/me/mailFolders/inbox/messages?${query.toString()}`,
  );
  const messages = (list.value ?? [])
    .filter((message) => message.inferenceClassification !== "other")
    .slice(0, MAX_LISTED);

  const externalIds = messages.map((message) => `outlook:${message.id}`);
  const captured = await prisma.capture.findMany({
    where: { workspaceId: access.workspaceId, userId: access.userId, externalId: { in: externalIds } },
    select: { id: true, externalId: true },
  });
  const captureByExternal = new Map(captured.map((capture) => [capture.externalId, capture.id]));

  await prisma.integrationAccount.updateMany({
    where: { userId: access.userId, provider: PROVIDER },
    data: { lastCheckedAt: now },
  });

  return messages.map((message) => ({
    id: message.id,
    from: formatAddress(message.from),
    subject: message.subject ?? "",
    date: message.receivedDateTime ?? "",
    snippet: message.bodyPreview ?? "",
    captureId: captureByExternal.get(`outlook:${message.id}`) ?? null,
  }));
}

interface GraphBody {
  contentType?: "text" | "html";
  content?: string;
}

/**
 * One message's own words. `uniqueBody` is the part not quoted from earlier in
 * the thread, which Graph works out itself; the quote markers are cut as well
 * in case a client quoted by hand. Asked for as text, it can still come back as
 * HTML from some mailboxes.
 */
export function outlookMessageText(message: { uniqueBody?: GraphBody; body?: GraphBody }): string {
  const part = message.uniqueBody?.content?.trim() ? message.uniqueBody : message.body;
  const content = part?.content ?? "";
  return stripQuotedReply(part?.contentType === "html" ? htmlToText(content) : content);
}

/**
 * Reads one chosen email in full and captures it. A second request for the
 * same email returns the first capture instead of making another.
 */
export async function captureOutlookEmail(
  access: WorkspaceAccess & { user: SessionUser },
  messageId: string,
  fetcher: typeof fetch = fetch,
) {
  if (!MESSAGE_ID.test(messageId)) throw new OutlookError("Not an Outlook message id", 400, "bad_id");
  const externalId = `outlook:${messageId}`;
  const captureAccess: CaptureAccess = access;
  const existing = await prisma.capture.findFirst({
    where: { workspaceId: access.workspaceId, userId: access.userId, externalId },
    select: { id: true },
  });
  if (existing) return getCapture(captureAccess, existing.id);

  const token = await accessTokenFor(access.userId, fetcher);
  const message = await graphGet<{
    subject?: string;
    from?: GraphAddress;
    receivedDateTime?: string;
    uniqueBody?: GraphBody;
    body?: GraphBody;
  }>(
    fetcher,
    token,
    `/me/messages/${encodeURIComponent(messageId)}?$select=subject,from,receivedDateTime,uniqueBody,body`,
    { Prefer: 'outlook.body-content-type="text"' },
  );

  return createCapture(captureAccess, {
    text: mailCaptureBody({
      from: formatAddress(message.from),
      subject: message.subject ?? "",
      date: message.receivedDateTime ?? "",
      text: outlookMessageText(message),
    }),
    source: "email",
    externalId,
  });
}
