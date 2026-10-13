/**
 * Conversion of ETABS present units to SI, for quantities and costs (which are always
 * reported in m, m², m³, kg and t regardless of the model's units).
 */
import type { UnitsInfo } from "./schemas.js";

const LENGTH_TO_M: Record<string, number> = {
  m: 1,
  cm: 0.01,
  mm: 0.001,
  ft: 0.3048,
  in: 0.0254,
};

const FORCE_TO_KN: Record<string, number> = {
  kN: 1,
  N: 0.001,
  kgf: 0.00980665,
  Ton: 9.80665, // metric tonne-force (ETABS "Ton" in SI unit sets)
  lb: 0.00444822162,
  kip: 4.44822162,
};

/** Metres per model length unit. Throws for an unknown unit so quantities are never silently wrong. */
export function lengthToMeters(units: Pick<UnitsInfo, "length" | "name">): number {
  const f = LENGTH_TO_M[units.length];
  if (f === undefined) throw new Error(`Unknown length unit "${units.length}" in units "${units.name}".`);
  return f;
}

/** kN per model force unit. */
export function forceToKiloNewtons(units: Pick<UnitsInfo, "force" | "name">): number {
  const f = FORCE_TO_KN[units.force];
  if (f === undefined) throw new Error(`Unknown force unit "${units.force}" in units "${units.name}".`);
  return f;
}

/** Converts a unit weight (force/length³ in model units) to a mass density in kg/m³. */
export function unitWeightToDensity(unitWeight: number, units: UnitsInfo): number {
  const kNperM3 = (unitWeight * forceToKiloNewtons(units)) / lengthToMeters(units) ** 3;
  return (kNperM3 * 1000) / 9.80665;
}
