import { describe, expect, it } from "vitest";
import { compact, niceRange, niceTicks } from "../src/components/charts";

describe("chart helpers", () => {
  it("makes clean ticks from zero", () => {
    expect(niceTicks(17.3e6)).toEqual([0, 5e6, 10e6, 15e6, 20e6]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });

  it("covers negative ranges and keeps zero", () => {
    const t = niceRange(-59.96, 29.98);
    expect(t[0]).toBeLessThanOrEqual(-59.96);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(29.98);
    expect(t).toContain(0);
  });

  it("formats compact numbers", () => {
    expect(compact(17_251_247)).toBe("17.3M");
    expect(compact(818.2)).toBe("818");
    expect(compact(5236)).toBe("5.24K");
    expect(compact(0.004)).toBe("0");
  });
});
