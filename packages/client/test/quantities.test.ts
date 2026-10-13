import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUANTITY_SETTINGS,
  boqToCsv,
  buildBoq,
  computeElementQuantities,
  csvField,
  defaultRateTable,
  elementCost,
  forceToKiloNewtons,
  lengthToMeters,
  parseCsv,
  polygonArea,
  priceBoq,
  ratesFromCsv,
  ratesToCsv,
  summarizeCost,
  unitWeightToDensity,
  type GeometrySnapshot,
  type SectionsResult,
} from "../src/index.js";

const units = { name: "kN_m_C", force: "kN", length: "m", temperature: "C" };
const p = (x: number, y: number, z: number) => ({ x, y, z });

/** One 4 m column (0.5x0.5), one 6 m beam (0.3x0.6), one 6x5 slab (0.2), one 6x4 wall (0.25), one 5 m steel brace. */
function model(): { geometry: GeometrySnapshot; sections: SectionsResult } {
  const frame = (name: string, type: "Column" | "Beam" | "Brace", section: string, a: ReturnType<typeof p>, b: ReturnType<typeof p>) => ({
    name, label: name, story: "Story1", section, type, joint1: "1", joint2: "2", start: a, end: b, angle: 0, cardinalPoint: 10,
  });
  const area = (name: string, type: "Floor" | "Wall", section: string, pts: ReturnType<typeof p>[]) => ({
    name, label: name, story: "Story1", section, type, joints: pts.map((_, i) => String(i)), points: pts,
  });
  const nullDims = { flangeThickness: null, webThickness: null, bottomWidth: null, bottomFlangeThickness: null };
  return {
    geometry: {
      model: { fileName: "T.EDB", filePath: "", etabsVersion: "", etabsVersionNumber: 22, isLocked: false, units, processId: 1, bridgeVersion: "x" },
      units,
      baseElevation: 0,
      stories: [{ name: "Story1", elevation: 4, height: 4, isMaster: true, similarTo: null, spliceAbove: false, spliceHeight: 0, color: "#fff" }],
      gridSystems: [],
      joints: [],
      frames: [
        frame("C1", "Column", "C500", p(0, 0, 0), p(0, 0, 4)),
        frame("B1", "Beam", "B300x600", p(0, 0, 4), p(6, 0, 4)),
        frame("D1", "Brace", "HSS", p(0, 0, 0), p(3, 0, 4)),
        frame("X1", "Beam", "NOPE", p(0, 0, 0), p(1, 0, 0)),
      ],
      areas: [
        area("F1", "Floor", "S200", [p(0, 0, 4), p(6, 0, 4), p(6, 5, 4), p(0, 5, 4)]),
        area("W1", "Wall", "W250", [p(0, 0, 0), p(6, 0, 0), p(6, 0, 4), p(0, 0, 4)]),
      ],
    },
    sections: {
      units,
      materials: [
        { name: "C35", type: "Concrete", color: "#ccc", e: 3e7, poisson: 0.2, thermalCoefficient: null, unitWeight: 25, fc: 35000, fy: null, fu: null },
        { name: "S355", type: "Steel", color: "#00f", e: 2e8, poisson: 0.3, thermalCoefficient: null, unitWeight: 76.9729, fc: null, fy: 355000, fu: 490000 },
      ],
      frameSections: [
        { name: "C500", shape: "Rectangular", etabsType: "Rectangular", material: "C35", color: "#ccc", depth: 0.5, width: 0.5, ...nullDims, properties: null },
        { name: "B300x600", shape: "Rectangular", etabsType: "Rectangular", material: "C35", color: "#ccc", depth: 0.6, width: 0.3, ...nullDims, properties: null },
        {
          name: "HSS", shape: "Box", etabsType: "Box", material: "S355", color: "#00f", depth: 0.2, width: 0.2, ...nullDims,
          properties: { area: 0.0076, as2: 0, as3: 0, torsion: 0, i22: 0, i33: 0, s22: 0, s33: 0, z22: 0, z33: 0, r22: 0, r33: 0 },
        },
      ],
      areaSections: [
        { name: "S200", kind: "Slab", subType: "Slab", shellType: "ShellThin", material: "C35", thickness: 0.2, color: "#ccc" },
        { name: "W250", kind: "Wall", subType: "Specified", shellType: "ShellThin", material: "C35", thickness: 0.25, color: "#ccc" },
      ],
      warnings: [],
    },
  };
}

