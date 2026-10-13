import { lazy, Suspense, useMemo, useState } from "react";
import {
  deformedGeometry,
  designRebarKg,
  driftProfile,
  loadTakedown,
  maxDisplacement,
  type BaseReactionRow,
  type BridgeClient,
  type ConcreteDesignRow,
  type FrameForceRow,
  type GeometrySnapshot,
  type LoadsResult,
  type SectionsResult,
} from "@etabs-bridge/client";
import type { Project } from "../state/projectStore";
import { useAsync } from "../state/useAsync";
import { LineChart, ProfileChart } from "./charts";
import { explain } from "./ConnectPanel";
import { DataTable, type Column } from "./DataTable";
import type { Selection } from "./ModelViewer";

const ModelViewer = lazy(() => import("./ModelViewer").then((m) => ({ default: m.ModelViewer })));

interface Props {
  client: BridgeClient;
  geometry: GeometrySnapshot;
  sections: SectionsResult | null;
  loads: LoadsResult | null;
  project: Project;
  update: (fn: (p: Project) => Project) => void;
}

const SUB = ["Reactions", "Drifts", "Deformed shape", "Frame forces", "Concrete design"] as const;
type Sub = (typeof SUB)[number];

/** Analysis and design results for a chosen set of load cases/combinations. */
export function ResultsView({ client, geometry, sections, loads, project, update }: Props) {
  const status = useAsync(() => client.resultsStatus(), [client]);
  const [cases, setCases] = useState<string[]>([]);
  const [combos, setCombos] = useState<string[]>([]);
  const [applied, setApplied] = useState<{ cases: string[]; combos: string[] } | null>(null);
  const [sub, setSub] = useState<Sub>("Reactions");

  if (status.status === "error") return <p className="error banner">{explain(status.error)}</p>;
  if (!status.data) return <p className="muted pad">Reading analysis status…</p>;
  const st = status.data;
  const finished = st.cases.filter((c) => c.status === "Finished").map((c) => c.name);
  const toggle = (list: string[], set: (v: string[]) => void, name: string) => set(list.includes(name) ? list.filter((x) => x !== name) : [...list, name]);

  return (
    <div className="pad results">
      {!st.isLocked && (
        <p className="warn banner flush">The model is not locked, so it has probably not been analysed. Run the analysis in ETABS, then Refresh.</p>
      )}
      {st.warnings.length > 0 && <p className="muted small">{st.warnings.join(" · ")}</p>}

      <section className="card pad-sm selector">
        <div>
          <h3>Load cases</h3>
          <div className="chips">
            {st.cases.map((c) => (
              <label key={c.name} className={`chip ${c.status !== "Finished" ? "disabled" : ""}`} title={c.status}>
                <input type="checkbox" disabled={c.status !== "Finished"} checked={cases.includes(c.name)} onChange={() => toggle(cases, setCases, c.name)} />
                {c.name}
                {c.status !== "Finished" && <span className="muted small"> ({c.status})</span>}
              </label>
            ))}
          </div>
        </div>
        <div>
          <h3>Combinations</h3>
          <div className="chips">
            {st.combinations.map((c) => (
              <label key={c} className="chip">
                <input type="checkbox" checked={combos.includes(c)} onChange={() => toggle(combos, setCombos, c)} />
                {c}
              </label>
            ))}
          </div>
        </div>
        <div className="toolbar">
          <button type="button" className="primary" disabled={!cases.length && !combos.length} onClick={() => setApplied({ cases, combos })}>
            Show results
          </button>
          <button type="button" onClick={() => setCases(finished)}>
            All finished cases
          </button>
          <span className="muted small">Selecting results changes the output selection in your ETABS session (model data is not modified).</span>
        </div>
      </section>

      <nav className="subtabs" role="tablist">
        {SUB.map((s) => (
          <button key={s} type="button" role="tab" aria-selected={sub === s} className={sub === s ? "active" : undefined} onClick={() => setSub(s)}>
            {s}
          </button>
        ))}
      </nav>

      {sub === "Concrete design" ? (
        <DesignPanel client={client} geometry={geometry} sections={sections} project={project} update={update} />
      ) : !applied ? (
        <p className="muted">Choose cases or combinations above and press Show results.</p>
      ) : (
        <>
          {sub === "Reactions" && <ReactionsPanel key={key(applied)} client={client} sel={applied} geometry={geometry} loads={loads} />}
          {sub === "Drifts" && <DriftsPanel key={key(applied)} client={client} sel={applied} geometry={geometry} />}
          {sub === "Deformed shape" && <DeformedPanel key={key(applied)} client={client} sel={applied} geometry={geometry} sections={sections} />}
          {sub === "Frame forces" && <ForcesPanel key={key(applied)} client={client} sel={applied} geometry={geometry} />}
        </>
      )}
    </div>
  );
}

