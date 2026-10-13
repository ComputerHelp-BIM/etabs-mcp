/**
 * Synthetic analysis and design results for the mock bridge. NOT structural analysis: values are
 * generated to be internally consistent (gravity base reactions = self-weight + applied loads,
 * lateral base shear = applied lateral loads, combinations = factored sums, drifts from one
 * displacement field) so the web app, MCP server and tests behave realistically.
 */
import {
  computeElementQuantities,
  loadTakedown,
  type BaseReactionRow,
  type ConcreteDesignRow,
  type FrameForceRow,
  type JointDisplacementRow,
  type JointReactionRow,
  type StoryDriftRow,
} from "@etabs-bridge/client";
import type { SampleModel } from "./sampleModel.js";

export const MOCK_RESULTS_WARNING = "Mock bridge: synthetic results for development, not structural analysis.";

/** Per-case scalar effects; everything else is derived from these. */
interface CaseEffect {
  fx: number; // base shear X (reaction, opposes the load)
  fz: number; // vertical reaction (positive up)
  lateral: number; // roof drift factor for the X displacement field
  vertical: number; // vertical deflection factor
  beamLoad: number; // kN/m on beams for frame forces
}

export interface SampleResults {
  caseNames: string[];
  comboNames: string[];
  /** Expands cases/combos into (name, stepType, effect) steps; unknown names are reported. */
  steps(cases: string[], combos: string[]): { steps: Array<{ name: string; stepType: string; e: CaseEffect }>; unknown: string[] };
  baseReactions(cases: string[], combos: string[]): { rows: BaseReactionRow[]; unknown: string[] };
  storyDrifts(cases: string[], combos: string[]): { rows: StoryDriftRow[]; unknown: string[] };
  jointReactions(cases: string[], combos: string[], joint?: string): { rows: JointReactionRow[]; unknown: string[] };
  jointDisplacements(cases: string[], combos: string[], joint?: string): { rows: JointDisplacementRow[]; unknown: string[] };
  frameForces(cases: string[], combos: string[], frame?: string): { rows: FrameForceRow[]; unknown: string[] };
  concreteDesign(): ConcreteDesignRow[];
}

const ZERO: CaseEffect = { fx: 0, fz: 0, lateral: 0, vertical: 0, beamLoad: 0 };
const add = (a: CaseEffect, b: CaseEffect, f: number): CaseEffect => ({
  fx: a.fx + f * b.fx,
  fz: a.fz + f * b.fz,
  lateral: a.lateral + f * b.lateral,
  vertical: a.vertical + f * b.vertical,
  beamLoad: a.beamLoad + f * b.beamLoad,
});

