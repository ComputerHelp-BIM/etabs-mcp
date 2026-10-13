import { useMemo, useState } from "react";
import {
  describeCombination,
  loadTakedown,
  type AreaUniformLoad,
  type FrameDistributedLoad,
  type FramePointLoad,
  type GeometrySnapshot,
  type JointLoad,
  type LoadCase,
  type LoadCombination,
  type LoadsResult,
  type PatternTakedown,
} from "@etabs-bridge/client";
import { DataTable, type Column } from "./DataTable";

const DIRECTIONS: Record<number, string> = {
  1: "Local 1",
  2: "Local 2",
  3: "Local 3",
  4: "X",
  5: "Y",
  6: "Z",
  7: "X projected",
  8: "Y projected",
  9: "Z projected",
  10: "Gravity",
  11: "Gravity projected",
};
const dir = (d: number) => DIRECTIONS[d] ?? String(d);

const LISTS = ["Area uniform", "Frame distributed", "Frame point", "Joint"] as const;
type ListName = (typeof LISTS)[number];

/** Load patterns, cases, combinations, gravity takedown and assigned loads. */
export function LoadsView({ loads, loading, geometry }: { loads: LoadsResult | null; loading: boolean; geometry: GeometrySnapshot }) {
  const [list, setList] = useState<ListName>("Area uniform");
  const [pattern, setPattern] = useState("");
  const takedown = useMemo(() => (loads ? loadTakedown(loads, geometry) : []), [loads, geometry]);

  if (!loads) return <p className="muted pad">{loading ? "Reading loads from ETABS…" : "Loads need ETABS Bridge 0.5.0 or newer in ETABS."}</p>;
  const { force: F, length: L } = loads.units;
  const byPattern = <T extends { pattern: string }>(rows: T[]) => (pattern ? rows.filter((r) => r.pattern === pattern) : rows);

  const takedownColumns: Column<PatternTakedown>[] = [
    { key: "p", header: "Pattern", value: (r) => r.pattern },
    { key: "t", header: "Type", value: (r) => r.type },
    { key: "sw", header: "Self-weight ×", value: (r) => r.selfWeightMultiplier ?? "—", numeric: true },
    { key: "a", header: `Area loads (${F})`, value: (r) => round(r.area), numeric: true },
    { key: "fd", header: `Line loads (${F})`, value: (r) => round(r.frameDistributed), numeric: true },
    { key: "fp", header: `Point loads (${F})`, value: (r) => round(r.framePoint), numeric: true },
    { key: "j", header: `Joint loads (${F})`, value: (r) => round(r.joint), numeric: true },
    { key: "tot", header: `Total gravity (${F})`, value: (r) => round(r.total), numeric: true },
    { key: "nc", header: "Not counted", value: (r) => r.notCounted, numeric: true },
  ];

  return (
    <div className="pad">
      {loads.warnings.length > 0 && (
        <details className="warn banner flush">
          <summary>{loads.warnings.length} load value(s) could not be read from ETABS</summary>
          <ul>
            {loads.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      <h2>Gravity takedown by pattern</h2>
      <p className="muted small">
        Sum of assigned downward loads (gravity direction, or global Z), excluding self-weight. Lateral, local-axis and moment loads are counted in
        "Not counted". Compare with the base reactions once the model is analysed.
      </p>
      <DataTable rows={takedown} rowKey={(r) => r.pattern} columns={takedownColumns} />

      <div className="boq-grid">
        <section>
          <h2>Load cases</h2>
          <DataTable
            rows={loads.cases}
            rowKey={(c) => c.name}
            columns={[
              { key: "n", header: "Case", value: (c: LoadCase) => c.name },
              { key: "t", header: "Type", value: (c: LoadCase) => c.type },
            ]}
          />
        </section>
        <section>
          <h2>Combinations</h2>
          <DataTable
            rows={loads.combinations}
            rowKey={(c) => c.name}
            columns={[
              { key: "n", header: "Combination", value: (c: LoadCombination) => c.name },
              { key: "t", header: "Type", value: (c: LoadCombination) => c.type },
              { key: "f", header: "Definition", value: (c: LoadCombination) => describeCombination(c.items) },
            ]}
          />
        </section>
      </div>

      <h2>Assigned loads</h2>
      <div className="toolbar">
        <div className="segmented" role="radiogroup" aria-label="Load list">
          {LISTS.map((l) => (
            <button key={l} type="button" role="radio" aria-checked={list === l} className={list === l ? "active" : undefined} onClick={() => setList(l)}>
              {l} ({count(loads, l)})
            </button>
          ))}
        </div>
        <label>
          Pattern{" "}
          <select value={pattern} onChange={(e) => setPattern(e.target.value)}>
            <option value="">All</option>
            {loads.patterns.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {list === "Area uniform" && (
        <DataTable
          rows={byPattern(loads.areaUniform)}
          rowKey={(r) => `${r.area}|${r.pattern}|${r.direction}`}
          columns={[
            { key: "a", header: "Area", value: (r: AreaUniformLoad) => r.area },
            { key: "p", header: "Pattern", value: (r: AreaUniformLoad) => r.pattern },
            { key: "d", header: "Direction", value: (r: AreaUniformLoad) => dir(r.direction) },
            { key: "c", header: "CSys", value: (r: AreaUniformLoad) => r.cSys },
            { key: "v", header: `Value (${F}/${L}²)`, value: (r: AreaUniformLoad) => r.value, numeric: true },
          ]}
        />
      )}
      {list === "Frame distributed" && (
        <DataTable
          rows={byPattern(loads.frameDistributed)}
          rowKey={(r) => `${r.frame}|${r.pattern}|${r.direction}|${r.distanceStart}`}
          columns={[
            { key: "f", header: "Frame", value: (r: FrameDistributedLoad) => r.frame },
            { key: "p", header: "Pattern", value: (r: FrameDistributedLoad) => r.pattern },
            { key: "t", header: "Type", value: (r: FrameDistributedLoad) => r.loadType },
            { key: "d", header: "Direction", value: (r: FrameDistributedLoad) => dir(r.direction) },
            { key: "d1", header: `From (${L})`, value: (r: FrameDistributedLoad) => r.distanceStart, numeric: true },
            { key: "d2", header: `To (${L})`, value: (r: FrameDistributedLoad) => r.distanceEnd, numeric: true },
            { key: "v1", header: `Start (${F}/${L})`, value: (r: FrameDistributedLoad) => r.valueStart, numeric: true },
            { key: "v2", header: `End (${F}/${L})`, value: (r: FrameDistributedLoad) => r.valueEnd, numeric: true },
          ]}
        />
      )}
      {list === "Frame point" && (
        <DataTable
          rows={byPattern(loads.framePoint)}
          rowKey={(r) => `${r.frame}|${r.pattern}|${r.direction}|${r.distance}`}
          columns={[
            { key: "f", header: "Frame", value: (r: FramePointLoad) => r.frame },
            { key: "p", header: "Pattern", value: (r: FramePointLoad) => r.pattern },
            { key: "t", header: "Type", value: (r: FramePointLoad) => r.loadType },
            { key: "d", header: "Direction", value: (r: FramePointLoad) => dir(r.direction) },
            { key: "x", header: `At (${L})`, value: (r: FramePointLoad) => r.distance, numeric: true },
            { key: "v", header: `Value (${F})`, value: (r: FramePointLoad) => r.value, numeric: true },
          ]}
        />
      )}
      {list === "Joint" && (
        <DataTable
          rows={byPattern(loads.jointLoads)}
          rowKey={(r) => `${r.joint}|${r.pattern}`}
          columns={[
            { key: "j", header: "Joint", value: (r: JointLoad) => r.joint },
            { key: "p", header: "Pattern", value: (r: JointLoad) => r.pattern },
            { key: "c", header: "CSys", value: (r: JointLoad) => r.cSys },
            ...(["f1", "f2", "f3"] as const).map((k) => ({ key: k, header: `${k.toUpperCase()} (${F})`, value: (r: JointLoad) => r[k], numeric: true })),
            ...(["m1", "m2", "m3"] as const).map((k) => ({ key: k, header: `${k.toUpperCase()} (${F}·${L})`, value: (r: JointLoad) => r[k], numeric: true })),
          ]}
        />
      )}
    </div>
  );
}

function count(loads: LoadsResult, list: ListName): number {
  return { "Area uniform": loads.areaUniform, "Frame distributed": loads.frameDistributed, "Frame point": loads.framePoint, Joint: loads.jointLoads }[list].length;
}

const round = (n: number) => Math.round(n * 100) / 100;
