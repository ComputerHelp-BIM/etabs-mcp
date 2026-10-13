import { parseConnectionFragment, type BridgeConnection } from "@etabs-bridge/client";

const STORAGE_KEY = "etabs-bridge.connection";

/**
 * Initial connection: the URL fragment from the plugin's "Open web app" button wins,
 * then the session's last connection. The fragment is removed from the address bar
 * immediately so the token does not linger in history or screenshots.
 *
 * sessionStorage (not localStorage): tokens are per ETABS session anyway and should not
 * outlive the browser tab.
 */
export function loadInitialConnection(): BridgeConnection | null {
  const fromHash = parseConnectionFragment(window.location.hash);
  if (fromHash) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    saveConnection(fromHash);
    return fromHash;
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BridgeConnection>;
    return typeof parsed.bridgeUrl === "string" && typeof parsed.token === "string"
      ? { bridgeUrl: parsed.bridgeUrl, token: parsed.token }
      : null;
  } catch {
    return null; // storage blocked or corrupt
  }
}

export function saveConnection(connection: BridgeConnection | null): void {
  try {
    if (connection) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable (private mode); the app still works for this page load.
  }
}