type Sel = { cases: string[]; combos: string[] };
/** Remount panels when the selection changes so their own state (chosen case, scale) resets. */
const key = (s: Sel) => JSON.stringify(s);
const fmt = (n: number, d = 2) => (Math.abs(n) >= 1000 ? Math.round(n).toLocaleString() : Number(n.toFixed(d)).toString());
const stepLabel = (r: { loadCase: string; stepType: string }) => (r.stepType ? `${r.loadCase} (${r.stepType})` : r.loadCase);

function Warnings({ list }: { list: string[] }) {
  return list.length ? <p className="muted small">{list.join(" · ")}</p> : null;
}

function ReactionsPanel({ client, sel, geometry, loads }: { client: BridgeClient; sel: Sel; geometry: GeometrySnapshot; loads: LoadsResult | null }) {
  const r = useAsync(() => client.baseReactions(sel), [client, sel]);
  const takedown = useMemo(() => new Map((loads ? loadTakedown(loads, geometry) : []).map((t) => [t.pattern, t])), [loads, geometry]);
  if (r.status === "error") return <p className="error">{explain(r.error)}</p>;
  if (!r.data) return <p className="muted">Reading base reactions…</p>;
  const { force: F, length: L } = r.data.units;
  const columns: Column<BaseReactionRow>[] = [
    { key: "c", header: "Case / combination", value: stepLabel },
    ...(["fx", "fy", "fz"] as const).map((k) => ({ key: k, header: `${k.toUpperCase()} (${F})`, value: (x: BaseReactionRow) => fmt(x[k]), numeric: true })),
    ...(["mx", "my", "mz"] as const).map((k) => ({ key: k, header: `${k.toUpperCase()} (${F}·${L})`, value: (x: BaseReactionRow) => fmt(x[k]), numeric: true })),
    {
      key: "check",
      header: `Applied gravity (${F})`,
      value: (x: BaseReactionRow) => {
        const t = takedown.get(x.loadCase);
        return t && !x.stepType ? fmt(t.total) + (t.selfWeightMultiplier ? " + self-weight" : "") : "—";
      },
    },
  ];
  return (
    <>
      <Warnings list={r.data.warnings} />
      <DataTable rows={r.data.rows} rowKey={(x) => `${x.loadCase}|${x.stepType}|${x.stepNum}`} columns={columns} />
      <p className="muted small">
        "Applied gravity" is the takedown of assigned loads for a case with the same name as a load pattern. For load cases, FZ should equal it (plus
        self-weight where the pattern includes it); a mismatch points to missing or misdirected loads.
      </p>
    </>
  );
}

function DriftsPanel({ client, sel, geometry }: { client: BridgeClient; sel: Sel; geometry: GeometrySnapshot }) {
  const r = useAsync(() => client.storyDrifts(sel), [client, sel]);
  const [limitText, setLimitText] = useState("0.004");
  if (r.status === "error") return <p className="error">{explain(r.error)}</p>;
  if (!r.data) return <p className="muted">Reading story drifts…</p>;
  const profile = driftProfile(r.data.rows, geometry);
  const directions = [...new Set(profile.flatMap((p) => Object.keys(p.drift)))].sort();
  const limit = Number(limitText);
  const exceed = profile.filter((p) => Object.values(p.drift).some((d) => limit > 0 && d > limit));
  return (
    <>
      <Warnings list={r.data.warnings} />
      <div className="toolbar">
        <label>
          Drift limit{" "}
          <input className="short" value={limitText} onChange={(e) => setLimitText(e.target.value)} aria-label="Drift limit ratio" inputMode="decimal" />
        </label>
        {limit > 0 && (
          <span className={exceed.length ? "status-bad" : "status-ok"}>
            {exceed.length ? `✕ ${exceed.length} story(ies) exceed 1/${Math.round(1 / limit)}` : `✓ All stories within 1/${Math.round(1 / limit)}`}
          </span>
        )}
      </div>
      <section className="card pad-sm">
        <h2>Maximum story drift (envelope of the selection)</h2>
        <ProfileChart
          rows={profile.map((p) => ({ label: p.story, values: directions.map((d) => p.drift[d] ?? null) }))}
          seriesNames={directions.map((d) => `Direction ${d}`)}
          format={(v) => v.toFixed(4)}
          limit={limit > 0 ? { value: limit, label: `Limit ${limitText}` } : null}
          ariaLabel="Story drift by story"
        />
      </section>
      <DataTable
        rows={[...profile].reverse()}
        rowKey={(p) => p.story}
        columns={[
          { key: "s", header: "Story", value: (p) => p.story },
          ...directions.flatMap((d) => [
            { key: `d${d}`, header: `Drift ${d}`, value: (p: (typeof profile)[number]) => (p.drift[d] ?? 0).toFixed(5), numeric: true },
            { key: `g${d}`, header: `Governing ${d}`, value: (p: (typeof profile)[number]) => p.governing[d] ?? "—" },
          ]),
        ]}
      />
    </>
  );
}