describe("units", () => {
  it("converts model units to SI", () => {
    expect(lengthToMeters({ length: "mm", name: "kN_mm_C" })).toBe(0.001);
    expect(lengthToMeters({ length: "ft", name: "kip_ft_F" })).toBe(0.3048);
    expect(forceToKiloNewtons({ force: "kip", name: "kip_ft_F" })).toBeCloseTo(4.448, 3);
    expect(() => lengthToMeters({ length: "furlong", name: "x" })).toThrow(/Unknown length unit/);
  });

  it("converts unit weight to density", () => {
    expect(unitWeightToDensity(76.9729, units)).toBeCloseTo(7849, 0);
    // 490 lb/ft³ steel in kip_ft: 0.490 kip/ft³ -> ~7849 kg/m³
    expect(unitWeightToDensity(0.49, { name: "kip_ft_F", force: "kip", length: "ft", temperature: "F" })).toBeCloseTo(7849, -1);
  });

  it("measures 3D polygons", () => {
    expect(polygonArea([p(0, 0, 0), p(6, 0, 0), p(6, 0, 4), p(0, 0, 4)])).toBeCloseTo(24);
  });
});

describe("element quantities", () => {
  const { geometry, sections } = model();
  const q = computeElementQuantities(geometry, sections);
  const by = (n: string) => q.find((e) => e.name === n)!;

  it("measures concrete frames: volume, formwork, rebar by ratio", () => {
    expect(by("C1").concreteVolume).toBeCloseTo(0.5 * 0.5 * 4); // 1.0 m³
    expect(by("C1").formwork).toBeCloseTo(2 * (0.5 + 0.5) * 4); // perimeter x length = 8 m²
    expect(by("C1").rebar).toBeCloseTo(1.0 * 180);
    expect(by("B1").concreteVolume).toBeCloseTo(0.3 * 0.6 * 6); // 1.08
    expect(by("B1").formwork).toBeCloseTo((0.3 + 2 * 0.6) * 6); // 9.0
    expect(by("B1").rebarSource).toBe("ratio");
  });

  it("measures steel by net area x length x density", () => {
    expect(by("D1").family).toBe("Steel");
    expect(by("D1").length).toBeCloseTo(5);
    expect(by("D1").steel).toBeCloseTo(0.0076 * 5 * unitWeightToDensity(76.9729, units), 6);
    expect(by("D1").concreteVolume).toBe(0);
  });

  it("measures slabs and walls", () => {
    expect(by("F1").concreteVolume).toBeCloseTo(6 * 5 * 0.2);
    expect(by("F1").formwork).toBeCloseTo(30);
    expect(by("W1").concreteVolume).toBeCloseTo(24 * 0.25);
    expect(by("W1").formwork).toBeCloseTo(48);
    expect(by("W1").rebar).toBeCloseTo(6 * 110);
  });

  it("flags elements it cannot measure instead of guessing", () => {
    expect(by("X1").issue).toMatch(/not found/);
    expect(by("X1").concreteVolume).toBe(0);
  });

  it("uses ETABS design rebar when supplied", () => {
    const withDesign = computeElementQuantities(geometry, sections, { designRebarKg: new Map([["B1", 123]]) });
    const b = withDesign.find((e) => e.name === "B1")!;
    expect(b.rebar).toBe(123);
    expect(b.rebarSource).toBe("design");
  });

  it("is unit independent (same building in mm gives the same SI quantities)", () => {
    const { geometry: g, sections: s } = model();
    const mm = { name: "kN_mm_C", force: "kN", length: "mm", temperature: "C" };
    const k = 1000;
    const scaled: GeometrySnapshot = {
      ...g,
      units: mm,
      frames: g.frames.map((f) => ({ ...f, start: { x: f.start.x * k, y: f.start.y * k, z: f.start.z * k }, end: { x: f.end.x * k, y: f.end.y * k, z: f.end.z * k } })),
      areas: g.areas.map((a) => ({ ...a, points: a.points.map((pt) => ({ x: pt.x * k, y: pt.y * k, z: pt.z * k })) })),
    };
    const scaledSections: SectionsResult = {
      ...s,
      units: mm,
      materials: s.materials.map((m) => ({ ...m, unitWeight: m.unitWeight === null ? null : m.unitWeight / k ** 3 })),
      frameSections: s.frameSections.map((f) => ({
        ...f,
        depth: f.depth === null ? null : f.depth * k,
        width: f.width === null ? null : f.width * k,
        properties: f.properties ? { ...f.properties, area: f.properties.area * k * k } : null,
      })),
      areaSections: s.areaSections.map((a) => ({ ...a, thickness: a.thickness === null ? null : a.thickness * k })),
    };
    const a = computeElementQuantities(g, s);
    const b = computeElementQuantities(scaled, scaledSections);
    a.forEach((e, i) => {
      expect(b[i]!.concreteVolume).toBeCloseTo(e.concreteVolume, 9);
      expect(b[i]!.formwork).toBeCloseTo(e.formwork, 9);
      expect(b[i]!.steel).toBeCloseTo(e.steel, 6);
    });
  });
});

