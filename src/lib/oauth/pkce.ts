import { createHash, randomBytes } from "node:crypto";

/** State and PKCE verifiers: 32 random bytes each, URL-safe. Shared by every OAuth flow. */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
