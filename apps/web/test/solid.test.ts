import { describe, expect, it } from "vitest";
import { Vector2, Vector3 } from "three";
import type { FrameSection } from "@etabs-bridge/client";
import { createSampleModel } from "@etabs-bridge/mock-bridge";
import { createColorizer, categoricalColor } from "../src/lib/colors";
import {
  MeshBuilder,
  buildSolidModel,
  cardinalOffset,
  extrudeArea,
  extrudeFrame,
  frameLocalAxes,
  sectionProfile,
} from "../src/lib/solid";

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
const close = (a: Vector3, b: Vector3) => expect(a.distanceTo(b)).toBeLessThan(1e-9);

const section = (over: Partial<FrameSection>): FrameSection => ({
  name: "S",
  shape: "Rectangular",
  etabsType: "Rectangular",
  material: "C35",
  color: "#808080",
  depth: 0.6,
  width: 0.3,
  flangeThickness: null,
  webThickness: null,
  bottomWidth: null,
  bottomFlangeThickness: null,
  properties: null,
  ...over,
});

/** Signed volume of a closed triangle mesh (divergence theorem); positive when faces point outward. */
function volume(positions: Float32Array): number {
  let vol = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const a = v(positions[i]!, positions[i + 1]!, positions[i + 2]!);
    const b = v(positions[i + 3]!, positions[i + 4]!, positions[i + 5]!);
    const c = v(positions[i + 6]!, positions[i + 7]!, positions[i + 8]!);
    vol += a.dot(b.clone().cross(c)) / 6;
  }
  return vol;
}

describe("frame local axes (CSI convention)", () => {
  it("horizontal beam along X: 2 is up, 3 = 1 x 2", () => {
    const ax = frameLocalAxes(v(0, 0, 3), v(6, 0, 3))!;
    close(ax.x1, v(1, 0, 0));
    close(ax.x2, v(0, 0, 1));
    close(ax.x3, v(0, -1, 0));
  });

  it("vertical column: 2 is global +X", () => {
    const ax = frameLocalAxes(v(0, 0, 0), v(0, 0, 3))!;
    close(ax.x2, v(1, 0, 0));
    close(ax.x3, v(0, 1, 0));
  });

  it("rotation angle turns 2 towards 3", () => {
    const ax = frameLocalAxes(v(0, 0, 0), v(0, 0, 3), 90)!;
    close(ax.x2, v(0, 1, 0));
    close(ax.x3, v(-1, 0, 0));
  });

  it("zero-length members have no axes", () => {
    expect(frameLocalAxes(v(1, 1, 1), v(1, 1, 1))).toBeNull();
  });
});

describe("section profiles", () => {
  it("rectangle uses width along 3 and depth along 2", () => {
    const p = sectionProfile(section({}), 1);
    expect(p.points).toHaveLength(4);
    expect(p.width).toBe(0.3);
    expect(p.depth).toBe(0.6);
    expect(p.approximate).toBe(false);
  });

  it("I section has 12 points and the right area", () => {
    const p = sectionProfile(section({ shape: "I", depth: 0.4, width: 0.2, flangeThickness: 0.02, webThickness: 0.01 }), 1);
    expect(p.points).toHaveLength(12);
    const area = Math.abs(polygonArea(p.points));
    expect(area).toBeCloseTo(2 * 0.2 * 0.02 + (0.4 - 0.04) * 0.01, 10);
  });

  it("circles are polygons with diameter = depth", () => {
    const p = sectionProfile(section({ shape: "Circle", depth: 0.6, width: 0.6 }), 1);
    expect(p.points).toHaveLength(16);
    expect(Math.max(...p.points.map((q) => q.length()))).toBeCloseTo(0.3);
  });

  it("missing sections or dimensions fall back to a marked placeholder", () => {
    expect(sectionProfile(undefined, 0.25)).toMatchObject({ width: 0.25, depth: 0.25, approximate: true });
    expect(sectionProfile(section({ shape: "SectionDesigner", depth: null }), 0.25).approximate).toBe(true);
  });

  it.each([
    ["Tee", 8],
    ["Angle", 6],
    ["Channel", 8],
  ])("%s profile is a simple counter-clockwise polygon", (shape, n) => {
    const p = sectionProfile(section({ shape: shape as FrameSection["shape"], depth: 0.3, width: 0.2, flangeThickness: 0.02, webThickness: 0.015 }), 1);
    expect(p.points).toHaveLength(n);
    expect(polygonArea(p.points)).toBeGreaterThan(0);
  });
});

