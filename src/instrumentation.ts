/**
 * Prefer IPv4 for outbound HTTPS.
 *
 * On some networks (common on macOS when IPv6 is advertised but not routable),
 * Node's Happy Eyeballs / auto family selection times out on `fetch` even though
 * curl and raw IPv4 TCP succeed — which surfaces as
 * "Could not reach the model provider: fetch failed" during embedding.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const net = await import("node:net");
  const dns = await import("node:dns");

  dns.setDefaultResultOrder("ipv4first");
  if (typeof net.setDefaultAutoSelectFamily === "function") {
    net.setDefaultAutoSelectFamily(false);
  }
}
