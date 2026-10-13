import { useEffect, useMemo, useState } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { Edges, GizmoHelper, GizmoViewport, OrbitControls } from "@react-three/drei";
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Vector3 } from "three";
import type { AreaObject, ElementStatus, FrameMember, GeometrySnapshot, SectionsResult } from "@etabs-bridge/client";
import { COLOR_MODES, COLOR_MODE_LABELS, createColorizer, type ColorMode, type LegendEntry } from "../lib/colors";
import { buildAreaBuffers, buildFrameBuffers, computeBounds, jointPositions, visibleStories, type Bounds } from "../lib/scene";
import { buildSolidModel, type SolidBuffers } from "../lib/solid";

export type Selection = { kind: "frame" | "area" | "joint"; name: string } | null;

export type DisplayMode = "solid" | "analytical";

interface Props {
  geometry: GeometrySnapshot;
  /** Null while loading or when the bridge predates 0.2.0; the solid view then uses placeholder sizes. */
  sections: SectionsResult | null;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  /**
   * 4D: construction status per element key ("frame:<name>", "area:<name>"). Not-started elements are
   * hidden, in-progress ones drawn in the in-progress colour; unscheduled elements are shown normally.
   */
  status?: ReadonlyMap<string, ElementStatus> | null;
  /** Initial display mode (default solid). */
  initialDisplay?: DisplayMode;
}

/** Status colour for elements under construction (4D). */
export const IN_PROGRESS_COLOR = "#f5a524";

/**
 * Interactive 3D view.
 *  - Solid: members extruded with their real section, slabs/walls with their thickness (concrete look).
 *  - Analytical: centre lines and mid-surfaces, as in the ETABS analytical model.
 * Colours are bound to model data (type, material, section, story). Click an object to select it.
 */
