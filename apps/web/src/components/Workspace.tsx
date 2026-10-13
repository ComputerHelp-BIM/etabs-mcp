import { lazy, Suspense, useMemo, useState } from "react";
import {
  BridgeError,
  computeElementQuantities,
  designRebarKg,
  summarizeGeometry,
  type AreaObject,
  type AreaSection,
  type FrameSection,
  type Material,
  type SectionsResult,
  type BridgeClient,
  type FrameMember,
  type GeometrySnapshot,
  type GridLine,
  type Joint,
  type Story,
} from "@etabs-bridge/client";
import { useAsync } from "../state/useAsync";
import { useProject } from "../state/useProject";
import { ApiConsole } from "./ApiConsole";
import { BoqView } from "./BoqView";
import { FourDView } from "./FourDView";
import { LoadsView } from "./LoadsView";
import { ResultsView } from "./ResultsView";
import { explain } from "./ConnectPanel";
import { DataTable, type Column } from "./DataTable";
import type { Selection } from "./ModelViewer";
import { TablesBrowser } from "./TablesBrowser";

// three.js is the bulk of the bundle; load it only when the 3D tab is shown.
const ModelViewer = lazy(() => import("./ModelViewer").then((m) => ({ default: m.ModelViewer })));

const TABS = [
  "3D view",
  "Summary",
  "Stories",
  "Grids",
  "Joints",
  "Frames",
  "Areas",
  "Sections",
  "Materials",
  "Loads",
  "Results",
  "BOQ & Cost",
  "4D Simulation",
  "Database tables",
  "API console",
] as const;
type Tab = (typeof TABS)[number];

interface Props {
  client: BridgeClient;
  onDisconnect: () => void;
}