describe("cardinal points", () => {
  it.each([
    [10, 0, 0],
    [5, 0, 0],
    [8, 0, 0.3],
    [2, 0, -0.3],
    [7, 0.15, 0.3],
    [3, -0.15, -0.3],
  ])("point %i -> (%f, %f)", (cp, x, y) => {
    const o = cardinalOffset(cp, 0.3, 0.6);
    expect(o.x).toBeCloseTo(x);
    expect(o.y).toBeCloseTo(y);
  });
});

describe("extrusion", () => {
  it("beam with cardinal point 8 hangs below the joint line, outward-facing, exact volume", () => {
    const mesh = new MeshBuilder();
    const ok = extrudeFrame(
      mesh,
      { start: { x: 0, y: 0, z: 3 }, end: { x: 6, y: 0, z: 3 }, angle: 0, cardinalPoint: 8 },
      sectionProfile(section({}), 1),
      [1, 1, 1],
      0,
    );
    expect(ok).toBe(true);
    const { positions } = mesh.build();
    const zs = Array.from(positions).filter((_, i) => i % 3 === 2);
    expect(Math.max(...zs)).toBeCloseTo(3);
    expect(Math.min(...zs)).toBeCloseTo(2.4);
    expect(volume(positions)).toBeCloseTo(6 * 0.3 * 0.6, 5);
  });

  it("floor slab hangs below its plane; wall is centred", () => {
    const square = [
      { x: 0, y: 0, z: 4 },
      { x: 5, y: 0, z: 4 },
      { x: 5, y: 5, z: 4 },
      { x: 0, y: 5, z: 4 },
    ];
    const slab = new MeshBuilder();
    extrudeArea(slab, { points: square, type: "Floor" }, 0.2, [1, 1, 1], 0);
    const zs = Array.from(slab.build().positions).filter((_, i) => i % 3 === 2);
    expect(Math.max(...zs)).toBeCloseTo(4);
    expect(Math.min(...zs)).toBeCloseTo(3.8);
    expect(Math.abs(volume(slab.build().positions))).toBeCloseTo(5 * 5 * 0.2, 4);

    const wall = new MeshBuilder();
    extrudeArea(wall, { points: [{ x: 0, y: 2, z: 0 }, { x: 5, y: 2, z: 0 }, { x: 5, y: 2, z: 3 }, { x: 0, y: 2, z: 3 }], type: "Wall" }, 0.25, [1, 1, 1], 0);
    const ys = Array.from(wall.build().positions).filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBeCloseTo(2.125);
    expect(Math.min(...ys)).toBeCloseTo(1.875);
  });

  it("builds a full solid model with owner mapping", () => {
    const { geometry, sections } = createSampleModel({ baysX: 2, baysY: 1, stories: 2 });
    const colors = createColorizer("material", geometry, sections);
    const model = buildSolidModel(
      geometry.frames,
      geometry.areas,
      new Map(sections.frameSections.map((s) => [s.name, s])),
      new Map(sections.areaSections.map((s) => [s.name, s])),
      colors.frame,
      colors.area,
      0.3,
    );
    expect(model.approximateFrames).toEqual([]);
    expect(model.approximateAreas).toEqual([]);
    expect(Math.max(...model.frames.triangleOwner)).toBe(geometry.frames.length - 1);
    expect(model.frames.positions.length / 9).toBe(model.frames.triangleOwner.length);
    expect(Math.max(...model.areas.triangleOwner)).toBe(geometry.areas.length - 1);
  });
});

describe("colour binding", () => {
  const { geometry, sections } = createSampleModel({ baysX: 2, baysY: 1, stories: 2 });

  it("material mode uses realistic family colours", () => {
    const c = createColorizer("material", geometry, sections);
    expect(c.legend.map((l) => l.label)).toEqual(["C35", "S355"]);
    const column = geometry.frames.find((f) => f.type === "Column")!;
    const brace = geometry.frames.find((f) => f.type === "Brace")!;
    expect(c.frame(column)).toBe("#b9b6ad");
    expect(c.frame(brace)).toBe("#5b84b1");
  });

  it("section and story modes give one legend entry per value", () => {
    expect(createColorizer("section", geometry, sections).legend).toHaveLength(new Set([...geometry.frames, ...geometry.areas].map((o) => o.section)).size);
    expect(createColorizer("story", geometry, null).legend).toHaveLength(geometry.stories.length);
  });

  it("material mode without section data degrades to neutral", () => {
    const c = createColorizer("material", geometry, null);
    expect(c.legend).toEqual([{ label: "No section data", color: "#9aa0a6" }]);
  });

  it("categorical colours are distinct", () => {
    const set = new Set(Array.from({ length: 30 }, (_, i) => categoricalColor(i)));
    expect(set.size).toBe(30);
  });
});

function polygonArea(points: Vector2[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}