export function ModelViewer({ geometry, sections, selection, onSelect, status, initialDisplay = "solid" }: Props) {
  const [display, setDisplay] = useState<DisplayMode>(initialDisplay);
  const [colorMode, setColorMode] = useState<ColorMode>("material");
  const [upTo, setUpTo] = useState<string | null>(null);
  const [show, setShow] = useState({ frames: true, areas: true, joints: false });

  const bounds = useMemo(() => computeBounds(geometry), [geometry]);
  const stories = useMemo(() => visibleStories(geometry, upTo), [geometry, upTo]);
  const built = (key: string) => status?.get(key) !== "not-started";
  const frames = useMemo(
    () => geometry.frames.filter((f) => stories.has(f.story) && built(`frame:${f.name}`)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- built() depends only on status
    [geometry, stories, status],
  );
  const areas = useMemo(
    () => geometry.areas.filter((a) => stories.has(a.story) && built(`area:${a.name}`)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- built() depends only on status
    [geometry, stories, status],
  );
  const joints = useMemo(() => geometry.joints.filter((j) => stories.has(j.story)), [geometry, stories]);
  const colors = useMemo(() => {
    const base = createColorizer(colorMode, geometry, sections);
    if (!status) return base;
    const active = (key: string) => status.get(key) === "in-progress";
    return {
      frame: (f: FrameMember) => (active(`frame:${f.name}`) ? IN_PROGRESS_COLOR : base.frame(f)),
      area: (a: AreaObject) => (active(`area:${a.name}`) ? IN_PROGRESS_COLOR : base.area(a)),
      legend: [...base.legend, { label: "Under construction", color: IN_PROGRESS_COLOR }],
    };
  }, [colorMode, geometry, sections, status]);

  return (
    <div className="viewer">
      <div className="viewer-toolbar">
        <div className="segmented" role="radiogroup" aria-label="Display">
          {(["solid", "analytical"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={display === m} className={display === m ? "active" : undefined} onClick={() => setDisplay(m)}>
              {m === "solid" ? "Solid" : "Analytical"}
            </button>
          ))}
        </div>
        <label>
          Colour by{" "}
          <select value={colorMode} onChange={(e) => setColorMode(e.target.value as ColorMode)}>
            {COLOR_MODES.map((m) => (
              <option key={m} value={m}>
                {COLOR_MODE_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Stories up to{" "}
          <select value={upTo ?? ""} onChange={(e) => setUpTo(e.target.value || null)}>
            <option value="">All ({geometry.stories.length})</option>
            {geometry.stories.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} ({s.elevation})
              </option>
            ))}
          </select>
        </label>
        {(["frames", "areas", "joints"] as const).map((k) => (
          <label key={k} className="check">
            <input type="checkbox" checked={show[k]} onChange={(e) => setShow((s) => ({ ...s, [k]: e.target.checked }))} />
            {k[0]!.toUpperCase() + k.slice(1)}
          </label>
        ))}
      </div>
      <Legend entries={colors.legend} />
      <div className="canvas-wrap">
        <Canvas
          camera={{ up: [0, 0, 1], fov: 45, near: bounds.size / 1000, far: bounds.size * 20 }}
          onPointerMissed={() => onSelect(null)}
          dpr={[1, 2]}
        >
          <hemisphereLight args={["#ffffff", "#8a8f99", 0.9]} />
          <directionalLight position={[bounds.size, -bounds.size * 1.5, bounds.size * 2]} intensity={1.1} />
          <directionalLight position={[-bounds.size, bounds.size, bounds.size * 0.5]} intensity={0.35} />
          <CameraRig bounds={bounds} />
          {display === "solid" ? (
            <SolidScene
              frames={show.frames ? frames : []}
              areas={show.areas ? areas : []}
              sections={sections}
              colorFrame={colors.frame}
              colorArea={colors.area}
              fallbackSize={bounds.size / 150}
              selection={selection}
              onSelect={onSelect}
            />
          ) : (
            <>
              {show.areas && <AnalyticalAreas areas={areas} colorOf={colors.area} selected={selection?.kind === "area" ? selection.name : null} onSelect={onSelect} />}
              {show.frames && <AnalyticalFrames frames={frames} colorOf={colors.frame} selected={selection?.kind === "frame" ? selection.name : null} onSelect={onSelect} />}
            </>
          )}
          {show.joints && <Joints joints={joints} size={bounds.size / 300} onSelect={onSelect} />}
          <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
            <GizmoViewport labelColor="white" axisHeadScale={0.9} />
          </GizmoHelper>
        </Canvas>
      </div>
      <p className="muted hint">
        Drag to orbit, right-drag to pan, scroll to zoom, click an object for its properties.
        {display === "solid" && !sections && " Section data unavailable: members use placeholder sizes."}
      </p>
    </div>
  );
}

/** Frames the model once per geometry load, from a south-west isometric viewpoint. */
function CameraRig({ bounds }: { bounds: Bounds }) {
  const camera = useThree((s) => s.camera);
  // OrbitControls with makeDefault registers itself as the store's controls.
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3; update: () => void } | null;
  useEffect(() => {
    const d = bounds.size * 1.1;
    camera.position.copy(bounds.center.clone().add(new Vector3(-0.6 * d, -0.9 * d, 0.6 * d)));
    camera.lookAt(bounds.center);
    if (controls) {
      controls.target.copy(bounds.center);
      controls.update();
    }
  }, [bounds, camera, controls]);
  return <OrbitControls makeDefault enableDamping={false} />;
}

interface SolidSceneProps {
  frames: FrameMember[];
  areas: AreaObject[];
  sections: SectionsResult | null;
  colorFrame: (f: FrameMember) => string;
  colorArea: (a: AreaObject) => string;
  fallbackSize: number;
  selection: Selection;
  onSelect: (s: Selection) => void;
}

function SolidScene({ frames, areas, sections, colorFrame, colorArea, fallbackSize, selection, onSelect }: SolidSceneProps) {
  const frameSections = useMemo(() => new Map(sections?.frameSections.map((s) => [s.name, s]) ?? []), [sections]);
  const areaSections = useMemo(() => new Map(sections?.areaSections.map((s) => [s.name, s]) ?? []), [sections]);
  const highlight = selection && selection.kind !== "joint" ? { kind: selection.kind, name: selection.name } : null;
  const model = useMemo(
    () => buildSolidModel(frames, areas, frameSections, areaSections, colorFrame, colorArea, fallbackSize, highlight),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- highlight identity is derived from selection
    [frames, areas, frameSections, areaSections, colorFrame, colorArea, fallbackSize, highlight?.kind, highlight?.name],
  );

  return (
    <>
      <SolidMesh
        buffers={model.areas}
        onPick={(owner) => {
          const a = areas[owner];
          if (a) onSelect({ kind: "area", name: a.name });
        }}
      />
      <SolidMesh
        buffers={model.frames}
        onPick={(owner) => {
          const f = frames[owner];
          if (f) onSelect({ kind: "frame", name: f.name });
        }}
      />
    </>
  );
}

function SolidMesh({ buffers, onPick }: { buffers: SolidBuffers; onPick: (owner: number) => void }) {
  // Built imperatively so normals are computed after the attributes exist; disposed on change.
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(buffers.positions, 3));
    g.setAttribute("color", new Float32BufferAttribute(buffers.colors, 3));
    g.computeVertexNormals(); // non-indexed: flat per-face normals
    return g;
  }, [buffers]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  if (buffers.triangleOwner.length === 0) return null;
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const owner = e.faceIndex !== undefined && e.faceIndex !== null ? buffers.triangleOwner[e.faceIndex] : undefined;
    if (owner !== undefined) onPick(owner);
  };
  return (
    <mesh geometry={geometry} onClick={onClick}>
      <meshStandardMaterial vertexColors flatShading roughness={0.85} metalness={0.05} side={DoubleSide} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
      {/* Crease lines give the concrete members readable edges. */}
      <Edges threshold={30} color="#3a3f47" transparent opacity={0.35} />
    </mesh>
  );
}

