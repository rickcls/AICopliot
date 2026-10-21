import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth-guard";
import { randomToken } from "@/lib/oauth/pkce";
import { buildAuthUrl } from "@/lib/outlook/oauth";
import { outlookConfig, outlookRedirectUri } from "@/lib/outlook/service";

const COOKIE_PATH = "/api/integrations/microsoft";

/**
 * Starts connecting Outlook. As with Gmail, the state and PKCE verifier ride
 * in short-lived httpOnly cookies scoped to the callback path, so the callback
 * can prove the response belongs to this browser's request.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login?callbackUrl=/capture", request.url));

  const config = outlookConfig();
  if (!config) return NextResponse.redirect(new URL("/capture?outlook=not_configured", request.url));

  const state = randomToken();
  const verifier = randomToken();
  const response = NextResponse.redirect(
    buildAuthUrl({ clientId: config.clientId, redirectUri: outlookRedirectUri(request.url), state, verifier }),
  );
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: request.nextUrl.protocol === "https:",
    path: COOKIE_PATH,
    maxAge: 600,
  };
  response.cookies.set("ms_oauth_state", state, options);
  response.cookies.set("ms_oauth_verifier", verifier, options);
  return response;
}
