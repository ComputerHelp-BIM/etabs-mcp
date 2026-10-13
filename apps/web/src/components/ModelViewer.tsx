import { useEffect, useMemo, useState } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, OrbitControls } from "@react-three/drei";
import { DoubleSide, Vector3 } from "three";
import type { GeometrySnapshot } from "@etabs-bridge/client";
import {
  AREA_COLORS,
  FRAME_COLORS,
  buildAreaBuffers,
  buildFrameBuffers,
  computeBounds,
  jointPositions,
  visibleStories,
  type Bounds,
} from "../lib/scene";

export type Selection = { kind: "frame" | "area" | "joint"; name: string } | null;

interface Props {
  geometry: GeometrySnapshot;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}

/** Interactive 3D view: frames as lines, areas as translucent faces, joints as points. Click to select. */
export function ModelViewer({ geometry, selection, onSelect }: Props) {
  const [upTo, setUpTo] = useState<string | null>(null);
  const [show, setShow] = useState({ frames: true, areas: true, joints: false });
  const bounds = useMemo(() => computeBounds(geometry), [geometry]);
  const stories = useMemo(() => visibleStories(geometry, upTo), [geometry, upTo]);

  const frames = useMemo(() => geometry.frames.filter((f) => stories.has(f.story)), [geometry, stories]);
  const areas = useMemo(() => geometry.areas.filter((a) => stories.has(a.story)), [geometry, stories]);
  const joints = useMemo(() => geometry.joints.filter((j) => stories.has(j.story)), [geometry, stories]);

  return (
    <div className="viewer">
      <div className="viewer-toolbar">
        <label>
          Show stories up to{" "}
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
        <Legend />
      </div>
      <div className="canvas-wrap">
        <Canvas
          camera={{ up: [0, 0, 1], fov: 45, near: bounds.size / 1000, far: bounds.size * 20 }}
          onPointerMissed={() => onSelect(null)}
          dpr={[1, 2]}
        >
          <ambientLight intensity={0.8} />
          <directionalLight position={[1, -2, 3]} intensity={0.6} />
          <CameraRig bounds={bounds} />
          {show.areas && <Areas areas={areas} selected={selection?.kind === "area" ? selection.name : null} onSelect={onSelect} />}
          {show.frames && <Frames frames={frames} selected={selection?.kind === "frame" ? selection.name : null} onSelect={onSelect} />}
          {show.joints && <Joints joints={joints} size={bounds.size / 300} onSelect={onSelect} />}
          <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
            <GizmoViewport labelColor="white" axisHeadScale={0.9} />
          </GizmoHelper>
        </Canvas>
      </div>
      <p className="muted hint">Drag to orbit, right-drag to pan, scroll to zoom, click an object for its properties.</p>
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

function Frames({ frames, selected, onSelect }: { frames: GeometrySnapshot["frames"]; selected: string | null; onSelect: (s: Selection) => void }) {
  const buffers = useMemo(() => buildFrameBuffers(frames, selected), [frames, selected]);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const frame = e.index !== undefined ? buffers.frames[Math.floor(e.index / 2)] : undefined;
    if (frame) onSelect({ kind: "frame", name: frame.name });
  };
  return (
    // key forces a fresh BufferGeometry when the vertex count changes.
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

function Areas({ areas, selected, onSelect }: { areas: GeometrySnapshot["areas"]; selected: string | null; onSelect: (s: Selection) => void }) {
  const buffers = useMemo(() => buildAreaBuffers(areas, selected), [areas, selected]);
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

function Legend() {
  const items: Array<[string, string, string]> = [
    ["Column", FRAME_COLORS.Column, "line"],
    ["Beam", FRAME_COLORS.Beam, "line"],
    ["Brace", FRAME_COLORS.Brace, "line"],
    ["Floor", AREA_COLORS.Floor, "area"],
    ["Wall", AREA_COLORS.Wall, "area"],
  ];
  return (
    <span className="legend" aria-label="Legend">
      {items.map(([label, color, kind]) => (
        <span key={label} className="legend-item">
          <span className={`swatch ${kind}`} style={{ background: color }} />
          {label}
        </span>
      ))}
    </span>
  );
}
