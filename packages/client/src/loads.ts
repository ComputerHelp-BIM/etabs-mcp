/**
 * Load takedown: total applied gravity load per load pattern, from the assigned loads and geometry.
 * A quick independent check of the model (compare with the base reactions, 0.6.0).
 *
 * Gravity components: direction 10 (gravity) and 11 (projected gravity) are positive downward;
 * direction 6 (global Z) is positive upward, so its negated value counts. Loads in other
 * directions are reported as "lateral or local" and not summed. Self-weight is not included
 * (it is a pattern multiplier, not an assigned load); see `selfWeightMultiplier`.
 */
import type { GeometrySnapshot, LoadsResult } from "./schemas.js";
import { polygonArea } from "./quantities.js";

export interface PatternTakedown {
  pattern: string;
  type: string;
  selfWeightMultiplier: number | null;
  /** Total downward force from area loads (model force units). */
  area: number;
  /** From frame distributed loads. */
  frameDistributed: number;
  /** From frame point loads. */
  framePoint: number;
  /** From joint loads (-F3 in global axes). */
  joint: number;
  total: number;
  /** Number of assigned loads not counted (lateral, local-axis, moment or non-global joint loads). */
  notCounted: number;
}

function gravityFactor(direction: number): number | null {
  if (direction === 10 || direction === 11) return 1;
  if (direction === 6) return -1;
  return null;
}

/** Gravity-load takedown per pattern, in the model's force unit. Objects not found in the geometry are skipped. */
export function loadTakedown(loads: LoadsResult, geometry: GeometrySnapshot): PatternTakedown[] {
  const areaOf = new Map(geometry.areas.map((a) => [a.name, polygonArea(a.points)]));
  const lengthOf = new Map(geometry.frames.map((f) => [f.name, Math.hypot(f.end.x - f.start.x, f.end.y - f.start.y, f.end.z - f.start.z)]));
  const rows = new Map<string, PatternTakedown>();
  const row = (pattern: string) => {
    let r = rows.get(pattern);
    if (!r) {
      const p = loads.patterns.find((x) => x.name === pattern);
      r = { pattern, type: p?.type ?? "", selfWeightMultiplier: p?.selfWeightMultiplier ?? null, area: 0, frameDistributed: 0, framePoint: 0, joint: 0, total: 0, notCounted: 0 };
      rows.set(pattern, r);
    }
    return r;
  };
  for (const p of loads.patterns) row(p.name);

  for (const l of loads.areaUniform) {
    const f = gravityFactor(l.direction);
    const a = areaOf.get(l.area);
    if (f === null || a === undefined) row(l.pattern).notCounted++;
    else row(l.pattern).area += f * l.value * a;
  }
  for (const l of loads.frameDistributed) {
    const f = gravityFactor(l.direction);
    const length = lengthOf.get(l.frame);
    if (f === null || l.loadType !== "Force" || length === undefined) {
      row(l.pattern).notCounted++;
      continue;
    }
    // Trapezoid between the two distances; relative distances are the fallback when absolute ones are 0.
    const span = l.distanceEnd - l.distanceStart || (l.relativeEnd - l.relativeStart) * length;
    row(l.pattern).frameDistributed += f * ((l.valueStart + l.valueEnd) / 2) * span;
  }
  for (const l of loads.framePoint) {
    const f = gravityFactor(l.direction);
    if (f === null || l.loadType !== "Force") row(l.pattern).notCounted++;
    else row(l.pattern).framePoint += f * l.value;
  }
  for (const l of loads.jointLoads) {
    if (l.cSys.toLowerCase() !== "global") {
      row(l.pattern).notCounted++;
      continue;
    }
    row(l.pattern).joint += -l.f3;
    if (l.f1 || l.f2 || l.m1 || l.m2 || l.m3) row(l.pattern).notCounted++;
  }
  for (const r of rows.values()) r.total = r.area + r.frameDistributed + r.framePoint + r.joint;
  return [...rows.values()];
}

/** "1.5 × Dead + 1.5 × Live" style description of a combination. */
export function describeCombination(items: LoadsResult["combinations"][number]["items"]): string {
  return items.map((i) => `${Number(i.factor.toFixed(3))} × ${i.name}`).join(" + ");
}