export function Workspace({ client, onDisconnect }: Props) {
  const geometry = useAsync(() => client.geometry(), [client]);
  // Sections arrived in bridge 0.2.0: an older plugin answers 404, which is not an error for the app.
  const sectionsState = useAsync(
    () => client.sections().catch((err: unknown) => (err instanceof BridgeError && err.code === "NOT_FOUND" ? null : Promise.reject(err))),
    [client],
  );
  const sections = sectionsState.data ?? null;
  // Loads arrived in bridge 0.5.0; loaded only when the tab is first opened (assigned loads can be large).
  const [wantLoads, setWantLoads] = useState(false);
  const loadsState = useAsync(
    wantLoads
      ? () => client.loads().catch((err: unknown) => (err instanceof BridgeError && err.code === "NOT_FOUND" ? null : Promise.reject(err)))
      : null,
    [client, wantLoads],
  );
  const modelKey = geometry.data ? geometry.data.model.filePath || geometry.data.model.fileName || "unsaved" : "unsaved";
  const [project, updateProject, replaceProject] = useProject(modelKey);
  // Concrete design results, only when the BOQ should use them (0.6.0).
  const design = useAsync(project.useDesignRebar ? () => client.concreteDesign() : null, [client, project.useDesignRebar]);
  const elements = useMemo(() => {
    if (!geometry.data || !sections) return null;
    try {
      const designKg = project.useDesignRebar && design.data ? designRebarKg(design.data.rows, geometry.data, sections).kgByFrame : undefined;
      return computeElementQuantities(geometry.data, sections, { settings: project.quantitySettings, designRebarKg: designKg });
    } catch {
      return null; // e.g. unknown unit system; the BOQ tab explains
    }
  }, [geometry.data, sections, project.quantitySettings, project.useDesignRebar, design.data]);
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
          <button
            type="button"
            onClick={() => {
              geometry.reload();
              sectionsState.reload();
              if (wantLoads) loadsState.reload();
            }}
            disabled={geometry.status === "loading"}
          >
            {geometry.status === "loading" ? "Reading model…" : "Refresh"}
          </button>
          <button type="button" onClick={onDisconnect}>
            Disconnect
          </button>
        </div>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={t === tab}
            className={t === tab ? "active" : undefined}
            onClick={() => {
              setTab(t);
              if (t === "Loads" || t === "Results") setWantLoads(true);
            }}
          >
            {t}
          </button>
        ))}
      </nav>

      {geometry.status === "error" && (
        <p className="error banner" role="alert">
          {explain(geometry.error)}
        </p>
      )}
      {sectionsState.status === "error" && (
        <p className="error banner" role="alert">
          Sections and materials could not be read: {explain(sectionsState.error)}
        </p>
      )}
      {sections && sections.warnings.length > 0 && (
        <details className="warn banner">
          <summary>{sections.warnings.length} section/material value(s) could not be read from ETABS (shown as "—")</summary>
          <ul>
            {sections.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
      {!g && geometry.status === "loading" && <p className="muted pad">Reading geometry from ETABS…</p>}

      <main className="content">
        {g && tab === "3D view" && (
          <div className="viewer-layout">
            <Suspense fallback={<p className="muted pad">Loading 3D engine…</p>}>
              <ModelViewer geometry={g} sections={sections} selection={selection} onSelect={setSelection} />
            </Suspense>
            <PropertiesPanel geometry={g} sections={sections} selection={selection} />
          </div>
        )}
        {g && tab === "Summary" && <SummaryView geometry={g} />}
        {g && tab === "Stories" && <StoriesTable geometry={g} />}
        {g && tab === "Grids" && <GridsTable geometry={g} />}
        {g && tab === "Joints" && <JointsTable geometry={g} />}
        {g && tab === "Frames" && <FramesTable geometry={g} onSelect={(f) => setSelection({ kind: "frame", name: f.name })} selected={selection} />}
        {g && tab === "Areas" && <AreasTable geometry={g} onSelect={(a) => setSelection({ kind: "area", name: a.name })} selected={selection} />}
        {tab === "Sections" && <SectionsView sections={sections} loading={sectionsState.status === "loading"} geometry={g} />}
        {tab === "Materials" && <MaterialsView sections={sections} loading={sectionsState.status === "loading"} />}
        {g && tab === "Loads" &&
          (loadsState.status === "error" ? (
            <p className="error banner">{explain(loadsState.error)}</p>
          ) : (
            <LoadsView loads={loadsState.data ?? null} loading={loadsState.status !== "success"} geometry={g} />
          ))}
        {g && tab === "Results" && (
          <ResultsView client={client} geometry={g} sections={sections} loads={loadsState.data ?? null} project={project} update={updateProject} />
        )}
        {g && tab === "BOQ & Cost" &&
          (elements ? (
            <BoqView
              modelName={g.model.fileName}
              storyOrder={["Base", ...g.stories.map((st) => st.name)]}
              elements={elements}
              project={project}
              update={updateProject}
              replace={replaceProject}
            />
          ) : (
            <p className="muted pad">
              {sectionsState.status === "loading" ? "Reading sections…" : "Quantities need section data (ETABS Bridge 0.2.0 or newer) and a recognised unit system."}
            </p>
          ))}
        {g && tab === "4D Simulation" && <FourDView geometry={g} sections={sections} elements={elements} project={project} update={updateProject} />}
        {tab === "Database tables" && <TablesBrowser client={client} />}
        {tab === "API console" && <ApiConsole client={client} />}
      </main>
    </div>
  );
}

function PropertiesPanel({ geometry, sections, selection }: { geometry: GeometrySnapshot; sections: SectionsResult | null; selection: Selection }) {
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
        ...frameSectionRows(sections, f.section, geometry.units.length),
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
        ...areaSectionRows(sections, a.section, geometry.units.length),
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
  }, [geometry, sections, selection]);

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

function frameSectionRows(sections: SectionsResult | null, name: string, u: string): Array<[string, string]> {
  const s = sections?.frameSections.find((x) => x.name === name);
  if (!s) return [];
  const m = sections?.materials.find((x) => x.name === s.material);
  return [
    ["Shape", s.shape],
    ["Size (b × d)", s.width && s.depth ? `${fmt(s.width)} × ${fmt(s.depth)} ${u}` : "—"],
    ["Material", m ? `${m.name} (${m.type})` : s.material || "—"],
    ...(s.properties ? ([["Area", `${fmt(s.properties.area)} ${u}²`]] as Array<[string, string]>) : []),
  ];
}

function areaSectionRows(sections: SectionsResult | null, name: string, u: string): Array<[string, string]> {
  const s = sections?.areaSections.find((x) => x.name === name);
  if (!s) return [];
  const m = sections?.materials.find((x) => x.name === s.material);
  return [
    ["Kind", s.subType ? `${s.kind} (${s.subType})` : s.kind],
    ["Thickness", s.thickness ? `${fmt(s.thickness)} ${u}` : "—"],
    ["Material", m ? `${m.name} (${m.type})` : s.material || "—"],
  ];
}

