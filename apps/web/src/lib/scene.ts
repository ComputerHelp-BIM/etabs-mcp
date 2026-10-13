/**
 * Pure geometry -> GPU buffer conversion for the 3D view. No React, no WebGL:
 * unit-tested in Node.
 *
 * Coordinates stay in ETABS global axes (Z up); the camera is configured for Z-up.
 */
import { ShapeUtils, Vector2, Vector3 } from "three";
import type { AreaObject, FrameMember, GeometrySnapshot, Joint } from "@etabs-bridge/client";

export const FRAME_COLORS: Record<FrameMember["type"], string> = {
  Column: "#3b6fd8",
  Beam: "#1f9e74",
  Brace: "#e07b2a",
  Null: "#9aa0a6",
  Other: "#9aa0a6",
};

export const AREA_COLORS: Record<AreaObject["type"], string> = {
  Floor: "#8fb3cc",
  Wall: "#c8a46a",
  Ramp: "#b48cc8",
  Null: "#b0b0b0",
  Other: "#b0b0b0",
};

export const HIGHLIGHT_COLOR = "#ff2d55";

export interface Bounds {
  min: Vector3;
  max: Vector3;
  center: Vector3;
  /** Length of the bounding-box diagonal; at least 1. */
  size: number;
}

export function computeBounds(g: Pick<GeometrySnapshot, "joints">): Bounds {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const j of g.joints) {
    min.min(new Vector3(j.x, j.y, j.z));
    max.max(new Vector3(j.x, j.y, j.z));
  }
  if (!Number.isFinite(min.x)) {
    min.set(0, 0, 0);
    max.set(1, 1, 1);
  }
  const center = min.clone().add(max).multiplyScalar(0.5);
  return { min, max, center, size: Math.max(1, max.distanceTo(min)) };
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export interface FrameBuffers {
  /** xyz per vertex, 2 vertices per frame. */
  positions: Float32Array;
  colors: Float32Array;
  /** frames[k] is drawn by vertices 2k and 2k+1. */
  frames: FrameMember[];
}

export function buildFrameBuffers(frames: FrameMember[], highlight?: string | null): FrameBuffers {
  const positions = new Float32Array(frames.length * 6);
  const colors = new Float32Array(frames.length * 6);
  frames.forEach((f, k) => {
    positions.set([f.start.x, f.start.y, f.start.z, f.end.x, f.end.y, f.end.z], k * 6);
    const rgb = hexToRgb(f.name === highlight ? HIGHLIGHT_COLOR : FRAME_COLORS[f.type]);
    colors.set([...rgb, ...rgb], k * 6);
  });
  return { positions, colors, frames };
}

export interface AreaBuffers {
  positions: Float32Array;
  colors: Float32Array;
  /** triangleOwner[t] = index into `areas` of the area that triangle t belongs to. */
  triangleOwner: Uint32Array;
  areas: AreaObject[];
  /** Areas that could not be triangulated (degenerate input); reported, not drawn. */
  skipped: string[];
}

/**
 * Triangulates each area polygon. Works for non-convex floors: the polygon is projected
 * onto its own best-fit plane (Newell normal) and ear-clipped there.
 */
export function buildAreaBuffers(areas: AreaObject[], highlight?: string | null): AreaBuffers {
  const pos: number[] = [];
  const col: number[] = [];
  const owner: number[] = [];
  const skipped: string[] = [];

  areas.forEach((area, index) => {
    const triangles = triangulatePolygon(area.points.map((p) => new Vector3(p.x, p.y, p.z)));
    if (!triangles) {
      skipped.push(area.name);
      return;
    }
    const rgb = hexToRgb(area.name === highlight ? HIGHLIGHT_COLOR : AREA_COLORS[area.type]);
    for (const tri of triangles) {
      for (const v of tri) {
        pos.push(v.x, v.y, v.z);
        col.push(...rgb);
      }
      owner.push(index);
    }
  });

  return {
    positions: new Float32Array(pos),
    colors: new Float32Array(col),
    triangleOwner: Uint32Array.from(owner),
    areas,
    skipped,
  };
}

/** Returns triangles (3 vertices each) or null for degenerate polygons. */
export function triangulatePolygon(points: Vector3[]): Vector3[][] | null {
  // Drop a closing point equal to the first.
  const pts = points.length > 3 && points[0]!.distanceTo(points[points.length - 1]!) < 1e-9 ? points.slice(0, -1) : points;
  if (pts.length < 3) return null;

  // Newell's method: robust normal for any planar polygon.
  const normal = new Vector3();
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    normal.x += (a.y - b.y) * (a.z + b.z);
    normal.y += (a.z - b.z) * (a.x + b.x);
    normal.z += (a.x - b.x) * (a.y + b.y);
  }
  if (normal.lengthSq() < 1e-18) return null;
  normal.normalize();

  // Orthonormal basis (u, v) in the polygon plane.
  const helper = Math.abs(normal.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
  const u = new Vector3().crossVectors(helper, normal).normalize();
  const v = new Vector3().crossVectors(normal, u);
  const flat = pts.map((p) => new Vector2(p.dot(u), p.dot(v)));

  const faces = ShapeUtils.triangulateShape(flat, []);
  if (faces.length === 0) return null;
  return faces.map((f) => f.map((i) => pts[i]!));
}

export function jointPositions(joints: Joint[]): Float32Array {
  const out = new Float32Array(joints.length * 3);
  joints.forEach((j, k) => out.set([j.x, j.y, j.z], k * 3));
  return out;
}

/** Stories (by name) visible for a "show up to story N" filter; "Base" is always visible. */
export function visibleStories(g: Pick<GeometrySnapshot, "stories">, upTo: string | null): Set<string> {
  const names = g.stories.map((s) => s.name);
  const cut = upTo === null ? names.length : names.indexOf(upTo) + 1;
  return new Set(["Base", ...names.slice(0, cut < 1 ? names.length : cut)]);
}
