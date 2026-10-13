import { useMemo, useState } from "react";
import {
  BOQ_NOTES,
  ELEMENT_CATEGORIES,
  boqToCsv,
  buildBoq,
  defaultRateTable,
  priceBoq,
  ratesFromCsv,
  ratesToCsv,
  summarizeCost,
  type BoqLine,
  type ElementQuantity,
  type PricedLine,
  type RateTable,
} from "@etabs-bridge/client";
import type { Project } from "../state/projectStore";
import { downloadText, parseProjectFile, pickTextFile } from "../state/projectStore";
import { BarChartH, compact } from "./charts";
import { DataTable, type Column } from "./DataTable";

interface Props {
  modelName: string;
  storyOrder: string[];
  elements: ElementQuantity[];
  project: Project;
  update: (fn: (p: Project) => Project) => void;
  replace: (p: Project) => void;
}

/** Turns a rate key into a readable label. */
export function describeRateKey(key: string): { label: string; unit: string } {
  const [kind, rest] = key.split(":", 2);
  switch (kind) {
    case "concrete":
      return { label: `Concrete ${rest}`, unit: "m³" };
    case "formwork":
      return { label: `Formwork to ${(rest ?? "").toLowerCase()}s`, unit: "m²" };
    case "rebar":
      return { label: "Reinforcement", unit: "kg" };
    case "steel":
      return { label: `Structural steel ${rest}`, unit: "t" };
    case "other":
      return { label: `Other material ${rest}`, unit: "m³" };
    default:
      return { label: key, unit: "" };
  }
}