function DeformedPanel({ client, sel, geometry, sections }: { client: BridgeClient; sel: Sel; geometry: GeometrySnapshot; sections: SectionsResult | null }) {
  const options = [...sel.cases, ...sel.combos];
  const [which, setWhich] = useState(options[0] ?? "");
  const isCombo = sel.combos.includes(which);
  const r = useAsync(() => client.jointDisplacements(isCombo ? { combos: [which] } : { cases: [which] }), [client, which, isCombo]);
  const [scaleText, setScaleText] = useState("");
  const [selection, setSelection] = useState<Selection>(null);
  const steps = useMemo(() => [...new Set(r.data?.rows.map((x) => x.stepType) ?? [])], [r.data]);
  const [step, setStep] = useState<string | undefined>(undefined);
  const activeStep = step ?? steps[0];

  const maxU = r.data ? maxDisplacement(r.data.rows) : 0;
  const size = Math.max(1, ...geometry.joints.map((j) => Math.max(Math.abs(j.x), Math.abs(j.y), Math.abs(j.z))));
  // Default: largest displacement drawn as ~5 % of the building size.
  const autoScale = maxU > 0 ? Math.round((0.05 * size) / maxU) : 1;
  const scale = Number(scaleText) > 0 ? Number(scaleText) : autoScale;
  const deformed = useMemo(
    () => (r.data ? deformedGeometry(geometry, r.data.rows, which, scale, activeStep) : geometry),
    [r.data, geometry, which, scale, activeStep],
  );

  if (r.status === "error") return <p className="error">{explain(r.error)}</p>;
  return (
    <>
      <div className="toolbar">
        <label>
          Case{" "}
          <select value={which} onChange={(e) => setWhich(e.target.value)}>
            {options.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
        {steps.length > 1 && (
          <label>
            Step{" "}
            <select value={activeStep} onChange={(e) => setStep(e.target.value)}>
              {steps.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          Scale ×{" "}
          <input className="short" placeholder={String(autoScale)} value={scaleText} onChange={(e) => setScaleText(e.target.value)} inputMode="decimal" aria-label="Deformation scale" />
        </label>
        <span className="muted">
          Max displacement {fmt(maxU, 4)} {geometry.units.length} {r.status === "loading" && "· reading…"}
        </span>
      </div>
      {r.data && <Warnings list={r.data.warnings} />}
      <div className="viewer-layout fourd-layout">
        <Suspense fallback={<p className="muted pad">Loading 3D engine…</p>}>
          <ModelViewer geometry={deformed} sections={sections} selection={selection} onSelect={setSelection} initialDisplay="analytical" />
        </Suspense>
        <aside className="card pad-sm">
          <h2>Deformed shape</h2>
          <p className="muted small">
            Joints are moved by {scale}× their displacement (U1, U2, U3); members and slabs follow. Rotations and deformation along members are not
            drawn.
          </p>
        </aside>
      </div>
    </>
  );
}

function ForcesPanel({ client, sel, geometry }: { client: BridgeClient; sel: Sel; geometry: GeometrySnapshot }) {
  const [frame, setFrame] = useState(geometry.frames.find((f) => f.type === "Beam")?.name ?? geometry.frames[0]?.name ?? "");
  const r = useAsync(() => (frame ? client.frameForces({ ...sel, frame }) : Promise.resolve(null)), [client, sel, frame]);
  const f = geometry.frames.find((x) => x.name === frame);
  const label = (row: FrameForceRow) => stepLabel(row);
  const series = (key: "m3" | "v2" | "p") => {
    const by = new Map<string, Array<{ x: number; y: number }>>();
    for (const row of r.data?.rows ?? []) by.set(label(row), [...(by.get(label(row)) ?? []), { x: row.station, y: row[key] }]);
    return [...by.entries()].slice(0, 2).map(([name, points]) => ({ name, points }));
  };
  const U = r.data?.units;
  return (
    <>
      <div className="toolbar">
        <label>
          Frame{" "}
          <input className="short" value={frame} onChange={(e) => setFrame(e.target.value.trim())} list="frame-names" aria-label="Frame name" />
          <datalist id="frame-names">
            {geometry.frames.slice(0, 2000).map((x) => (
              <option key={x.name} value={x.name}>
                {x.label} {x.story} {x.type}
              </option>
            ))}
          </datalist>
        </label>
        {f && (
          <span className="muted">
            {f.type} {f.label} · {f.story} · {f.section}
          </span>
        )}
      </div>
      {r.status === "error" && <p className="error">{explain(r.error)}</p>}
      {r.data && (
        <>
          <Warnings list={r.data.warnings} />
          <p className="muted small">Charts show the first two cases/steps of the selection; the table lists all of them.</p>
          <div className="boq-grid">
            <section className="card pad-sm">
              <h2>
                M3 ({U?.force}·{U?.length})
              </h2>
              <LineChart series={series("m3")} formatX={(x) => `${fmt(x)} ${U?.length ?? ""}`} formatY={(y) => fmt(y)} ariaLabel="Major moment along the frame" height={200} />
            </section>
            <section className="card pad-sm">
              <h2>V2 ({U?.force})</h2>
              <LineChart series={series("v2")} formatX={(x) => `${fmt(x)} ${U?.length ?? ""}`} formatY={(y) => fmt(y)} ariaLabel="Major shear along the frame" height={200} />
            </section>
          </div>
          <DataTable
            rows={r.data.rows}
            rowKey={(x) => `${x.loadCase}|${x.stepType}|${x.station}`}
            columns={[
              { key: "c", header: "Case", value: label },
              { key: "s", header: `Station (${U?.length})`, value: (x) => fmt(x.station), numeric: true },
              ...(["p", "v2", "v3", "t", "m2", "m3"] as const).map((k) => ({ key: k, header: k.toUpperCase(), value: (x: FrameForceRow) => fmt(x[k]), numeric: true })),
            ]}
          />
        </>
      )}
    </>
  );
}

function DesignPanel({
  client,
  geometry,
  sections,
  project,
  update,
}: {
  client: BridgeClient;
  geometry: GeometrySnapshot;
  sections: SectionsResult | null;
  project: Project;
  update: (fn: (p: Project) => Project) => void;
}) {
  const r = useAsync(() => client.concreteDesign(), [client]);
  if (r.status === "error") return <p className="error">{explain(r.error)}</p>;
  if (!r.data) return <p className="muted">Reading concrete design results…</p>;
  const kg = sections ? designRebarKg(r.data.rows, geometry, sections) : null;
  const frames = [...new Set(r.data.rows.map((x) => x.frame))].map((frame) => {
    const st = r.data!.rows.filter((x) => x.frame === frame);
    const max = (k: keyof ConcreteDesignRow) => Math.max(...st.map((x) => (typeof x[k] === "number" ? (x[k] as number) : 0)));
    return { frame, kind: st[0]!.kind, top: max("topArea"), bottom: max("bottomArea"), long: max("longitudinalArea"), shear: max("shearAreaPerLength"), ratio: max("ratio"), kg: kg?.kgByFrame.get(frame) ?? 0 };
  });
  const u = r.data.units.length;
  return (
    <>
      <Warnings list={r.data.warnings} />
      <label className="check">
        <input type="checkbox" checked={project.useDesignRebar ?? false} onChange={(e) => update((p) => ({ ...p, useDesignRebar: e.target.checked }))} disabled={!frames.length} />
        Use this required reinforcement in the BOQ for designed frames (kg/m³ ratios elsewhere)
      </label>
      <p className="muted small">
        Required (not provided) steel: longitudinal = max over stations × length, shear = mean Av/s × length × (b + d). Laps, anchorage and minimum
        detailing are not included, so provided steel will be higher.
      </p>
      <DataTable
        rows={frames}
        rowKey={(x) => x.frame}
        columns={[
          { key: "f", header: "Frame", value: (x) => x.frame },
          { key: "k", header: "Kind", value: (x) => x.kind },
          { key: "t", header: `Max top (${u}²)`, value: (x) => (x.kind === "Beam" ? x.top.toExponential(3) : "—"), numeric: true },
          { key: "b", header: `Max bottom (${u}²)`, value: (x) => (x.kind === "Beam" ? x.bottom.toExponential(3) : "—"), numeric: true },
          { key: "l", header: `Max longitudinal (${u}²)`, value: (x) => (x.kind === "Column" ? x.long.toExponential(3) : "—"), numeric: true },
          { key: "v", header: `Max Av/s (${u}²/${u})`, value: (x) => x.shear.toExponential(3), numeric: true },
          { key: "r", header: "Max PMM ratio", value: (x) => (x.kind === "Column" ? x.ratio.toFixed(2) : "—"), numeric: true },
          { key: "kg", header: "Required rebar (kg)", value: (x) => Math.round(x.kg), numeric: true },
        ]}
      />
    </>
  );
}