describe("BOQ and costing", () => {
  const { geometry, sections } = model();
  const q = computeElementQuantities(geometry, sections);

  it("aggregates by item with stable codes", () => {
    const boq = buildBoq(q);
    const line = (code: string) => boq.find((l) => l.code === code)!;
    expect(line("CON-C35-COLUMN").quantity).toBeCloseTo(1.0);
    expect(line("CON-C35-SLAB").quantity).toBeCloseTo(6);
    expect(line("FWK-WALL").quantity).toBeCloseTo(48);
    expect(line("RFT-BEAM").unit).toBe("kg");
    expect(line("STL-S355-BRACE").unit).toBe("t");
    expect(line("STL-S355-BRACE").quantity).toBeCloseTo(q.find((e) => e.name === "D1")!.steel / 1000);
    expect(boq[0]!.item).toBe("Concrete");
  });

  it("groups by story and applies wastage", () => {
    const boq = buildBoq(q, { groupBy: "story", settings: { ...DEFAULT_QUANTITY_SETTINGS, wastagePercent: { concrete: 10, formwork: 0, rebar: 0, steel: 0 } } });
    const col = boq.find((l) => l.code === "CON-C35-COLUMN-STORY1")!;
    expect(col.story).toBe("Story1");
    expect(col.quantity).toBeCloseTo(1.1);
  });

  it("prices lines and sums costs consistently", () => {
    const boq = buildBoq(q);
    const rates = defaultRateTable(boq);
    expect(rates.isSample).toBe(true);
    expect(rates.rates["concrete:C35"]).toBe(7000);
    expect(rates.rates["formwork:Column"]).toBe(750);
    const priced = priceBoq(boq, rates);
    const summary = summarizeCost(priced, q, rates);
    const sumElements = q.reduce((s, e) => s + elementCost(e, rates), 0);
    expect(summary.total).toBeCloseTo(sumElements, 6); // BOQ total == sum of element costs
    expect(summary.byStory.Story1).toBeCloseTo(summary.total, 6);
    expect(summary.missingRates).toEqual([]);
  });

  it("keeps edited rates when the BOQ changes", () => {
    const boq = buildBoq(q);
    const edited = { ...defaultRateTable(boq), rates: { ...defaultRateTable(boq).rates, rebar: 90 }, isSample: false, currency: "AED" };
    const again = defaultRateTable(boq, edited);
    expect(again.rates.rebar).toBe(90);
    expect(again.currency).toBe("AED");
    expect(again.isSample).toBe(false);
  });

  it("exports BOQ and rates as CSV and reads rates back", () => {
    const boq = buildBoq(q);
    const rates = defaultRateTable(boq);
    const csv = boqToCsv(priceBoq(boq, rates), "INR");
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(["Code", "Description", "Story", "Unit", "Quantity", "Objects", "Rate (INR)", "Amount (INR)"]);
    expect(rows).toHaveLength(boq.length + 1);

    const round = ratesFromCsv(ratesToCsv({ ...rates, currency: "usd" }));
    expect(round.errors).toEqual([]);
    expect(round.table.currency).toBe("USD"); // normalized to upper case
    expect(round.table.rates).toEqual(rates.rates);
    expect(round.table.isSample).toBe(false);

    const bad = ratesFromCsv("rate_key,rate\ncurrency,EURO\nrebar,abc\nconcrete:C35,\"7,500\"\n");
    expect(bad.errors).toHaveLength(2);
    expect(bad.table.rates["concrete:C35"]).toBe(7500);
  });

  it("neutralises spreadsheet formulas in text but not in numbers", () => {
    expect(csvField("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvField("-C35")).toBe("'-C35");
    expect(csvField(-5)).toBe("-5");
    expect(csvField('a "b", c')).toBe('"a ""b"", c"');
  });
});
