import { useMemo, useState, type ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: string;
  value: (row: T) => string | number | boolean;
  render?: (row: T) => ReactNode;
  numeric?: boolean;
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  pageSize?: number;
  selectedKey?: string | null;
  onSelect?: (row: T) => void;
  emptyText?: string;
}

const formatNumber = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, ""));

/** Client-side table with search, column sorting and pagination (no virtualization needed at 100 rows/page). */
export function DataTable<T>({ rows, columns, rowKey, pageSize = 100, selectedKey, onSelect, emptyText = "No rows." }: Props<T>) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    let out = words.length
      ? rows.filter((r) => {
          const text = columns.map((c) => String(c.value(r))).join(" ").toLowerCase();
          return words.every((w) => text.includes(w));
        })
      : rows;
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) {
        out = [...out].sort((a, b) => {
          const va = col.value(a);
          const vb = col.value(b);
          const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
          return cmp * sort.dir;
        });
      }
    }
    return out;
  }, [rows, columns, query, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = filtered.slice(current * pageSize, (current + 1) * pageSize);

  const toggleSort = (key: string) =>
    setSort((s) => (s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null));

  return (
    <div className="datatable">
      <div className="toolbar">
        <input
          type="search"
          placeholder="Filter…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
          aria-label="Filter rows"
        />
        <span className="muted">
          {filtered.length.toLocaleString()} of {rows.length.toLocaleString()} rows
        </span>
        <Pager page={current} pages={pages} onPage={setPage} />
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.numeric ? "num" : undefined}>
                  <button type="button" onClick={() => toggleSort(c.key)} aria-label={`Sort by ${c.header}`}>
                    {c.header}
                    <span className="sort">{sort?.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const key = rowKey(row);
              return (
                <tr
                  key={key}
                  className={key === selectedKey ? "selected" : undefined}
                  onClick={onSelect ? () => onSelect(row) : undefined}
                  style={onSelect ? { cursor: "pointer" } : undefined}
                >
                  {columns.map((c) => {
                    const v = c.value(row);
                    return (
                      <td key={c.key} className={c.numeric ? "num" : undefined}>
                        {c.render ? c.render(row) : typeof v === "number" ? formatNumber(v) : String(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {visible.length === 0 && <p className="muted pad">{emptyText}</p>}
      </div>
    </div>
  );
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <span className="pager">
      <button type="button" onClick={() => onPage(page - 1)} disabled={page === 0} aria-label="Previous page">
        ‹
      </button>
      <span>
        {page + 1} / {pages}
      </span>
      <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages - 1} aria-label="Next page">
        ›
      </button>
    </span>
  );
}
