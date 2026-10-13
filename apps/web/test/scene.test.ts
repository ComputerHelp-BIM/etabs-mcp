import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { createSampleModel } from "@etabs-bridge/mock-bridge";
import { buildAreaBuffers, buildFrameBuffers, computeBounds, triangulatePolygon, visibleStories } from "../src/lib/scene";

const { geometry } = createSampleModel({ baysX: 2, baysY: 2, stories: 3 });

describe("scene buffers", () => {
  it("draws two vertices per frame with the highlight colour on the selected one", () => {
    const frames = geometry.frames.slice(0, 3);
    const b = buildFrameBuffers(frames, frames[1]!.name);
    expect(b.positions).toHaveLength(18);
    expect(Array.from(b.positions.slice(0, 3))).toEqual([frames[0]!.start.x, frames[0]!.start.y, frames[0]!.start.z]);
    // HIGHLIGHT_COLOR #ff2d55 -> r = 1
    expect(b.colors[6]).toBeCloseTo(1);
  });

  it("triangulates quads into two triangles and maps triangles back to areas", () => {
    const areas = geometry.areas.slice(0, 2);
    const b = buildAreaBuffers(areas);
    expect(b.triangleOwner).toEqual(Uint32Array.from([0, 0, 1, 1]));
    expect(b.positions).toHaveLength(4 * 9);
    expect(b.skipped).toEqual([]);
  });

  it("triangulates concave and vertical polygons", () => {
    // L-shaped floor (concave), 6 vertices -> 4 triangles.
    const l = [
      [0, 0], [4, 0], [4, 1], [1, 1], [1, 3], [0, 3],
    ].map(([x, y]) => new Vector3(x, y, 5));
    expect(triangulatePolygon(l)).toHaveLength(4);

    // Wall in the XZ plane.
    const wall = [new Vector3(0, 2, 0), new Vector3(5, 2, 0), new Vector3(5, 2, 3), new Vector3(0, 2, 3)];
    const tris = triangulatePolygon(wall)!;
    expect(tris).toHaveLength(2);
    // Area is preserved: 5 x 3.
    const area = tris.reduce((sum, [a, b, c]) => sum + new Vector3().subVectors(b!, a!).cross(new Vector3().subVectors(c!, a!)).length() / 2, 0);
    expect(area).toBeCloseTo(15);
  });

  it("skips degenerate polygons", () => {
    expect(triangulatePolygon([new Vector3(0, 0, 0), new Vector3(1, 0, 0)])).toBeNull();
    expect(triangulatePolygon([new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(2, 0, 0)])).toBeNull();
  });

  it("computes bounds and handles empty models", () => {
    const b = computeBounds(geometry);
    expect(b.min.toArray()).toEqual([0, 0, 0]);
    expect(b.max.x).toBe(12);
    expect(computeBounds({ joints: [] }).size).toBeGreaterThanOrEqual(1);
  });

  it("filters stories up to a level, always keeping the base", () => {
    expect([...visibleStories(geometry, "Story2")]).toEqual(["Base", "Story1", "Story2"]);
    expect(visibleStories(geometry, null).size).toBe(4);
  });
});
