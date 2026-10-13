import { useState, type FormEvent } from "react";
import { BridgeClient, BridgeError, isBridgeUrl, parseConnectionJson, type BridgeConnection } from "@etabs-bridge/client";

interface Props {
  initial?: BridgeConnection | null;
  error?: string | null;
  onConnect: (connection: BridgeConnection) => void;
}

/** Manual connection form; normally skipped because the plugin opens the app with the link. */
export function ConnectPanel({ initial, error, onConnect }: Props) {
  const [bridgeUrl, setBridgeUrl] = useState(initial?.bridgeUrl ?? "http://localhost:52780");
  const [token, setToken] = useState(initial?.token ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(error ?? null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const fromJson = parseConnectionJson(token.trim());
    const connection = fromJson ?? { bridgeUrl: bridgeUrl.trim(), token: token.trim() };
    if (!isBridgeUrl(connection.bridgeUrl)) {
      setMessage("The bridge URL must be http://localhost:<port>, as shown in the ETABS Bridge window.");
      return;
    }
    if (!connection.token) {
      setMessage("Paste the token (or the connection JSON) from the ETABS Bridge window.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await new BridgeClient({ baseUrl: connection.bridgeUrl, token: connection.token, timeoutMs: 10_000 }).model();
      onConnect(connection);
    } catch (err) {
      setMessage(explain(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="connect">
      <form className="card connect-card" onSubmit={submit}>
        <h1>Connect to ETABS</h1>
        <ol className="steps">
          <li>Open your model in ETABS.</li>
          <li>
            Run <strong>Tools &gt; ETABS Bridge</strong> and keep its window open.
          </li>
          <li>
            Click <strong>Open web app</strong> there, or copy the URL and token below.
          </li>
        </ol>
        <label>
          Bridge URL
          <input value={bridgeUrl} onChange={(e) => setBridgeUrl(e.target.value)} spellCheck={false} autoComplete="off" />
        </label>
        <label>
          Token or connection JSON
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder='abc… or {"bridgeUrl":…,"token":…}'
          />
        </label>
        {message && (
          <p className="error" role="alert">
            {message}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Connecting…" : "Connect"}
        </button>
      </form>
    </main>
  );
}

export function explain(err: unknown): string {
  if (err instanceof BridgeError) {
    switch (err.code) {
      case "NETWORK":
        return globalThis.location?.protocol === "https:"
          ? // Hosted page -> http://localhost: the browser may ask before allowing it (Chrome/Edge "local network access"),
            // and a blocked CORS origin also surfaces as a network error.
            "Cannot reach the bridge. Is the ETABS Bridge window open, and is the port right? If your browser asked to allow " +
              "access to devices on your local network, choose Allow (or allow it in the site settings next to the address bar). " +
              `Also check that ${globalThis.location.origin} is listed in allowedOrigins in %APPDATA%\\EtabsBridge\\settings.json.`
          : "Cannot reach the bridge. Is the ETABS Bridge window open, and is the port right?";
      case "UNAUTHORIZED":
        return "The token was rejected. Each ETABS session has a new token; copy it again from the ETABS Bridge window.";
      case "FORBIDDEN_ORIGIN":
        return `${err.message} (settings file: %APPDATA%\\EtabsBridge\\settings.json, then restart the bridge)`;
      default:
        return `${err.code}: ${err.message}`;
    }
  }
  return err instanceof Error ? err.message : String(err);
}