/** BOQ (quantities) + 5D (rates, amounts, cost by story), with CSV/JSON exchange. */
export function BoqView({ modelName, storyOrder, elements, project, update, replace }: Props) {
  const [message, setMessage] = useState<string | null>(null);
  const settings = project.quantitySettings;

  const lines = useMemo(() => buildBoq(elements, { groupBy: project.boqGroupBy, settings }), [elements, project.boqGroupBy, settings]);
  const table: RateTable = useMemo(() => defaultRateTable(lines, project.rateTable ?? undefined), [lines, project.rateTable]);
  const priced = useMemo(() => priceBoq(lines, table), [lines, table]);
  const summary = useMemo(() => summarizeCost(priced, elements, table), [priced, elements, table]);
  const unmeasured = elements.filter((e) => e.issue);

  const totals = useMemo(() => {
    const sum = (item: BoqLine["item"]) => lines.filter((l) => l.item === item).reduce((s, l) => s + l.quantity, 0);
    return { concrete: sum("Concrete"), formwork: sum("Formwork"), rebar: sum("Reinforcement") / 1000, steel: sum("Structural steel") };
  }, [lines]);

  const money = (n: number) => `${table.currency} ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const setRate = (key: string, value: number) =>
    update((p) => ({ ...p, rateTable: { ...table, rates: { ...table.rates, [key]: value }, isSample: false } }));

  const storyCost = storyOrder.filter((s) => summary.byStory[s] !== undefined).map((s) => ({ label: s, value: summary.byStory[s] ?? 0 }));
  for (const [s, v] of Object.entries(summary.byStory)) if (!storyOrder.includes(s)) storyCost.unshift({ label: s, value: v });

  const columns: Column<PricedLine>[] = [
    { key: "code", header: "Code", value: (l) => l.code },
    { key: "desc", header: "Description", value: (l) => l.description },
    ...(project.boqGroupBy === "story" ? [{ key: "story", header: "Story", value: (l: PricedLine) => l.story ?? "" }] : []),
    { key: "unit", header: "Unit", value: (l) => l.unit },
    { key: "qty", header: "Quantity", value: (l) => Math.round(l.quantity * 1000) / 1000, numeric: true },
    { key: "n", header: "Objects", value: (l) => l.count, numeric: true },
    { key: "rate", header: `Rate (${table.currency})`, value: (l) => l.rate, numeric: true },
    { key: "amount", header: `Amount (${table.currency})`, value: (l) => Math.round(l.amount), numeric: true },
  ];

  const base = modelName.replace(/\.[^.]+$/, "") || "model";

  return (
    <div className="pad boq">
      {table.isSample && (
        <p className="warn banner flush" role="note">
          Rates are <strong>samples</strong> (INR) so the screen is not empty. Edit them below or import your rate sheet before using any amount.
        </p>
      )}
      {message && (
        <p className="muted" role="status">
          {message}
        </p>
      )}

      <div className="tiles">
        <Tile label={`Total cost (${table.currency})`} value={compact(summary.total)} />
        <Tile label="Concrete (m³)" value={compact(totals.concrete)} />
        <Tile label="Formwork (m²)" value={compact(totals.formwork)} />
        <Tile label="Reinforcement (t)" value={compact(totals.rebar)} />
        <Tile label="Structural steel (t)" value={compact(totals.steel)} />
      </div>

      <div className="toolbar spaced">
        <label>
          Group by{" "}
          <select value={project.boqGroupBy} onChange={(e) => update((p) => ({ ...p, boqGroupBy: e.target.value as Project["boqGroupBy"] }))}>
            <option value="item">Item</option>
            <option value="story">Item and story</option>
          </select>
        </label>
        <button type="button" onClick={() => downloadText(`${base}-boq.csv`, boqToCsv(priced, table.currency), "text/csv")}>
          Export BOQ (CSV)
        </button>
        <button type="button" onClick={() => downloadText(`${base}-rates.csv`, ratesToCsv(table), "text/csv")}>
          Export rates (CSV)
        </button>
        <button
          type="button"
          onClick={async () => {
            const text = await pickTextFile(".csv,text/csv");
            if (text === null) return;
            const { table: imported, errors } = ratesFromCsv(text);
            update((p) => ({ ...p, rateTable: { ...table, ...imported, rates: { ...table.rates, ...imported.rates } } }));
            setMessage(errors.length ? `Imported with ${errors.length} problem(s): ${errors.slice(0, 3).join("; ")}` : `Imported ${Object.keys(imported.rates).length} rates.`);
          }}
        >
          Import rates (CSV)
        </button>
        <button type="button" onClick={() => downloadText(`${base}-project.json`, JSON.stringify({ ...project, rateTable: table }, null, 2), "application/json")}>
          Export project (JSON)
        </button>
        <button
          type="button"
          onClick={async () => {
            const text = await pickTextFile(".json,application/json");
            if (text === null) return;
            const { project: imported, error } = parseProjectFile(text);
            if (imported) {
              replace(imported);
              setMessage(imported.model === modelName ? "Project imported." : `Project imported (it was saved for "${imported.model}").`);
            } else setMessage(error ?? "Import failed.");
          }}
        >
          Import project (JSON)
        </button>
      </div>

      <div className="boq-grid">
        <section className="card pad-sm">
          <h2>Cost by story</h2>
          {storyCost.length ? (
            <BarChartH data={storyCost} format={(v) => compact(v)} ariaLabel={`Cost by story in ${table.currency}`} />
          ) : (
            <p className="muted">Nothing priced yet.</p>
          )}
        </section>

        <section className="card pad-sm">
          <h2>Rates</h2>
          <label className="inline">
            Currency{" "}
            <input
              className="short"
              value={table.currency}
              maxLength={3}
              onChange={(e) => {
                const c = e.target.value.toUpperCase();
                if (/^[A-Z]{0,3}$/.test(c) && c.length === 3) update((p) => ({ ...p, rateTable: { ...table, currency: c, isSample: false } }));
              }}
              aria-label="Currency code"
            />
          </label>
          <table className="compact">
            <thead>
              <tr>
                <th>Item</th>
                <th>Unit</th>
                <th className="num">Rate</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(table.rates)
                .sort()
                .map((k) => {
                  const d = describeRateKey(k);
                  return (
                    <tr key={k}>
                      <td>{d.label}</td>
                      <td>{d.unit}</td>
                      <td className="num">
                        <NumberInput value={table.rates[k] ?? 0} onChange={(v) => setRate(k, v)} label={`Rate for ${d.label}`} />
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </section>

        <section className="card pad-sm">
          <h2>Quantity settings</h2>
          <table className="compact">
            <thead>
              <tr>
                <th>Element</th>
                <th className="num">Rebar (kg/m³)</th>
              </tr>
            </thead>
            <tbody>
              {ELEMENT_CATEGORIES.map((c) => (
                <tr key={c}>
                  <td>{c}</td>
                  <td className="num">
                    <NumberInput
                      value={settings.rebarRatios[c]}
                      onChange={(v) => update((p) => ({ ...p, quantitySettings: { ...settings, rebarRatios: { ...settings.rebarRatios, [c]: v } } }))}
                      label={`Rebar ratio for ${c}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Wastage (%)</h3>
          <div className="inline-fields">
            {(["concrete", "formwork", "rebar", "steel"] as const).map((k) => (
              <label key={k}>
                {k}
                <NumberInput
                  value={settings.wastagePercent[k]}
                  onChange={(v) => update((p) => ({ ...p, quantitySettings: { ...settings, wastagePercent: { ...settings.wastagePercent, [k]: v } } }))}
                  label={`Wastage for ${k}`}
                />
              </label>
            ))}
          </div>
        </section>
      </div>

      <h2>Bill of quantities</h2>
      <DataTable rows={priced} rowKey={(l) => l.code} columns={columns} />
      <p className="total-line">
        Total: <strong>{money(summary.total)}</strong>
        {table.isSample && <span className="muted"> (sample rates)</span>}
      </p>

      {unmeasured.length > 0 && (
        <details className="warn banner flush">
          <summary>{unmeasured.length} object(s) could not be measured</summary>
          <ul>
            {unmeasured.slice(0, 50).map((e) => (
              <li key={`${e.kind}${e.name}`}>
                {e.kind} {e.name} ({e.story}): {e.issue}
              </li>
            ))}
          </ul>
        </details>
      )}
      <h3>Measurement notes</h3>
      <ul className="muted small">
        {BOQ_NOTES.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="tile card">
      <div className="tile-value">{value}</div>
      <div className="muted">{label}</div>
    </div>
  );
}

/** Number input that only commits finite, non-negative values. */
function NumberInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  return (
    <input
      className="num-input"
      inputMode="decimal"
      aria-label={label}
      value={focused ? text : String(value)}
      onFocus={() => {
        setText(String(value));
        setFocused(true);
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== "" && Number.isFinite(n) && n >= 0) onChange(n);
      }}
    />
  );
}