function AnalyticalFrames({
  frames,
  colorOf,
  selected,
  onSelect,
}: {
  frames: FrameMember[];
  colorOf: (f: FrameMember) => string;
  selected: string | null;
  onSelect: (s: Selection) => void;
}) {
  const buffers = useMemo(() => buildFrameBuffers(frames, selected, colorOf), [frames, selected, colorOf]);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const frame = e.index !== undefined ? buffers.frames[Math.floor(e.index / 2)] : undefined;
    if (frame) onSelect({ kind: "frame", name: frame.name });
  };
  return (
    // renderOrder + transparent: drawn after the translucent areas so slabs do not wash out the lines.
    <lineSegments key={buffers.frames.length} onClick={onClick} renderOrder={2}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[buffers.positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[buffers.colors, 3]} />
      </bufferGeometry>
      <lineBasicMaterial vertexColors transparent opacity={1} />
    </lineSegments>
  );
}

function AnalyticalAreas({
  areas,
  colorOf,
  selected,
  onSelect,
}: {
  areas: AreaObject[];
  colorOf: (a: AreaObject) => string;
  selected: string | null;
  onSelect: (s: Selection) => void;
}) {
  const buffers = useMemo(() => buildAreaBuffers(areas, selected, colorOf), [areas, selected, colorOf]);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const owner = e.faceIndex !== undefined && e.faceIndex !== null ? buffers.triangleOwner[e.faceIndex] : undefined;
    const area = owner !== undefined ? buffers.areas[owner] : undefined;
    if (area) onSelect({ kind: "area", name: area.name });
  };
  return (
    <mesh key={buffers.positions.length} onClick={onClick}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[buffers.positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[buffers.colors, 3]} />
      </bufferGeometry>
      <meshBasicMaterial vertexColors side={DoubleSide} transparent opacity={0.35} depthWrite={false} />
    </mesh>
  );
}

function Joints({ joints, size, onSelect }: { joints: GeometrySnapshot["joints"]; size: number; onSelect: (s: Selection) => void }) {
  const positions = useMemo(() => jointPositions(joints), [joints]);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const joint = e.index !== undefined ? joints[e.index] : undefined;
    if (joint) onSelect({ kind: "joint", name: joint.name });
  };
  return (
    <points key={joints.length} onClick={onClick}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={Math.max(size, 0.05)} color="#444" sizeAttenuation />
    </points>
  );
}

const MAX_LEGEND = 24;

function Legend({ entries }: { entries: LegendEntry[] }) {
  const shown = entries.slice(0, MAX_LEGEND);
  return (
    <div className="legend" aria-label="Legend">
      {shown.map((e) => (
        <span key={e.label} className="legend-item">
          <span className="swatch area" style={{ background: e.color }} />
          {e.label}
        </span>
      ))}
      {entries.length > MAX_LEGEND && <span className="muted">+{entries.length - MAX_LEGEND} more</span>}
    </div>
  );
}
