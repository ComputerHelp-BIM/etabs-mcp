/**
 * Solid ("extruded") geometry for the 3D view: frames swept along their axis with their
 * real section profile, slabs and walls given their thickness. Pure functions, unit-tested.
 *
 * Conventions follow ETABS (CSI analysis reference):
 *  - Local 1 runs from joint I to joint J.
 *  - Local 2 points "up": the component of global +Z perpendicular to 1; for vertical members
 *    local 2 is global +X. Local 3 = 1 x 2. The frame rotation angle turns 2 and 3 about 1.
 *  - Section depth t3 is measured along local 2, width t2 along local 3.
 *  - The cardinal point (1-11) is the point of the section that lies on the joint line,
 *    e.g. 8 = top centre (typical for beams: top of beam flush with the slab).
 *  - Floors: the top face is at the area object (story level); walls are centred on it.
 *
 * Known simplifications (documented in the UI): end offsets/rigid zones, insertion offsets,
 * hollow interiors (boxes/pipes are drawn solid), openings in areas, and non-prismatic
 * sections are not modelled. Profiles are positioned by their bounding box, so cardinal points
 * of asymmetric shapes (angles, tees) are approximate.
 */
import { ShapeUtils, Vector2, Vector3 } from "three";
import type { AreaObject, AreaSection, FrameMember, FrameSection } from "@etabs-bridge/client";
import { triangulatePolygon } from "./scene";

export interface LocalAxes {
  x1: Vector3;
  x2: Vector3;
  x3: Vector3;
}

const UP = new Vector3(0, 0, 1);
const GLOBAL_X = new Vector3(1, 0, 0);

