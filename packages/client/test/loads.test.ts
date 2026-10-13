import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GeometrySnapshotSchema, LoadsResultSchema, describeCombination, loadTakedown, type LoadsResult } from "../src/index.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../contract/fixtures/${name}`, import.meta.url)), "utf8"));

describe("loads", () => {
  const loads = LoadsResultSchema.parse(fixture("loads.json"));
  const geometry = GeometrySnapshotSchema.parse(fixture("geometry.json"));

  it("loads.json (from C#) matches the schema", () => {
    expect(loads.patterns.map((p) => p.name)).toEqual(["Dead", "SDL", "Live", "EQX"]);
    expect(loads.combinations[0]!.items).toHaveLength(2);
    expect(loads.warnings.some((w) => w.includes("GetLoadPoint"))).toBe(true);
  });

  it("computes a gravity takedown per pattern", () => {
    const t = loadTakedown(loads, geometry);
    const by = (p: string) => t.find((r) => r.pattern === p)!;
    // Area 1 is the 6 x 5 m slab: SDL 1.5 kN/m² + frame 3 (6 m beam) SDL 10 kN/m.
    expect(by("SDL").area).toBeCloseTo(1.5 * 30);
    expect(by("SDL").frameDistributed).toBeCloseTo(60);
    expect(by("SDL").total).toBeCloseTo(105);
    expect(by("Live").total).toBeCloseTo(90);
    // EQX is a lateral joint load: not counted as gravity.
    expect(by("EQX").total).toBe(0);
    expect(by("EQX").notCounted).toBe(1);
    expect(by("Dead").selfWeightMultiplier).toBe(1);
  });

  it("handles global Z (upward positive) and non-force loads", () => {
    const l: LoadsResult = {
      ...loads,
      areaUniform: [{ area: "1", pattern: "Live", cSys: "Global", direction: 6, value: -2 }],
      frameDistributed: [{ ...loads.frameDistributed[0]!, loadType: "Moment" }],
      jointLoads: [{ joint: "5", pattern: "Live", cSys: "Global", f1: 0, f2: 0, f3: -50, m1: 0, m2: 0, m3: 0 }],
    };
    const live = loadTakedown(l, geometry).find((r) => r.pattern === "Live")!;
    expect(live.area).toBeCloseTo(60);
    expect(live.joint).toBe(50);
    expect(loadTakedown(l, geometry).find((r) => r.pattern === "SDL")!.notCounted).toBe(1);
  });

  it("describes combinations", () => {
    expect(describeCombination([{ kind: "LoadCase", name: "Dead", factor: 1.2 }, { kind: "LoadCase", name: "Live", factor: 1.6 }])).toBe("1.2 × Dead + 1.6 × Live");
  });
});