export function createSampleResults(model: SampleModel): SampleResults {
  const { geometry, sections, loads } = model;
  const elements = computeElementQuantities(geometry, sections);
  const selfWeight = elements.reduce((s, e) => s + e.concreteVolume * 25 + (e.steel / 1000) * 9.80665, 0);
  const takedown = new Map(loadTakedown(loads, geometry).map((t) => [t.pattern, t.total]));
  const lateral = new Map<string, number>();
  for (const j of loads.jointLoads) lateral.set(j.pattern, (lateral.get(j.pattern) ?? 0) + j.f1);
  const height = Math.max(...geometry.stories.map((s) => s.elevation));
  const beamLength = geometry.frames.filter((f) => f.type === "Beam").reduce((s, f) => s + Math.hypot(f.end.x - f.start.x, f.end.y - f.start.y), 0);

  // Calibrate the displacement field: the largest lateral pattern gives a roof drift of ~h/600.
  const maxLateral = Math.max(1e-9, ...[...lateral.values()].map(Math.abs));
  const caseEffect = new Map<string, CaseEffect>();
  for (const c of loads.cases) {
    if (c.type === "Modal") continue;
    const fz = (c.name === "Dead" ? selfWeight : 0) + (takedown.get(c.name) ?? 0);
    const fx = -(lateral.get(c.name) ?? 0);
    caseEffect.set(c.name, {
      fx,
      fz,
      lateral: (lateral.get(c.name) ?? 0) / maxLateral / 600,
      vertical: fz / 5e6,
      beamLoad: beamLength > 0 ? fz / beamLength : 0,
    });
  }

  const combo = new Map(loads.combinations.map((c) => [c.name, c]));
  /** Linear effect of a case or linear-additive combination; envelopes return their components. */
  const effectsOf = (name: string, depth = 0): Array<{ stepType: string; e: CaseEffect }> | null => {
    const c = caseEffect.get(name);
    if (c) return [{ stepType: "", e: c }];
    const k = combo.get(name);
    if (!k || depth > 5) return null;
    if (k.type === "Envelope") {
      const parts = k.items.flatMap((i) => effectsOf(i.name, depth + 1)?.map((x) => x.e) ?? []);
      if (!parts.length) return null;
      const pick = (sign: 1 | -1) =>
        parts.reduce((best, p) => ({
          fx: sign * Math.max(sign * best.fx, sign * p.fx),
          fz: sign * Math.max(sign * best.fz, sign * p.fz),
          lateral: sign * Math.max(sign * best.lateral, sign * p.lateral),
          vertical: sign * Math.max(sign * best.vertical, sign * p.vertical),
          beamLoad: sign * Math.max(sign * best.beamLoad, sign * p.beamLoad),
        }));
      return [
        { stepType: "Max", e: pick(1) },
        { stepType: "Min", e: pick(-1) },
      ];
    }
    let total = ZERO;
    for (const i of k.items) {
      const parts = effectsOf(i.name, depth + 1);
      if (!parts) return null;
      total = add(total, parts[0]!.e, i.factor);
    }
    return [{ stepType: "", e: total }];
  };

  const steps = (cases: string[], combos: string[]) => {
    const out: Array<{ name: string; stepType: string; e: CaseEffect }> = [];
    const unknown: string[] = [];
    for (const name of [...cases, ...combos]) {
      const effects = effectsOf(name);
      if (!effects) unknown.push(name);
      else for (const x of effects) out.push({ name, ...x });
    }
    return { steps: out, unknown };
  };

  const supports = geometry.joints.filter((j) => j.restraints.some(Boolean));
  const ux = (z: number, e: CaseEffect) => e.lateral * height * (z / height) ** 1.2;
  const uz = (j: { x: number; y: number; z: number }, e: CaseEffect) => (j.z === 0 ? 0 : -e.vertical * (1 + (j.z / height) * 2));

  return {
    caseNames: loads.cases.map((c) => c.name),
    comboNames: loads.combinations.map((c) => c.name),
    steps,

    baseReactions(cases, combos) {
      const { steps: s, unknown } = steps(cases, combos);
      const rows = s.map(({ name, stepType, e }) => ({ loadCase: name, stepType, stepNum: 0, fx: e.fx, fy: 0, fz: e.fz, mx: 0, my: -e.fx * height * 0.65, mz: 0 }));
      return { rows, unknown };
    },

    storyDrifts(cases, combos) {
      const { steps: s, unknown } = steps(cases, combos);
      const rows: StoryDriftRow[] = [];
      for (const { name, stepType, e } of s) {
        let below = 0;
        for (const st of geometry.stories) {
          const drift = Math.abs(ux(st.elevation, e) - ux(below, e)) / st.height;
          rows.push({ story: st.name, loadCase: name, stepType, stepNum: 0, direction: "X", drift, label: "1", x: 0, y: 0, z: st.elevation });
          rows.push({ story: st.name, loadCase: name, stepType, stepNum: 0, direction: "Y", drift: drift * 0.08 + e.vertical * 0.01, label: "1", x: 0, y: 0, z: st.elevation });
          below = st.elevation;
        }
      }
      return { rows: rows.reverse(), unknown }; // ETABS lists top story first
    },

    jointReactions(cases, combos, joint) {
      const { steps: s, unknown } = steps(cases, combos);
      const targets = joint ? supports.filter((j) => j.name === joint) : supports;
      const n = supports.length || 1;
      const rows = s.flatMap(({ name, stepType, e }) =>
        targets.map((j) => ({ joint: j.name, loadCase: name, stepType, stepNum: 0, f1: e.fx / n, f2: 0, f3: e.fz / n, m1: 0, m2: (-e.fx / n) * 0.4, m3: 0 })),
      );
      return { rows, unknown };
    },

    jointDisplacements(cases, combos, joint) {
      const { steps: s, unknown } = steps(cases, combos);
      const targets = joint ? geometry.joints.filter((j) => j.name === joint) : geometry.joints;
      const rows = s.flatMap(({ name, stepType, e }) =>
        targets.map((j) => ({ joint: j.name, loadCase: name, stepType, stepNum: 0, u1: ux(j.z, e), u2: 0, u3: uz(j, e), r1: 0, r2: 0, r3: 0 })),
      );
      return { rows, unknown };
    },

    frameForces(cases, combos, frame) {
      const { steps: s, unknown } = steps(cases, combos);
      const frames = frame ? geometry.frames.filter((f) => f.name === frame) : geometry.frames;
      const nCol = Math.max(1, geometry.frames.filter((f) => f.type === "Column" && f.story === geometry.stories[0]?.name).length);
      const rows: FrameForceRow[] = [];
      for (const { name, stepType, e } of s) {
        for (const f of frames) {
          const L = Math.hypot(f.end.x - f.start.x, f.end.y - f.start.y, f.end.z - f.start.z);
          for (const t of [0, 0.5, 1]) {
            const x = t * L;
            const w = e.beamLoad;
            const isBeam = f.type === "Beam";
            const above = (height - Math.min(f.start.z, f.end.z)) / height;
            rows.push({
              frame: f.name,
              station: x,
              loadCase: name,
              stepType,
              stepNum: 0,
              p: isBeam ? 0 : (-e.fz / nCol) * above,
              v2: isBeam ? w * (L / 2 - x) : (e.fx / nCol) * above,
              v3: 0,
              t: 0,
              m2: 0,
              m3: isBeam ? w * ((-L * L) / 12 + (L * x) / 2 - (x * x) / 2) : (e.fx / nCol) * above * (x - L / 2),
            });
          }
        }
      }
      return { rows, unknown };
    },

    concreteDesign() {
      const sec = new Map(sections.frameSections.map((x) => [x.name, x]));
      const rows: ConcreteDesignRow[] = [];
      for (const f of geometry.frames) {
        const s = sec.get(f.section);
        if (!s?.depth || !s.width || s.material !== "C35") continue;
        const L = Math.hypot(f.end.x - f.start.x, f.end.y - f.start.y, f.end.z - f.start.z);
        const area = s.depth * s.width;
        for (const t of [0, 0.5, 1]) {
          const support = t !== 0.5;
          rows.push(
            f.type === "Beam"
              ? {
                  frame: f.name,
                  kind: "Beam",
                  location: t * L,
                  topArea: area * (support ? 0.009 : 0.003),
                  bottomArea: area * (support ? 0.004 : 0.007),
                  longitudinalArea: null,
                  shearAreaPerLength: support ? 0.0008 : 0.0004,
                  ratio: null,
                  combo: "1.5(D+L)",
                }
              : {
                  frame: f.name,
                  kind: "Column",
                  location: t * L,
                  topArea: null,
                  bottomArea: null,
                  longitudinalArea: area * 0.012,
                  shearAreaPerLength: 0.0005,
                  ratio: 0.55 + 0.3 * (1 - Math.min(f.start.z, f.end.z) / height),
                  combo: "1.2(D+L+EQX)",
                },
          );
        }
      }
      return rows;
    },
  };
}