export function frameLocalAxes(start: Vector3, end: Vector3, angleDeg = 0): LocalAxes | null {
  const x1 = end.clone().sub(start);
  if (x1.lengthSq() < 1e-18) return null;
  x1.normalize();

  const vertical = Math.abs(x1.dot(UP)) > 1 - 1e-3;
  const x2 = vertical ? GLOBAL_X.clone() : UP.clone().sub(x1.clone().multiplyScalar(UP.dot(x1))).normalize();
  const x3 = new Vector3().crossVectors(x1, x2).normalize();

  if (angleDeg) {
    const a = (angleDeg * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const r2 = x2.clone().multiplyScalar(c).add(x3.clone().multiplyScalar(s));
    const r3 = x3.clone().multiplyScalar(c).sub(x2.clone().multiplyScalar(s));
    return { x1, x2: r2, x3: r3 };
  }
  return { x1, x2, x3 };
}

/** A section outline in (local 3, local 2) coordinates, counter-clockwise, bounding box centred on 0. */
export interface Profile {
  points: Vector2[];
  width: number; // extent along local 3
  depth: number; // extent along local 2
  /** True when dimensions were missing and a placeholder size was used. */
  approximate: boolean;
}

const CIRCLE_SEGMENTS = 16;

/**
 * Builds the outline for a frame section. `fallbackSize` is used when the section is unknown or
 * has no dimensions (e.g. Section Designer shapes), so the member is still visible.
 */
export function sectionProfile(section: FrameSection | undefined, fallbackSize: number): Profile {
  const d = section?.depth ?? null;
  const b = section?.width ?? null;
  if (!section || !d || d <= 0 || !b || b <= 0) {
    return rectangle(fallbackSize, fallbackSize, true);
  }

  const tf = positiveOr(section.flangeThickness, d * 0.1);
  const tw = positiveOr(section.webThickness, b * 0.1);

  switch (section.shape) {
    case "Circle":
    case "Pipe": {
      const r = d / 2;
      const points = Array.from({ length: CIRCLE_SEGMENTS }, (_, i) => {
        const t = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
        return new Vector2(r * Math.cos(t), r * Math.sin(t));
      });
      return { points, width: d, depth: d, approximate: false };
    }
    case "I": {
      const bb = positiveOr(section.bottomWidth, b);
      const tfb = positiveOr(section.bottomFlangeThickness, tf);
      const w = Math.max(b, bb);
      const h = d / 2;
      const pts: Array<[number, number]> = [
        [-bb / 2, -h], [bb / 2, -h], [bb / 2, -h + tfb], [tw / 2, -h + tfb],
        [tw / 2, h - tf], [b / 2, h - tf], [b / 2, h], [-b / 2, h],
        [-b / 2, h - tf], [-tw / 2, h - tf], [-tw / 2, -h + tfb], [-bb / 2, -h + tfb],
      ];
      return { points: pts.map(([x, y]) => new Vector2(x, y)), width: w, depth: d, approximate: false };
    }
    case "Tee": {
      const h = d / 2;
      const pts: Array<[number, number]> = [
        [-tw / 2, -h], [tw / 2, -h], [tw / 2, h - tf], [b / 2, h - tf], [b / 2, h], [-b / 2, h], [-b / 2, h - tf], [-tw / 2, h - tf],
      ];
      return { points: pts.map(([x, y]) => new Vector2(x, y)), width: b, depth: d, approximate: false };
    }
    case "Angle": {
      // Vertical leg on the -3 side, horizontal leg at the bottom.
      const h = d / 2;
      const w = b / 2;
      const pts: Array<[number, number]> = [[-w, -h], [w, -h], [w, -h + tf], [-w + tw, -h + tf], [-w + tw, h], [-w, h]];
      return { points: pts.map(([x, y]) => new Vector2(x, y)), width: b, depth: d, approximate: false };
    }
    case "Channel": {
      // Web on the -3 side, flanges pointing to +3.
      const h = d / 2;
      const w = b / 2;
      const pts: Array<[number, number]> = [
        [-w, -h], [w, -h], [w, -h + tf], [-w + tw, -h + tf], [-w + tw, h - tf], [w, h - tf], [w, h], [-w, h],
      ];
      return { points: pts.map(([x, y]) => new Vector2(x, y)), width: b, depth: d, approximate: false };
    }
    default:
      // Rectangular, Box (drawn solid), and anything else with known overall dimensions.
      return rectangle(b, d, !["Rectangular", "Box"].includes(section.shape));
  }
}

function rectangle(b: number, d: number, approximate: boolean): Profile {
  const pts: Array<[number, number]> = [[-b / 2, -d / 2], [b / 2, -d / 2], [b / 2, d / 2], [-b / 2, d / 2]];
  return { points: pts.map(([x, y]) => new Vector2(x, y)), width: b, depth: d, approximate };
}

function positiveOr(v: number | null | undefined, fallback: number): number {
  return v && v > 0 ? v : fallback;
}

/**
 * Offset (in local 3, local 2) of the cardinal point from the profile's bounding-box centre.
 * 1..9 = bottom/middle/top x left/centre/right; 10 centroid and 11 shear centre ~ centre.
 * "Left" is +3 (CSI views the section looking from J towards I).
 */
export function cardinalOffset(cardinalPoint: number, width: number, depth: number): Vector2 {
  if (!Number.isInteger(cardinalPoint) || cardinalPoint < 1 || cardinalPoint > 9) return new Vector2(0, 0);
  const col = (cardinalPoint - 1) % 3; // 0 left, 1 centre, 2 right
  const row = Math.floor((cardinalPoint - 1) / 3); // 0 bottom, 1 middle, 2 top
  return new Vector2([width / 2, 0, -width / 2][col]!, [-depth / 2, 0, depth / 2][row]!);
}

/** Accumulates non-indexed triangles with a per-triangle owner index. */
export class MeshBuilder {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly owner: number[] = [];

  triangle(a: Vector3, b: Vector3, c: Vector3, rgb: [number, number, number], ownerIndex: number): void {
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    this.col.push(...rgb, ...rgb, ...rgb);
    this.owner.push(ownerIndex);
  }

  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, rgb: [number, number, number], ownerIndex: number): void {
    this.triangle(a, b, c, rgb, ownerIndex);
    this.triangle(a, c, d, rgb, ownerIndex);
  }

  build(): SolidBuffers {
    return { positions: new Float32Array(this.pos), colors: new Float32Array(this.col), triangleOwner: Uint32Array.from(this.owner) };
  }
}

export interface SolidBuffers {
  positions: Float32Array;
  colors: Float32Array;
  /** triangleOwner[t] = index of the frame/area that triangle t belongs to. */
  triangleOwner: Uint32Array;
}

