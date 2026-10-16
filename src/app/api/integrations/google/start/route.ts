import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth-guard";
import { buildAuthUrl, randomToken } from "@/lib/gmail/oauth";
import { gmailConfig, gmailRedirectUri } from "@/lib/gmail/service";

const COOKIE_PATH = "/api/integrations/google";

/**
 * Starts connecting Gmail. The state and PKCE verifier ride in short-lived
 * httpOnly cookies scoped to the callback path, so the callback can prove the
 * response belongs to this browser's request (no login CSRF) and that the code
 * cannot be redeemed by anyone who only intercepted it.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login?callbackUrl=/capture", request.url));

  const config = gmailConfig();
  if (!config) return NextResponse.redirect(new URL("/capture?gmail=not_configured", request.url));

  const state = randomToken();
  const verifier = randomToken();
  const response = NextResponse.redirect(
    buildAuthUrl({
      clientId: config.clientId,
      redirectUri: gmailRedirectUri(request.url),
      state,
      verifier,
    }),
  );
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: request.nextUrl.protocol === "https:",
    path: COOKIE_PATH,
    maxAge: 600,
  };
  response.cookies.set("g_oauth_state", state, options);
  response.cookies.set("g_oauth_verifier", verifier, options);
  return response;
}
