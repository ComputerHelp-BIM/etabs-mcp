import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AnalysisStatusSchema,
  BaseReactionsSchema,
  BridgeClient,
  ConcreteDesignSchema,
  FrameForcesSchema,
  GeometrySnapshotSchema,
  JointDisplacementsSchema,
  JointReactionsSchema,
  SectionsResultSchema,
  StoryDriftsSchema,
  deformedGeometry,
  designRebarKg,
  driftProfile,
  maxDisplacement,
} from "../src/index.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../contract/fixtures/${name}`, import.meta.url)), "utf8"));

describe("results contract (fixtures written by C#)", () => {
  it.each([
    ["results-status.json", AnalysisStatusSchema],
    ["results-base-reactions.json", BaseReactionsSchema],
    ["results-story-drifts.json", StoryDriftsSchema],
    ["results-joint-reactions.json", JointReactionsSchema],
    ["results-joint-displacements.json", JointDisplacementsSchema],
    ["results-frame-forces.json", FrameForcesSchema],
    ["design-concrete.json", ConcreteDesignSchema],
  ] as const)("%s", (file, schema) => {
    expect(() => schema.parse(fixture(file))).not.toThrow();
  });
});

describe("result helpers", () => {
  const geometry = GeometrySnapshotSchema.parse(fixture("geometry.json"));
  const sections = SectionsResultSchema.parse(fixture("sections.json"));

  it("builds a drift envelope per story, bottom to top", () => {
    const drifts = StoryDriftsSchema.parse(fixture("results-story-drifts.json"));
    const p = driftProfile(drifts.rows, geometry);
    expect(p.map((r) => r.story)).toEqual(["Story1", "Story2"]);
    expect(p[1]!.drift.X).toBe(0.002);
    expect(p[1]!.governing.X).toBeDefined();
  });

  it("moves joints, frames and areas by scaled displacements", () => {
    const rows = [{ joint: "5", loadCase: "EQX", stepType: "", stepNum: 0, u1: 0.01, u2: 0, u3: -0.002, r1: 0, r2: 0, r3: 0 }];
    const d = deformedGeometry(geometry, rows, "EQX", 100);
    const f1 = d.frames.find((f) => f.name === "1")!; // joint1 "1" -> joint2 "5"
    expect(f1.end).toEqual({ x: 1, y: 0, z: 4 - 0.2 });
    expect(f1.start).toEqual(geometry.frames.find((f) => f.name === "1")!.start);
    const slab = d.areas.find((a) => a.name === "1")!; // joints 5,6,7,8
    expect(slab.points[0]!.x).toBeCloseTo(1);
    expect(d.joints.find((j) => j.name === "5")!.x).toBeCloseTo(1);
    expect(deformedGeometry(geometry, rows, "Other", 100).frames[0]!.end).toEqual(geometry.frames[0]!.end);
    expect(maxDisplacement(rows)).toBeCloseTo(Math.hypot(0.01, 0.002));
  });

  it("turns design areas into rebar mass", () => {
    const design = ConcreteDesignSchema.parse(fixture("design-concrete.json"));
    const { kgByFrame, withoutShear } = designRebarKg(design.rows, geometry, sections);
    // Frame 3: beam B300x600, 6 m. Longitudinal max(top+bot) = 0.0018 m² x 6 m; shear mean 0.00045 m²/m x 6 x (0.6 + 0.3).
    const expected = (0.0018 * 6 + 0.00045 * 6 * 0.9) * 7850;
    expect(kgByFrame.get("3")).toBeCloseTo(expected, 6);
    expect(withoutShear).toEqual([]);
  });

  it("encodes case and combo selection in requests", async () => {
    let url = "";
    const client = new BridgeClient({
      baseUrl: "http://localhost:1",
      token: "t",
      fetch: async (input) => {
        url = String(input);
        return new Response(JSON.stringify(fixture("results-frame-forces.json")), { status: 200 });
      },
    });
    await client.frameForces({ cases: ["Dead", "Live"], combos: ["1.5(D+L)"], frame: "3", limit: 10 });
    expect(url).toBe("http://localhost:1/api/v1/results/frame-forces?cases=Dead%2CLive&combos=1.5%28D%2BL%29&limit=10&frame=3");
  });
});
