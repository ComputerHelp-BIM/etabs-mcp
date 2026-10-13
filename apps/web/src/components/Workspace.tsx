import { lazy, Suspense, useMemo, useState } from "react";
import {
  summarizeGeometry,
  type AreaObject,
  type BridgeClient,
  type FrameMember,
  type GeometrySnapshot,
  type GridLine,
  type Joint,
  type Story,
} from "@etabs-bridge/client";
import { useAsync } from "../state/useAsync";
import { ApiConsole } from "./ApiConsole";
import { explain } from "./ConnectPanel";
import { DataTable, type Column } from "./DataTable";
import type { Selection } from "./ModelViewer";
import { TablesBrowser } from "./TablesBrowser";

// three.js is the bulk of the bundle; load it only when the 3D tab is shown.
const ModelViewer = lazy(() => import("./ModelViewer").then((m) => ({ default: m.ModelViewer })));

const TABS = ["3D view", "Summary", "Stories", "Grids", "Joints", "Frames", "Areas", "Database tables", "API console"] as const;
type Tab = (typeof TABS)[number];

interface Props {
  client: BridgeClient;
  onDisconnect: () => void;
}

export function Workspace({ client, onDisconnect }: Props) {
  const geometry = useAsync(() => client.geometry(), [client]);
  const [tab, setTab] = useState<Tab>("3D view");
  const [selection, setSelection] = useState<Selection>(null);
  const g = geometry.data;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">ETABS Model Viewer</div>
        {g && (
          <div className="model-meta" title={g.model.filePath}>
            <strong>{g.model.fileName || "(unsaved model)"}</strong>
            <span className="muted">
              ETABS {g.model.etabsVersion} · units {g.units.force}, {g.units.length} · bridge {g.model.bridgeVersion}
              {g.model.isLocked ? " · locked" : ""}
            </span>
          </div>
        )}
        <div className="actions">
          <button type="button" onClick={geometry.reload} disabled={geometry.status === "loading"}>
            {geometry.status === "loading" ? "Reading model…" : "Refresh"}
          </button>
          <button type="button" onClick={onDisconnect}>
            Disconnect
          </button>
        </div>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={t === tab} className={t === tab ? "active" : undefined} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>

      {geometry.status === "error" && (
        <p className="error banner" role="alert">
          {explain(geometry.error)}
        </p>
      )}
      {!g && geometry.status === "loading" && <p className="muted pad">Reading geometry from ETABS…</p>}

      <main className="content">
        {g && tab === "3D view" && (
          <div className="viewer-layout">
            <Suspense fallback={<p className="muted pad">Loading 3D engine…</p>}>
              <ModelViewer geometry={g} selection={selection} onSelect={setSelection} />
            </Suspense>
            <PropertiesPanel geometry={g} selection={selection} />
          </div>
        )}
        {g && tab === "Summary" && <SummaryView geometry={g} />}
        {g && tab === "Stories" && <StoriesTable geometry={g} />}
        {g && tab === "Grids" && <GridsTable geometry={g} />}
        {g && tab === "Joints" && <JointsTable geometry={g} />}
        {g && tab === "Frames" && <FramesTable geometry={g} onSelect={(f) => setSelection({ kind: "frame", name: f.name })} selected={selection} />}
        {g && tab === "Areas" && <AreasTable geometry={g} onSelect={(a) => setSelection({ kind: "area", name: a.name })} selected={selection} />}
        {tab === "Database tables" && <TablesBrowser client={client} />}
        {tab === "API console" && <ApiConsole client={client} />}
      </main>
    </div>
  );
}

