import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth-guard";
import { exchangeCode, needsAdminConsent } from "@/lib/outlook/oauth";
import { outlookConfig, outlookRedirectUri, saveOutlookConnection } from "@/lib/outlook/service";

const COOKIE_PATH = "/api/integrations/microsoft";

function finish(request: NextRequest, outcome: "connected" | "error" | "needs_admin") {
  const response = NextResponse.redirect(new URL(`/capture?outlook=${outcome}`, request.url));
  response.cookies.set("ms_oauth_state", "", { path: COOKIE_PATH, maxAge: 0 });
  response.cookies.set("ms_oauth_verifier", "", { path: COOKIE_PATH, maxAge: 0 });
  return response;
}

/**
 * Microsoft sends the person back here. The state must match the cookie set at
 * the start, the code is redeemed with the PKCE verifier, and only the refresh
 * token is kept, encrypted. A company that has not approved the app comes back
 * as its own outcome, so the page can say what to ask IT for.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login?callbackUrl=/capture", request.url));

  const config = outlookConfig();
  const params = request.nextUrl.searchParams;
  const error = params.get("error");
  if (error) {
    return finish(request, needsAdminConsent(error, params.get("error_description")) ? "needs_admin" : "error");
  }
  const state = params.get("state");
  const code = params.get("code");
  const expected = request.cookies.get("ms_oauth_state")?.value;
  const verifier = request.cookies.get("ms_oauth_verifier")?.value;
  if (!config || !code || !state || !expected || !verifier || state !== expected) {
    return finish(request, "error");
  }

  try {
    const tokens = await exchangeCode(fetch, {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: outlookRedirectUri(request.url),
      code,
      verifier,
    });
    const profile = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const me = (await profile.json().catch(() => ({}))) as { mail?: string | null; userPrincipalName?: string };
    // A personal account may have no `mail`; its sign-in name is the address.
    const email = me.mail ?? me.userPrincipalName;
    if (!profile.ok || !email) return finish(request, "error");

    await saveOutlookConnection(user.id, { refreshToken: tokens.refreshToken, scope: tokens.scope, email });
    return finish(request, "connected");
  } catch (caught) {
    console.error("[GET /api/integrations/microsoft/callback]", caught);
    return finish(request, "error");
  }
}
