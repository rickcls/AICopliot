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
    return NextResponse.json({ error: errorMessageFor(error) }, { status: 502 });
  }

  console.error(`[${context}]`, error);
  return NextResponse.json({ error: errorMessageFor(error) }, { status: 500 });
}

/**
 * The user-facing wording alone, for a route that has already sent its headers
 * and can no longer choose a status code — the chat stream reports a mid-answer
 * failure as an SSE `error` event. Kept here so the phrasing has one home.
 */
export function errorMessageFor(error: unknown): string {
  if (error instanceof AuthError) return error.message;
  if (error instanceof ProviderError) {
    return "The model provider is unavailable. Check OPENROUTER_API_KEY and try again.";
  }
  return "Something went wrong. Please try again.";
}