const dash = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n);

function SectionsView({ sections, loading, geometry }: { sections: SectionsResult | null; loading: boolean; geometry: GeometrySnapshot | undefined }) {
  const usage = useMemo(() => {
    const count = new Map<string, number>();
    for (const o of [...(geometry?.frames ?? []), ...(geometry?.areas ?? [])]) count.set(o.section, (count.get(o.section) ?? 0) + 1);
    return count;
  }, [geometry]);
  if (!sections) return <p className="muted pad">{loading ? "Reading sections from ETABS…" : "Sections need ETABS Bridge 0.2.0 or newer in ETABS."}</p>;
  const u = sections.units.length;
  const frameColumns: Column<FrameSection>[] = [
    { key: "name", header: "Name", value: (s) => s.name, render: (s) => <><span className="dot" style={{ background: s.color }} />{s.name}</> },
    { key: "shape", header: "Shape", value: (s) => s.shape },
    { key: "material", header: "Material", value: (s) => s.material },
    { key: "d", header: `Depth (${u})`, value: (s) => dash(s.depth), numeric: true },
    { key: "b", header: `Width (${u})`, value: (s) => dash(s.width), numeric: true },
    { key: "tf", header: `tf (${u})`, value: (s) => dash(s.flangeThickness), numeric: true },
    { key: "tw", header: `tw (${u})`, value: (s) => dash(s.webThickness), numeric: true },
    { key: "area", header: `Area (${u}²)`, value: (s) => dash(s.properties?.area), numeric: true },
    { key: "i33", header: `I33 (${u}⁴)`, value: (s) => (s.properties ? s.properties.i33.toExponential(3) : "—"), numeric: true },
    { key: "used", header: "Objects", value: (s) => usage.get(s.name) ?? 0, numeric: true },
  ];
  const areaColumns: Column<AreaSection>[] = [
    { key: "name", header: "Name", value: (s) => s.name, render: (s) => <><span className="dot" style={{ background: s.color }} />{s.name}</> },
    { key: "kind", header: "Kind", value: (s) => s.kind },
    { key: "sub", header: "Type", value: (s) => s.subType || "—" },
    { key: "shell", header: "Shell", value: (s) => s.shellType || "—" },
    { key: "material", header: "Material", value: (s) => s.material },
    { key: "t", header: `Thickness (${u})`, value: (s) => dash(s.thickness), numeric: true },
    { key: "used", header: "Objects", value: (s) => usage.get(s.name) ?? 0, numeric: true },
  ];
  return (
    <div className="pad">
      <h2>Frame sections</h2>
      <DataTable rows={[...sections.frameSections]} rowKey={(s) => s.name} columns={frameColumns} />
      <h2>Area sections</h2>
      <DataTable rows={[...sections.areaSections]} rowKey={(s) => s.name} columns={areaColumns} />
    </div>
  );
}

function MaterialsView({ sections, loading }: { sections: SectionsResult | null; loading: boolean }) {
  if (!sections) return <p className="muted pad">{loading ? "Reading materials from ETABS…" : "Materials need ETABS Bridge 0.2.0 or newer in ETABS."}</p>;
  const { force: f, length: u } = sections.units;
  const stress = `${f}/${u}²`;
  const columns: Column<Material>[] = [
    { key: "name", header: "Name", value: (m) => m.name, render: (m) => <><span className="dot" style={{ background: m.color }} />{m.name}</> },
    { key: "type", header: "Type", value: (m) => m.type },
    { key: "e", header: `E (${stress})`, value: (m) => (m.e === null ? "—" : m.e.toExponential(3)), numeric: true },
    { key: "nu", header: "Poisson", value: (m) => dash(m.poisson), numeric: true },
    { key: "w", header: `Unit weight (${f}/${u}³)`, value: (m) => dash(m.unitWeight), numeric: true },
    { key: "fc", header: `f'c (${stress})`, value: (m) => dash(m.fc), numeric: true },
    { key: "fy", header: `Fy (${stress})`, value: (m) => dash(m.fy), numeric: true },
    { key: "fu", header: `Fu (${stress})`, value: (m) => dash(m.fu), numeric: true },
  ];
  return (
    <div className="pad">
      <DataTable rows={[...sections.materials]} rowKey={(m) => m.name} columns={columns} />
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
