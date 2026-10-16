import { createHash, randomBytes } from "node:crypto";

/**
 * Google's OAuth 2.0 authorization-code flow with PKCE, for one scope:
 * read-only Gmail. Pure URL and verifier helpers live here; the network calls
 * take `fetch` as an argument so tests never touch Google.
 */

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function buildAuthUrl({
  clientId,
  redirectUri,
  state,
  verifier,
}: {
  clientId: string;
  redirectUri: string;
  state: string;
  verifier: string;
}): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_READONLY_SCOPE,
    // offline + consent is what makes Google return a refresh token every time.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: "S256",
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export class OAuthError extends Error {
  constructor(
    message: string,
    /** Google's error code, e.g. "invalid_grant" when a refresh token is dead. */
    readonly code: string | null,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function postForm(
  fetcher: typeof fetch,
  body: Record<string, string>,
): Promise<TokenResponse> {
  const response = await fetcher(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || json.error) {
    throw new OAuthError(json.error_description ?? json.error ?? `Google returned ${response.status}`, json.error ?? null);
  }
  return json;
}

export async function exchangeCode(
  fetcher: typeof fetch,
  input: { clientId: string; clientSecret: string; redirectUri: string; code: string; verifier: string },
): Promise<{ accessToken: string; refreshToken: string; scope: string }> {
  const json = await postForm(fetcher, {
    grant_type: "authorization_code",
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    code: input.code,
    code_verifier: input.verifier,
  });
  if (!json.access_token || !json.refresh_token) {
    throw new OAuthError("Google did not return a refresh token", null);
  }
  return { accessToken: json.access_token, refreshToken: json.refresh_token, scope: json.scope ?? GMAIL_READONLY_SCOPE };
}

export async function refreshAccessToken(
  fetcher: typeof fetch,
  input: { clientId: string; clientSecret: string; refreshToken: string },
): Promise<string> {
  const json = await postForm(fetcher, {
    grant_type: "refresh_token",
    client_id: input.clientId,
    client_secret: input.clientSecret,
    refresh_token: input.refreshToken,
  });
  if (!json.access_token) throw new OAuthError("Google did not return an access token", null);
  return json.access_token;
}

/** Best effort: a disconnect must succeed locally even if Google is unreachable. */
export async function revokeToken(fetcher: typeof fetch, token: string): Promise<void> {
  await fetcher(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => undefined);
}
