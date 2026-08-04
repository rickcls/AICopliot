import "server-only";
import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth-guard";
import { ProviderError } from "@/lib/providers";

/**
 * Uniform error handling for route handlers. Auth and provider failures get
 * meaningful status codes; anything unexpected is logged server-side and
 * returned as a generic 500 so internals never reach the browser.
 */
export function handleRouteError(error: unknown, context: string) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof ProviderError) {
    console.error(`[${context}] provider error:`, error.message);
    return NextResponse.json(
      { error: "The model provider is unavailable. Check OPENROUTER_API_KEY and try again." },
      { status: 502 },
    );
  }

  console.error(`[${context}]`, error);
  return NextResponse.json(
    { error: "Something went wrong. Please try again." },
    { status: 500 },
  );
}
