import { useMemo, useState } from "react";
import type { BridgeClient } from "@etabs-bridge/client";
import { useAsync } from "../state/useAsync";
import { explain } from "./ConnectPanel";
import { Pager } from "./DataTable";

const PAGE = 200;

/**
 * Browser for every ETABS database table (Display > Show Tables). This is the generic,
 * "everything ETABS can show" path: assignments, loads, and analysis results all appear
 * here without dedicated endpoints. Paging happens on the bridge.
 */
export function TablesBrowser({ client }: { client: BridgeClient }) {
  const catalogue = useAsync(() => client.tables(), [client]);
  const [filter, setFilter] = useState("");
  const [includeEmpty, setIncludeEmpty] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const tables = useMemo(() => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    return (catalogue.data?.tables ?? [])
      .filter((t) => includeEmpty || !t.isEmpty)
      .filter((t) => words.every((w) => t.key.toLowerCase().includes(w)))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [catalogue.data, filter, includeEmpty]);

  const data = useAsync(selected ? () => client.table(selected, { offset: page * PAGE, limit: PAGE }) : null, [client, selected, page]);
  const pages = data.data ? Math.max(1, Math.ceil(data.data.totalRows / PAGE)) : 1;

  return (
    <div className="split">
      <aside className="table-list">
        <input type="search" placeholder="Search tables…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search tables" />
        <label className="check">
          <input type="checkbox" checked={includeEmpty} onChange={(e) => setIncludeEmpty(e.target.checked)} />
          Include empty tables
        </label>
        {catalogue.status === "loading" && <p className="muted">Loading table list…</p>}
        {catalogue.status === "error" && <p className="error">{explain(catalogue.error)}</p>}
        <ul>
          {tables.map((t) => (
            <li key={t.key}>
              <button
                type="button"
                className={t.key === selected ? "active" : undefined}
                onClick={() => {
                  setSelected(t.key);
                  setPage(0);
                }}
              >
                {t.key}
                {t.isEmpty && <span className="muted"> (empty)</span>}
              </button>
            </li>
          ))}
        </ul>
        {catalogue.data && <p className="muted">{tables.length} of {catalogue.data.tables.length} tables</p>}
      </aside>
      <section className="table-view">
        {!selected && <p className="muted pad">Pick a table on the left. Results tables fill after the model is analyzed.</p>}
        {selected && (
          <>
            <div className="toolbar">
              <h2>{selected}</h2>
              {data.data && <span className="muted">{data.data.totalRows.toLocaleString()} rows</span>}
              {data.status === "loading" && <span className="muted">Loading…</span>}
              <Pager page={page} pages={pages} onPage={setPage} />
            </div>
            {data.status === "error" && <p className="error">{explain(data.error)}</p>}
            {data.data && (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {data.data.fields.map((f) => (
                        <th key={f}>{f}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.rows.map((row, i) => (
                      <tr key={data.data!.offset + i}>
                        {row.map((cell, j) => (
                          <td key={j}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
