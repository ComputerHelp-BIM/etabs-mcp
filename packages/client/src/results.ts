/**
 * Helpers on top of analysis/design results: drift profiles, deformed geometry, and
 * reinforcement mass from ETABS concrete design for the BOQ.
 */
import type { ConcreteDesignRow, FrameSection, GeometrySnapshot, JointDisplacementRow, SectionsResult, StoryDriftRow } from "./schemas.js";
import { lengthToMeters } from "./units.js";

export const STEEL_DENSITY = 7850; // kg/m³

export interface DriftProfileRow {
  story: string;
  elevation: number;
  /** Max |drift| over the selected cases/steps, per direction ("X", "Y"). */
  drift: Record<string, number>;
  /** Case/step that governs each direction. */
  governing: Record<string, string>;
}

/** Envelope of story drifts per story and direction, ordered bottom to top. */
export function driftProfile(rows: readonly StoryDriftRow[], geometry: Pick<GeometrySnapshot, "stories">): DriftProfileRow[] {
  const elevation = new Map(geometry.stories.map((s) => [s.name, s.elevation]));
  const byStory = new Map<string, DriftProfileRow>();
  for (const r of rows) {
    let p = byStory.get(r.story);
    if (!p) byStory.set(r.story, (p = { story: r.story, elevation: elevation.get(r.story) ?? r.z, drift: {}, governing: {} }));
    const d = Math.abs(r.drift);
    if (d >= (p.drift[r.direction] ?? -1)) {
      p.drift[r.direction] = d;
      p.governing[r.direction] = r.stepType ? `${r.loadCase} (${r.stepType})` : r.loadCase;
    }
  }
  return [...byStory.values()].sort((a, b) => a.elevation - b.elevation);
}

/**
 * Geometry with joints moved by `scale` x displacement (U1, U2, U3 in global axes) for one case/step.
 * Frames and areas follow their joints, so the result renders in both the analytical and solid views.
 * Joints without a displacement row stay in place.
 */
export function deformedGeometry(
  geometry: GeometrySnapshot,
  rows: readonly JointDisplacementRow[],
  loadCase: string,
  scale: number,
  stepType?: string,
): GeometrySnapshot {
  const d = new Map<string, [number, number, number]>();
  for (const r of rows) {
    if (r.loadCase !== loadCase || (stepType !== undefined && r.stepType !== stepType)) continue;
    if (!d.has(r.joint)) d.set(r.joint, [r.u1 * scale, r.u2 * scale, r.u3 * scale]);
  }
  const move = (name: string, p: { x: number; y: number; z: number }) => {
    const u = d.get(name);
    return u ? { x: p.x + u[0], y: p.y + u[1], z: p.z + u[2] } : p;
  };
  return {
    ...geometry,
    joints: geometry.joints.map((j) => ({ ...j, ...move(j.name, j) })),
    frames: geometry.frames.map((f) => ({ ...f, start: move(f.joint1, f.start), end: move(f.joint2, f.end) })),
    areas: geometry.areas.map((a) => ({ ...a, points: a.points.map((p, i) => move(a.joints[i] ?? "", p)) })),
  };
}

/** Largest translation magnitude among the rows (model length units), for choosing a display scale. */
export function maxDisplacement(rows: readonly JointDisplacementRow[]): number {
  return rows.reduce((m, r) => Math.max(m, Math.hypot(r.u1, r.u2, r.u3)), 0);
}

export interface DesignRebar {
  /** kg of reinforcement per frame name. */
  kgByFrame: Map<string, number>;
  /** Frames whose shear steel could not be estimated (no section dimensions). */
  withoutShear: string[];
}

/**
 * Converts ETABS concrete design required areas into reinforcement mass per frame:
 *  - longitudinal: max over stations of (top + bottom) for beams, or the PMM area for columns, x frame length;
 *  - shear: mean required Av/s x length x (b + d) (one closed two-leg stirrup has ~2(b+d) of bar for Av = 2 legs).
 * Required (not provided) steel, no laps, anchorage or minimum detailing: expect provided steel to be higher.
 */
export function designRebarKg(rows: readonly ConcreteDesignRow[], geometry: GeometrySnapshot, sections: SectionsResult): DesignRebar {
  const m = lengthToMeters(geometry.units);
  const sm = lengthToMeters(sections.units);
  const length = new Map(geometry.frames.map((f) => [f.name, Math.hypot(f.end.x - f.start.x, f.end.y - f.start.y, f.end.z - f.start.z) * m]));
  const sectionOf = new Map(geometry.frames.map((f) => [f.name, f.section]));
  const sectionByName = new Map<string, FrameSection>(sections.frameSections.map((s) => [s.name, s]));

  const byFrame = new Map<string, ConcreteDesignRow[]>();
  for (const r of rows) byFrame.set(r.frame, [...(byFrame.get(r.frame) ?? []), r]);

  const kgByFrame = new Map<string, number>();
  const withoutShear: string[] = [];
  for (const [frame, stations] of byFrame) {
    const L = length.get(frame);
    if (L === undefined) continue;
    // Design areas are in the results' units, which are the model's present units (same as geometry).
    const longArea = Math.max(...stations.map((s) => (s.kind === "Beam" ? (s.topArea ?? 0) + (s.bottomArea ?? 0) : (s.longitudinalArea ?? 0)))) * m * m;
    let volume = longArea * L;
    const shear = stations.map((s) => s.shearAreaPerLength).filter((v): v is number => v !== null);
    const sec = sectionByName.get(sectionOf.get(frame) ?? "");
    if (shear.length && sec?.depth && sec.width) {
      const avs = (shear.reduce((a, b) => a + b, 0) / shear.length) * m; // length²/length -> m²/m
      volume += avs * L * (sec.depth + sec.width) * sm;
    } else if (shear.length) withoutShear.push(frame);
    kgByFrame.set(frame, volume * STEEL_DENSITY);
  }
  return { kgByFrame, withoutShear };
}
