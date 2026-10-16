import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth-guard";
import { exchangeCode } from "@/lib/gmail/oauth";
import { gmailConfig, gmailRedirectUri, saveGmailConnection } from "@/lib/gmail/service";

const COOKIE_PATH = "/api/integrations/google";

function finish(request: NextRequest, outcome: "connected" | "error") {
  const response = NextResponse.redirect(new URL(`/capture?gmail=${outcome}`, request.url));
  response.cookies.set("g_oauth_state", "", { path: COOKIE_PATH, maxAge: 0 });
  response.cookies.set("g_oauth_verifier", "", { path: COOKIE_PATH, maxAge: 0 });
  return response;
}

/**
 * Google sends the person back here. The state must match the cookie set at
 * the start, the code is redeemed with the PKCE verifier, and only the refresh
 * token is kept — encrypted. The mailbox address comes from Gmail's own
 * profile endpoint, which the read-only scope covers.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login?callbackUrl=/capture", request.url));

  const config = gmailConfig();
  const params = request.nextUrl.searchParams;
  const state = params.get("state");
  const code = params.get("code");
  const expected = request.cookies.get("g_oauth_state")?.value;
  const verifier = request.cookies.get("g_oauth_verifier")?.value;

  if (!config || params.get("error") || !code || !state || !expected || !verifier || state !== expected) {
    return finish(request, "error");
  }

  try {
    const tokens = await exchangeCode(fetch, {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: gmailRedirectUri(request.url),
      code,
      verifier,
    });
    const profile = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const { emailAddress } = (await profile.json().catch(() => ({}))) as { emailAddress?: string };
    if (!profile.ok || !emailAddress) return finish(request, "error");

    await saveGmailConnection(user.id, {
      refreshToken: tokens.refreshToken,
      scope: tokens.scope,
      email: emailAddress,
    });
    return finish(request, "connected");
  } catch (error) {
    console.error("[GET /api/integrations/google/callback]", error);
    return finish(request, "error");
  }
}
