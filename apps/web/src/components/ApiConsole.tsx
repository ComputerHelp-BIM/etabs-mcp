import { useState, type FormEvent } from "react";
import type { ApiCallResult, ApiMethodDescription, BridgeClient } from "@etabs-bridge/client";
import { useAsync } from "../state/useAsync";
import { explain } from "./ConnectPanel";

/**
 * Explorer for the full CSI API through the bridge's reflective RPC: browse objects,
 * inspect method signatures, call methods with JSON arguments. Writes are refused unless
 * enabled in the plugin window.
 */
export function ApiConsole({ client }: { client: BridgeClient }) {
  const [path, setPath] = useState("");
  const description = useAsync(() => client.describe(path), [client, path]);
  const [method, setMethod] = useState<ApiMethodDescription | null>(null);
  const [args, setArgs] = useState("{}");
  const [result, setResult] = useState<ApiCallResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const segments = path ? path.split(".") : [];
  const fullMethod = method ? (path ? `${path}.${method.name}` : method.name) : "";

  function pick(m: ApiMethodDescription) {
    setMethod(m);
    setResult(null);
    setError(null);
    const inputs = m.parameters.filter((p) => p.direction === "in");
    setArgs(JSON.stringify(Object.fromEntries(inputs.map((p) => [p.name, sample(p.type)])), null, 2));
  }

  async function run(e: FormEvent) {
    e.preventDefault();
    if (!method) return;
    let parsed: unknown;
    try {
      parsed = args.trim() ? JSON.parse(args) : undefined;
    } catch (err) {
      setError(`Arguments are not valid JSON: ${(err as Error).message}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await client.call(fullMethod, parsed as Record<string, unknown> | unknown[] | undefined));
    } catch (err) {
      setResult(null);
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="split">
      <aside className="table-list">
        <nav className="crumbs" aria-label="API path">
          <button type="button" onClick={() => setPath("")}>
            SapModel
          </button>
          {segments.map((s, i) => (
            <span key={i}>
              {" "}
              ›{" "}
              <button type="button" onClick={() => setPath(segments.slice(0, i + 1).join("."))}>
                {s}
              </button>
            </span>
          ))}
        </nav>
        {description.status === "error" && <p className="error">{explain(description.error)}</p>}
        {description.data && (
          <>
            {description.data.objects.length > 0 && <h3>Objects</h3>}
            <ul>
              {description.data.objects.map((o) => (
                <li key={o}>
                  <button type="button" onClick={() => setPath(path ? `${path}.${o}` : o)}>
                    {o} ›
                  </button>
                </li>
              ))}
            </ul>
            <h3>Methods</h3>
            <ul>
              {description.data.methods.map((m) => (
                <li key={m.name}>
                  <button type="button" className={m.name === method?.name ? "active" : undefined} onClick={() => pick(m)}>
                    {m.name}
                    {!m.readOnly && <span className="badge warn">write</span>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
      <section className="table-view pad">
        {!method && <p className="muted">Pick a method. Get*/Count* methods are read-only; others need "Allow write operations" in the ETABS Bridge window.</p>}
        {method && (
          <form onSubmit={run} className="api-form">
            <h2>
              <code>{fullMethod}</code>
            </h2>
            <table className="signature">
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th>Type</th>
                  <th>Direction</th>
                </tr>
              </thead>
              <tbody>
                {method.parameters.map((p) => (
                  <tr key={p.name}>
                    <td>
                      {p.name}
                      {p.optional && <span className="muted"> (optional)</span>}
                    </td>
                    <td>
                      <code>{p.type}</code>
                      {p.enumValues && <div className="muted small">{p.enumValues.join(", ")}</div>}
                    </td>
                    <td>{p.direction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <label>
              Arguments (JSON object by name, or array by position; ref/out parameters can be omitted)
              <textarea value={args} onChange={(e) => setArgs(e.target.value)} rows={6} spellCheck={false} />
            </label>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Calling…" : "Call"}
            </button>
            {error && <p className="error">{error}</p>}
            {result && <pre className="result">{JSON.stringify(result, null, 2)}</pre>}
          </form>
        )}
      </section>
    </div>
  );
}

function sample(type: string): unknown {
  if (type.endsWith("[]")) return [];
  if (type === "string") return "";
  if (type === "bool") return false;
  if (["double", "float", "int", "long", "short", "byte"].includes(type)) return 0;
  return "";
}
