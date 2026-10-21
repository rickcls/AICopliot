import { pkceChallenge } from "@/lib/oauth/pkce";

/**
 * Microsoft's OAuth 2.0 authorization-code flow with PKCE, for read-only mail.
 * Pure URL helpers here; the network calls take `fetch` as an argument so tests
 * never touch Microsoft.
 *
 * The `common` endpoint accepts both a company Microsoft 365 account and a
 * personal outlook.com one. Two things differ from Google: every refresh hands
 * back a new refresh token that must replace the stored one, and a company may
 * require its IT to approve the app before anyone in it can connect.
 */

export const OUTLOOK_SCOPES = "offline_access User.Read Mail.Read";
const AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";

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
    response_mode: "query",
    scope: OUTLOOK_SCOPES,
    // Someone signed in to both a work and a personal account chooses which.
    prompt: "select_account",
    state,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: "S256",
  });
  return `${AUTHORITY}/authorize?${params.toString()}`;
}

/**
 * The page a company's IT administrator opens to approve the app for everyone
 * there. `organizations` lets the administrator's own sign-in pick the company.
 */
export function adminConsentUrl(clientId: string): string {
  return `https://login.microsoftonline.com/organizations/adminconsent?client_id=${encodeURIComponent(clientId)}`;
}

/**
 * Whether Microsoft refused because the company has not approved the app,
 * rather than because something broke. AADSTS65001 is consent not granted,
 * 90094 and 90008 an administrator's approval being required.
 */
export function needsAdminConsent(error: string | null, description: string | null): boolean {
  return (
    error === "consent_required" ||
    /AADSTS(65001|90094|90008)\b/.test(description ?? "")
  );
}

export class OAuthError extends Error {
  constructor(
    message: string,
    /** Microsoft's error code, e.g. "invalid_grant" when a refresh token is dead. */
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

async function postForm(fetcher: typeof fetch, body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetcher(`${AUTHORITY}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || json.error) {
    throw new OAuthError(
      json.error_description ?? json.error ?? `Microsoft returned ${response.status}`,
      json.error ?? null,
    );
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
    scope: OUTLOOK_SCOPES,
  });
  if (!json.access_token || !json.refresh_token) {
    throw new OAuthError("Microsoft did not return a refresh token", null);
  }
  return { accessToken: json.access_token, refreshToken: json.refresh_token, scope: json.scope ?? OUTLOOK_SCOPES };
}

/** A fresh access token, and the refresh token to keep from now on. */
export async function refreshAccessToken(
  fetcher: typeof fetch,
  input: { clientId: string; clientSecret: string; refreshToken: string },
): Promise<{ accessToken: string; refreshToken: string }> {
  const json = await postForm(fetcher, {
    grant_type: "refresh_token",
    client_id: input.clientId,
    client_secret: input.clientSecret,
    refresh_token: input.refreshToken,
    scope: OUTLOOK_SCOPES,
  });
  if (!json.access_token) throw new OAuthError("Microsoft did not return an access token", null);
  // Microsoft rotates the refresh token; the old one stops working before long.
  return { accessToken: json.access_token, refreshToken: json.refresh_token ?? input.refreshToken };
}
