import "server-only";
import type { WorkspaceAccess, SessionUser } from "@/lib/auth-guard";
import { createCapture, getCapture, type CaptureAccess } from "@/lib/capture/service";
import { open, parseKey, seal } from "@/lib/crypto/secretbox";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { emailCaptureBody, header, type GmailPart } from "@/lib/gmail/message";
import type { MailboxStatus, MailListItem } from "@/lib/mail/mailboxes";
import { OAuthError, refreshAccessToken, revokeToken } from "@/lib/gmail/oauth";

/**
 * Read-only Gmail, read only when the person asks.
 *
 * "Check Gmail" lists recent inbox headers — no model call, nothing stored.
 * Only a message the person picks is read in full, and it becomes a private
 * capture (`source: email`, `externalId: gmail:{id}`), so the ordinary capture
 * pipeline proposes tasks from it and nothing is applied without a click. The
 * same email is captured once per person. Email text is someone else's words:
 * the capture prompt treats every line as data, never as instructions.
 */

const PROVIDER = "google";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const INBOX_QUERY = "in:inbox newer_than:3d -category:promotions -category:social";
const MAX_LISTED = 20;

export class GmailError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 502 | 503,
    readonly code: "not_configured" | "not_connected" | "reconnect" | "bad_id" | "google",
  ) {
    super(message);
    this.name = "GmailError";
  }
}

export function gmailConfig() {
  const env = getEnv();
  const key = parseKey(env.INTEGRATION_ENCRYPTION_KEY);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !key) return null;
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, key };
}

/** The callback URL Google redirects to; must match what the client registered. */
export function gmailRedirectUri(requestUrl: string): string {
  const origin = getEnv().APP_URL ?? new URL(requestUrl).origin;
  return new URL("/api/integrations/google/callback", origin).toString();
}

export type GmailStatus = MailboxStatus;

export async function getGmailStatus(userId: string): Promise<GmailStatus> {
  const configured = gmailConfig() !== null;
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

export async function saveGmailConnection(
  userId: string,
  input: { refreshToken: string; scope: string; email: string },
) {
  const config = gmailConfig();
  if (!config) throw new GmailError("Gmail is not set up on this server", 503, "not_configured");
  const sealed = seal(input.refreshToken, config.key);
  const data = {
    email: input.email,
    scopes: input.scope,
    encryptedToken: sealed.ciphertext,
    iv: sealed.iv,
    authTag: sealed.tag,
    needsReconnect: false,
  };
  await prisma.integrationAccount.upsert({
    where: { userId_provider: { userId, provider: PROVIDER } },
    create: { userId, provider: PROVIDER, ...data },
    update: { ...data, connectedAt: new Date() },
  });
}

export async function disconnectGmail(userId: string, fetcher: typeof fetch = fetch) {
  const config = gmailConfig();
  const account = await prisma.integrationAccount.findUnique({
    where: { userId_provider: { userId, provider: PROVIDER } },
  });
  if (!account) return;
  if (config) {
    try {
      const token = open({ ciphertext: account.encryptedToken, iv: account.iv, tag: account.authTag }, config.key);
      await revokeToken(fetcher, token);
    } catch {
      // A token that cannot be read or revoked is still removed below.
    }
  }
  await prisma.integrationAccount.deleteMany({ where: { userId, provider: PROVIDER } });
}

/** A fresh access token for this person, or a reconnect error if Google refuses. */
async function accessTokenFor(userId: string, fetcher: typeof fetch): Promise<string> {
  const config = gmailConfig();
  if (!config) throw new GmailError("Gmail is not set up on this server", 503, "not_configured");
  const account = await prisma.integrationAccount.findUnique({
    where: { userId_provider: { userId, provider: PROVIDER } },
  });
  if (!account) throw new GmailError("Gmail is not connected", 409, "not_connected");
  if (account.needsReconnect) throw new GmailError("Reconnect Gmail", 409, "reconnect");

  const refreshToken = open(
    { ciphertext: account.encryptedToken, iv: account.iv, tag: account.authTag },
    config.key,
  );
  try {
    return await refreshAccessToken(fetcher, {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken,
    });
  } catch (error) {
    if (error instanceof OAuthError && error.code === "invalid_grant") {
      await prisma.integrationAccount.update({
        where: { id: account.id },
        data: { needsReconnect: true },
      });
      throw new GmailError("Reconnect Gmail", 409, "reconnect");
    }
    throw new GmailError("Google could not be reached", 502, "google");
  }
}

async function gmailGet<T>(fetcher: typeof fetch, token: string, path: string): Promise<T> {
  const response = await fetcher(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new GmailError(`Gmail returned ${response.status}`, 502, "google");
  return (await response.json()) as T;
}

export type GmailListItem = MailListItem;

/** Headers of recent inbox mail. No model call, nothing stored but a timestamp. */
export async function listRecentMail(
  access: WorkspaceAccess,
  fetcher: typeof fetch = fetch,
): Promise<GmailListItem[]> {
  const token = await accessTokenFor(access.userId, fetcher);
  const list = await gmailGet<{ messages?: { id: string }[] }>(
    fetcher,
    token,
    `/messages?${new URLSearchParams({ q: INBOX_QUERY, maxResults: String(MAX_LISTED) })}`,
  );
  const ids = (list.messages ?? []).map((message) => message.id);

  const details = await Promise.all(
    ids.map((id) =>
      gmailGet<{ id: string; snippet?: string; payload?: GmailPart }>(
        fetcher,
        token,
        `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      ),
    ),
  );

  const captured = await prisma.capture.findMany({
    where: {
      workspaceId: access.workspaceId,
      userId: access.userId,
      externalId: { in: ids.map((id) => `gmail:${id}`) },
    },
    select: { id: true, externalId: true },
  });
  const captureByExternal = new Map(captured.map((capture) => [capture.externalId, capture.id]));

  await prisma.integrationAccount.updateMany({
    where: { userId: access.userId, provider: PROVIDER },
    data: { lastCheckedAt: new Date() },
  });

  return details.map((message) => ({
    id: message.id,
    from: header(message.payload, "From") ?? "",
    subject: header(message.payload, "Subject") ?? "",
    date: header(message.payload, "Date") ?? "",
    snippet: message.snippet ?? "",
    captureId: captureByExternal.get(`gmail:${message.id}`) ?? null,
  }));
}

/**
 * Reads one chosen email in full and captures it. A second request for the
 * same email returns the first capture instead of making another.
 */
export async function captureEmail(
  access: WorkspaceAccess & { user: SessionUser },
  messageId: string,
  fetcher: typeof fetch = fetch,
) {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(messageId)) {
    throw new GmailError("Not a Gmail message id", 400, "bad_id");
  }
  const externalId = `gmail:${messageId}`;
  const captureAccess: CaptureAccess = access;
  const existing = await prisma.capture.findFirst({
    where: { workspaceId: access.workspaceId, userId: access.userId, externalId },
    select: { id: true },
  });
  if (existing) return getCapture(captureAccess, existing.id);

  const token = await accessTokenFor(access.userId, fetcher);
  const message = await gmailGet<{ payload?: GmailPart }>(fetcher, token, `/messages/${messageId}?format=full`);
  if (!message.payload) throw new GmailError("The email could not be read", 404, "google");

  return createCapture(captureAccess, {
    text: emailCaptureBody(message.payload),
    source: "email",
    externalId,
  });
}