function PropertiesPanel({ geometry, selection }: { geometry: GeometrySnapshot; selection: Selection }) {
  const rows = useMemo((): Array<[string, string]> | null => {
    if (!selection) return null;
    const u = geometry.units.length;
    const xyz = (p: { x: number; y: number; z: number }) => `${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)} ${u}`;
    if (selection.kind === "frame") {
      const f = geometry.frames.find((x) => x.name === selection.name);
      if (!f) return null;
      const length = Math.hypot(f.end.x - f.start.x, f.end.y - f.start.y, f.end.z - f.start.z);
      return [
        ["Object", `Frame ${f.name} (${f.label})`],
        ["Type", f.type],
        ["Story", f.story],
        ["Section", f.section],
        ["Joints", `${f.joint1} → ${f.joint2}`],
        ["Start", xyz(f.start)],
        ["End", xyz(f.end)],
        ["Length", `${fmt(length)} ${u}`],
        ["Angle", `${fmt(f.angle)}°`],
        ["Cardinal point", String(f.cardinalPoint)],
      ];
    }
    if (selection.kind === "area") {
      const a = geometry.areas.find((x) => x.name === selection.name);
      if (!a) return null;
      return [
        ["Object", `Area ${a.name} (${a.label})`],
        ["Type", a.type],
        ["Story", a.story],
        ["Section", a.section],
        ["Joints", a.joints.join(", ")],
        ["Vertices", String(a.points.length)],
      ];
    }
    const j = geometry.joints.find((x) => x.name === selection.name);
    if (!j) return null;
    return [
      ["Object", `Joint ${j.name} (${j.label})`],
      ["Story", j.story],
      ["Coordinates", xyz(j)],
      ["Restraints", restraintText(j)],
    ];
  }, [geometry, selection]);

  return (
    <aside className="properties card">
      <h2>Properties</h2>
      {!rows && <p className="muted">Click a frame, area or joint in the 3D view, or a row in the Frames/Areas tabs.</p>}
      {rows && (
        <dl>
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </aside>
  );
}

function SummaryView({ geometry }: { geometry: GeometrySnapshot }) {
  const s = useMemo(() => summarizeGeometry(geometry), [geometry]);
  const tiles: Array<[string, number]> = [
    ["Stories", s.counts.stories],
    ["Joints", s.counts.joints],
    ["Supports", s.counts.supports],
    ["Frames", s.counts.frames],
    ["Areas", s.counts.areas],
    ["Grid systems", s.counts.gridSystems],
  ];
  const sectionRows = [
    ...Object.entries(s.frameSections).map(([name, count]) => ({ name, kind: "Frame", count })),
    ...Object.entries(s.areaSections).map(([name, count]) => ({ name, kind: "Area", count })),
  ];
  return (
    <div className="summary pad">
      <div className="tiles">
        {tiles.map(([label, value]) => (
          <div key={label} className="tile card">
            <div className="tile-value">{value.toLocaleString()}</div>
            <div className="muted">{label}</div>
          </div>
        ))}
      </div>
      <h2>Objects per story</h2>
      <DataTable
        rows={s.stories}
        rowKey={(r) => r.name}
        columns={[
          { key: "name", header: "Story", value: (r) => r.name },
          { key: "elev", header: `Elevation (${geometry.units.length})`, value: (r) => r.elevation, numeric: true },
          { key: "joints", header: "Joints", value: (r) => r.joints, numeric: true },
          { key: "columns", header: "Columns", value: (r) => r.columns, numeric: true },
          { key: "beams", header: "Beams", value: (r) => r.beams, numeric: true },
          { key: "braces", header: "Braces", value: (r) => r.braces, numeric: true },
          { key: "floors", header: "Floors", value: (r) => r.floors, numeric: true },
          { key: "walls", header: "Walls", value: (r) => r.walls, numeric: true },
        ]}
      />
      <h2>Sections in use</h2>
      <DataTable
        rows={sectionRows}
        rowKey={(r) => `${r.kind}:${r.name}`}
        columns={[
          { key: "name", header: "Section", value: (r) => r.name },
          { key: "kind", header: "Object", value: (r) => r.kind },
          { key: "count", header: "Count", value: (r) => r.count, numeric: true },
        ]}
      />
    </div>
  );
}

function StoriesTable({ geometry }: { geometry: GeometrySnapshot }) {
  const u = geometry.units.length;
  const columns: Column<Story>[] = [
    { key: "name", header: "Story", value: (s) => s.name, render: (s) => <><span className="dot" style={{ background: s.color }} />{s.name}</> },
    { key: "elev", header: `Elevation (${u})`, value: (s) => s.elevation, numeric: true },
    { key: "height", header: `Height (${u})`, value: (s) => s.height, numeric: true },
    { key: "master", header: "Master", value: (s) => (s.isMaster ? "Yes" : "No") },
    { key: "similar", header: "Similar to", value: (s) => s.similarTo ?? "—" },
    { key: "splice", header: "Splice above", value: (s) => (s.spliceAbove ? `Yes (${s.spliceHeight})` : "No") },
  ];
  return (
    <div className="pad">
      <p className="muted">Base elevation: {fmt(geometry.baseElevation)} {u}</p>
      <DataTable rows={[...geometry.stories].reverse()} rowKey={(s) => s.name} columns={columns} />
    </div>
  );
}

function GridsTable({ geometry }: { geometry: GeometrySnapshot }) {
  const rows = geometry.gridSystems.flatMap((gs) => [
    ...gs.xLines.map((l) => ({ system: gs.name, axis: "X", line: l })),
    ...gs.yLines.map((l) => ({ system: gs.name, axis: "Y", line: l })),
  ]);
  const columns: Column<{ system: string; axis: string; line: GridLine }>[] = [
    { key: "system", header: "Grid system", value: (r) => r.system },
    { key: "axis", header: "Axis", value: (r) => r.axis },
    { key: "id", header: "Grid ID", value: (r) => r.line.id },
    { key: "ord", header: `Ordinate (${geometry.units.length})`, value: (r) => r.line.ordinate, numeric: true },
    { key: "visible", header: "Visible", value: (r) => (r.line.visible ? "Yes" : "No") },
    { key: "bubble", header: "Bubble", value: (r) => r.line.bubbleLocation },
  ];
  return (
    <div className="pad">
      <DataTable rows={rows} rowKey={(r) => `${r.system}:${r.axis}:${r.line.id}`} columns={columns} />
    </div>
  );
}

function JointsTable({ geometry }: { geometry: GeometrySnapshot }) {
  const u = geometry.units.length;
  const columns: Column<Joint>[] = [
    { key: "name", header: "Name", value: (j) => j.name },
    { key: "label", header: "Label", value: (j) => j.label },
    { key: "story", header: "Story", value: (j) => j.story },
    { key: "x", header: `X (${u})`, value: (j) => j.x, numeric: true },
    { key: "y", header: `Y (${u})`, value: (j) => j.y, numeric: true },
    { key: "z", header: `Z (${u})`, value: (j) => j.z, numeric: true },
    { key: "restraints", header: "Restraints", value: (j) => restraintText(j) },
  ];
  return (
    <div className="pad">
      <DataTable rows={geometry.joints} rowKey={(j) => j.name} columns={columns} />
    </div>
  );
}

function FramesTable({ geometry, onSelect, selected }: { geometry: GeometrySnapshot; onSelect: (f: FrameMember) => void; selected: Selection }) {
  const u = geometry.units.length;
  const columns: Column<FrameMember>[] = [
    { key: "name", header: "Name", value: (f) => f.name },
    { key: "label", header: "Label", value: (f) => f.label },
    { key: "story", header: "Story", value: (f) => f.story },
    { key: "type", header: "Type", value: (f) => f.type },
    { key: "section", header: "Section", value: (f) => f.section },
    { key: "j1", header: "Joint I", value: (f) => f.joint1 },
    { key: "j2", header: "Joint J", value: (f) => f.joint2 },
    { key: "len", header: `Length (${u})`, value: (f) => Math.hypot(f.end.x - f.start.x, f.end.y - f.start.y, f.end.z - f.start.z), numeric: true },
  ];
  return (
    <div className="pad">
      <DataTable rows={geometry.frames} rowKey={(f) => f.name} columns={columns} onSelect={onSelect} selectedKey={selected?.kind === "frame" ? selected.name : null} />
    </div>
  );
}

function AreasTable({ geometry, onSelect, selected }: { geometry: GeometrySnapshot; onSelect: (a: AreaObject) => void; selected: Selection }) {
  const columns: Column<AreaObject>[] = [
    { key: "name", header: "Name", value: (a) => a.name },
    { key: "label", header: "Label", value: (a) => a.label },
    { key: "story", header: "Story", value: (a) => a.story },
    { key: "type", header: "Type", value: (a) => a.type },
    { key: "section", header: "Section", value: (a) => a.section },
    { key: "joints", header: "Joints", value: (a) => a.joints.join(", ") },
  ];
  return (
    <div className="pad">
      <DataTable rows={geometry.areas} rowKey={(a) => a.name} columns={columns} onSelect={onSelect} selectedKey={selected?.kind === "area" ? selected.name : null} />
    </div>
  );
}

function restraintText(j: Joint): string {
  const labels = ["UX", "UY", "UZ", "RX", "RY", "RZ"];
  const fixed = labels.filter((_, i) => j.restraints[i]);
  return fixed.length === 0 ? "Free" : fixed.length === 6 ? "Fixed" : fixed.join(" ");
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
