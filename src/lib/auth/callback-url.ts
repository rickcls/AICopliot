/**
 * Where to send someone after signing in. Only a path on this site is
 * accepted: `//evil.example` and `/\evil.example` are protocol-relative URLs to
 * a browser, so a naive "starts with /" check would make the sign-in page an
 * open redirect.
 */
export function safeCallbackUrl(value: unknown, fallback = "/today"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    return fallback;
  }
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  // Backslashes are read as slashes by browsers; control characters can hide
  // a scheme from a reviewer. Neither belongs in a path this app links to.
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;

  const base = "http://callback.invalid";
  try {
    const url = new URL(value, base);
    if (url.origin !== base) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
