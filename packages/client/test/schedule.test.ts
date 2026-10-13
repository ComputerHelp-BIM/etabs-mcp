import { describe, expect, it } from "vitest";
import {
  WorkCalendar,
  costCurve,
  generateSchedule,
  overridesFromCsvRows,
  parseCsv,
  scheduleSpan,
  statusAt,
  taskCosts,
  tasksToCsvRows,
  toCsv,
  type GeometrySnapshot,
  type ScheduleSettings,
} from "../src/index.js";

const units = { name: "kN_m_C", force: "kN", length: "m", temperature: "C" };
const story = (name: string, elevation: number) => ({ name, elevation, height: 4, isMaster: false, similarTo: null, spliceAbove: false, spliceHeight: 0, color: "#fff" });
const frame = (name: string, s: string, type: "Column" | "Beam") => ({
  name, label: name, story: s, section: "X", type, joint1: "1", joint2: "2",
  start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 }, angle: 0, cardinalPoint: 10,
});
const area = (name: string, s: string, type: "Floor" | "Wall") => ({ name, label: name, story: s, section: "S", type, joints: [], points: [] });

const geometry: GeometrySnapshot = {
  model: { fileName: "T.EDB", filePath: "", etabsVersion: "", etabsVersionNumber: 22, isLocked: false, units, processId: 1, bridgeVersion: "x" },
  units,
  baseElevation: 0,
  stories: [story("Story1", 4), story("Story2", 8)],
  gridSystems: [],
  joints: [],
  frames: [frame("C1", "Story1", "Column"), frame("B1", "Story1", "Beam"), frame("C2", "Story2", "Column"), frame("B2", "Story2", "Beam")],
  areas: [area("W1", "Story1", "Wall"), area("F1", "Story1", "Floor"), area("F2", "Story2", "Floor")],
};

// 2026-01-05 is a Monday.
const settings: ScheduleSettings = { startDate: "2026-01-05", verticalDays: 3, horizontalDays: 4, lagDays: 1, workingWeekdays: [1, 2, 3, 4, 5], holidays: [] };

describe("work calendar", () => {
  const cal = new WorkCalendar({ workingWeekdays: [1, 2, 3, 4, 5], holidays: ["2026-01-07"] });
  const d = (s: string) => Date.parse(`${s}T00:00:00Z`);
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

  it("skips weekends and holidays", () => {
    expect(iso(cal.nextWorkingDay(d("2026-01-10")))).toBe("2026-01-12"); // Sat -> Mon
    expect(iso(cal.finishAfter(d("2026-01-05"), 3))).toBe("2026-01-08"); // Mon, Tue, (Wed holiday), Thu
    expect(cal.countWorkingDays(d("2026-01-05"), d("2026-01-11"))).toBe(4);
  });

  it("rejects an empty week", () => {
    expect(() => new WorkCalendar({ workingWeekdays: [], holidays: [] })).toThrow();
  });
});

describe("schedule generation", () => {
  const tasks = generateSchedule(geometry, settings);

  it("sequences vertical then horizontal per story, with lag between floors", () => {
    expect(tasks.map((t) => [t.id, t.start, t.finish])).toEqual([
      ["V-Story1", "2026-01-05", "2026-01-07"], // Mon-Wed (3 days)
      ["H-Story1", "2026-01-08", "2026-01-13"], // Thu, Fri, Mon, Tue (4 days)
      ["V-Story2", "2026-01-15", "2026-01-19"], // lag Wed 14; Thu, Fri, Mon
      ["H-Story2", "2026-01-20", "2026-01-23"],
    ]);
    expect(tasks[0]!.elements.sort()).toEqual(["area:W1", "frame:C1"]);
    expect(tasks[1]!.elements.sort()).toEqual(["area:F1", "frame:B1"]);
    expect(tasks.every((t) => !t.edited)).toBe(true);
  });

  it("keeps edited dates and re-sequences what follows", () => {
    const edited = generateSchedule(geometry, settings, { "H-Story1": { start: "2026-01-08", finish: "2026-01-20" } });
    expect(edited[1]).toMatchObject({ start: "2026-01-08", finish: "2026-01-20", edited: true });
    expect(edited[2]!.start).toBe("2026-01-22"); // after lag day Wed 21
    // invalid overrides are ignored
    const bad = generateSchedule(geometry, settings, { "V-Story1": { start: "2026-01-10", finish: "2026-01-01" } });
    expect(bad[0]!.edited).toBe(false);
  });

  it("reports element status at a date", () => {
    const s = statusAt(tasks, "2026-01-12");
    expect(s.get("frame:C1")).toBe("complete");
    expect(s.get("frame:B1")).toBe("in-progress");
    expect(s.get("frame:C2")).toBe("not-started");
    expect(scheduleSpan(tasks)).toEqual({ start: "2026-01-05", finish: "2026-01-23", calendarDays: 19 });
  });

  it("builds a cost S-curve that ends at the total cost", () => {
    const costs = new Map([["V-Story1", 300], ["H-Story1", 400], ["V-Story2", 300], ["H-Story2", 400]]);
    const curve = costCurve(tasks, costs, settings);
    expect(curve).toHaveLength(19);
    expect(curve[curve.length - 1]!.cumulative).toBeCloseTo(1400);
    expect(curve[0]!.cumulative).toBeCloseTo(100); // 300 over 3 working days
    // flat over the weekend
    const sat = curve.find((p) => new Date(p.t).toISOString().startsWith("2026-01-10"))!;
    const fri = curve.find((p) => new Date(p.t).toISOString().startsWith("2026-01-09"))!;
    expect(sat.cumulative).toBe(fri.cumulative);
    for (let i = 1; i < curve.length; i++) expect(curve[i]!.cumulative).toBeGreaterThanOrEqual(curve[i - 1]!.cumulative);
  });

  it("assigns element costs to tasks", () => {
    const elements = [{ kind: "frame", name: "C1", family: "Other", category: "Column", material: "M", concreteVolume: 2 }] as never;
    const costs = taskCosts(tasks, elements, { currency: "INR", rates: { "other:M": 10 }, isSample: false });
    expect(costs.get("V-Story1")).toBe(20);
    expect(costs.get("H-Story1")).toBe(0);
  });

  it("round-trips edits through CSV", () => {
    const rows = parseCsv(toCsv(tasksToCsvRows(tasks)));
    rows[2]![5] = "2026-01-16"; // H-Story1 finish
    rows[3]![4] = "not-a-date";
    rows.push(["X-Nope", "", "", "", "2026-01-01", "2026-01-02"]);
    const { overrides, errors } = overridesFromCsvRows(rows, new Set(tasks.map((t) => t.id)));
    expect(overrides["H-Story1"]).toEqual({ start: "2026-01-08", finish: "2026-01-16" });
    expect(Object.keys(overrides)).not.toContain("V-Story2");
    expect(errors).toHaveLength(2);
    expect(overridesFromCsvRows([["a", "b"]], new Set()).errors[0]).toMatch(/header/);
  });
});