/** Sweeps `profile` from start to end (placed by the cardinal point) and adds it to `mesh`. */
export function extrudeFrame(
  mesh: MeshBuilder,
  frame: Pick<FrameMember, "start" | "end" | "angle" | "cardinalPoint">,
  profile: Profile,
  rgb: [number, number, number],
  ownerIndex: number,
): boolean {
  const start = new Vector3(frame.start.x, frame.start.y, frame.start.z);
  const end = new Vector3(frame.end.x, frame.end.y, frame.end.z);
  const axes = frameLocalAxes(start, end, frame.angle);
  if (!axes) return false;

  const ref = cardinalOffset(frame.cardinalPoint, profile.width, profile.depth);
  const place = (origin: Vector3, p: Vector2) =>
    origin
      .clone()
      .add(axes.x3.clone().multiplyScalar(p.x - ref.x))
      .add(axes.x2.clone().multiplyScalar(p.y - ref.y));

  const n = profile.points.length;
  const a = profile.points.map((p) => place(start, p));
  const b = profile.points.map((p) => place(end, p));

  // The profile is counter-clockwise in (local 3, local 2), i.e. it faces -1 (3 x 2 = -1).
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    mesh.quad(a[i]!, b[i]!, b[j]!, a[j]!, rgb, ownerIndex); // outward side faces
  }
  for (const [i, j, k] of ShapeUtils.triangulateShape(profile.points, [])) {
    mesh.triangle(a[i!]!, a[j!]!, a[k!]!, rgb, ownerIndex); // start cap faces -1
    mesh.triangle(b[k!]!, b[j!]!, b[i!]!, rgb, ownerIndex); // end cap faces +1
  }
  return true;
}

/**
 * Gives an area object its thickness. Floors hang below their plane (top at story level);
 * walls and everything else are centred on it.
 */
export function extrudeArea(
  mesh: MeshBuilder,
  area: Pick<AreaObject, "points" | "type">,
  thickness: number,
  rgb: [number, number, number],
  ownerIndex: number,
): boolean {
  const pts = area.points.map((p) => new Vector3(p.x, p.y, p.z));
  const triangles = triangulatePolygon(pts);
  if (!triangles || thickness <= 0) return false;

  // Plane normal from the first (non-degenerate) triangle of the triangulation.
  const t0 = triangles[0]!;
  const normal = new Vector3().subVectors(t0[1]!, t0[0]!).cross(new Vector3().subVectors(t0[2]!, t0[0]!)).normalize();
  if (normal.z < 0) normal.negate(); // "up" for floors, arbitrary but consistent for walls

  const isFloor = area.type === "Floor" || area.type === "Ramp";
  const topShift = isFloor ? 0 : thickness / 2;
  const top = (p: Vector3) => p.clone().add(normal.clone().multiplyScalar(topShift));
  const bottom = (p: Vector3) => p.clone().add(normal.clone().multiplyScalar(topShift - thickness));

  for (const [p, q, r] of triangles) {
    mesh.triangle(top(p!), top(q!), top(r!), rgb, ownerIndex);
    mesh.triangle(bottom(r!), bottom(q!), bottom(p!), rgb, ownerIndex);
  }
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    mesh.quad(bottom(p), bottom(q), top(q), top(p), rgb, ownerIndex);
  }
  return true;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export interface SolidModel {
  frames: SolidBuffers;
  areas: SolidBuffers;
  /** Names of frames drawn with a placeholder profile (unknown section or dimensions). */
  approximateFrames: string[];
  /** Names of areas drawn with a placeholder thickness. */
  approximateAreas: string[];
}

/** Builds solid meshes for all given frames and areas. */
export function buildSolidModel(
  frames: FrameMember[],
  areas: AreaObject[],
  frameSections: Map<string, FrameSection>,
  areaSections: Map<string, AreaSection>,
  colorOfFrame: (f: FrameMember) => string,
  colorOfArea: (a: AreaObject) => string,
  fallbackSize: number,
  highlight?: { kind: "frame" | "area"; name: string } | null,
): SolidModel {
  const frameMesh = new MeshBuilder();
  const approximateFrames: string[] = [];
  const profiles = new Map<string, Profile>();
  frames.forEach((f, i) => {
    let profile = profiles.get(f.section);
    if (!profile) {
      profile = sectionProfile(frameSections.get(f.section), fallbackSize);
      profiles.set(f.section, profile);
    }
    if (profile.approximate) approximateFrames.push(f.name);
    const color = highlight?.kind === "frame" && highlight.name === f.name ? HIGHLIGHT : colorOfFrame(f);
    extrudeFrame(frameMesh, f, profile, hexToRgb(color), i);
  });

  const areaMesh = new MeshBuilder();
  const approximateAreas: string[] = [];
  areas.forEach((a, i) => {
    const t = areaSections.get(a.section)?.thickness;
    const thickness = t && t > 0 ? t : fallbackSize / 2;
    if (!(t && t > 0)) approximateAreas.push(a.name);
    const color = highlight?.kind === "area" && highlight.name === a.name ? HIGHLIGHT : colorOfArea(a);
    extrudeArea(areaMesh, a, thickness, hexToRgb(color), i);
  });

  return { frames: frameMesh.build(), areas: areaMesh.build(), approximateFrames, approximateAreas };
}

const HIGHLIGHT = "#ff2d55";
