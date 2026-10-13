/** Connection details for one running bridge. */
export interface BridgeConnection {
  bridgeUrl: string;
  token: string;
}

/**
 * Reads "#bridgeUrl=...&token=..." as produced by the plugin's "Open web app" button
 * (BridgeSecurity.BuildWebAppLink in C#). Returns null when absent or malformed.
 * Fragments are never sent to the web server, so the token stays on the user's machine.
 */
export function parseConnectionFragment(hash: string): BridgeConnection | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const bridgeUrl = params.get("bridgeUrl");
  const token = params.get("token");
  if (!bridgeUrl || !token || !isBridgeUrl(bridgeUrl)) return null;
  return { bridgeUrl, token };
}

/**
 * Parses the "Copy connection JSON" text from the plugin window:
 * {"bridgeUrl":"http://localhost:52780","token":"..."}.
 */
export function parseConnectionJson(text: string): BridgeConnection | null {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) return null;
    const { bridgeUrl, token } = value as Record<string, unknown>;
    if (typeof bridgeUrl !== "string" || typeof token !== "string" || !token || !isBridgeUrl(bridgeUrl)) return null;
    return { bridgeUrl, token };
  } catch {
    return null;
  }
}

/** The bridge only listens on http://localhost; anything else is a typo or an attack. */
export function isBridgeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Rewrites 127.0.0.1 / [::1] to "localhost" and drops trailing slashes. The plugin's
 * HttpListener is registered for http://localhost:{port}/ only (no admin rights needed);
 * Windows http.sys rejects requests addressed to 127.0.0.1 with a non-JSON 400.
 */
export function normalizeBridgeUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === "127.0.0.1" || u.hostname === "[::1]") u.hostname = "localhost";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return url.replace(/\/+$/, "");
  }
}

/**
 * Same rules as the plugin's OriginMatcher (C#): "*" allows all; exact origins match
 * case-insensitively; "*" inside an entry matches one DNS label ([a-z0-9-]+, never a dot).
 */
export function isOriginAllowed(origin: string | undefined | null, allowedOrigins: readonly string[]): boolean {
  if (!origin) return false;
  const o = origin.replace(/\/+$/, "").toLowerCase();
  return allowedOrigins.some((raw) => {
    const entry = raw.trim().replace(/\/+$/, "").toLowerCase();
    if (!entry) return false;
    if (entry === "*") return true;
    if (!entry.includes("*")) return entry === o;
    const pattern = entry.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[a-z0-9-]+");
    return new RegExp(`^${pattern}$`).test(o);
  });
}
