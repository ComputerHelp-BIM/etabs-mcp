/**
 * Quantity take-off (QTO) and bill of quantities (BOQ) from ETABS geometry + sections.
 *
 * Measurement rules (gross quantities, stated in the BOQ notes):
 *  - Frames: section area x centre-line length (joint to joint). No deduction where beams frame into
 *    columns or slabs overlap beams; typically 3-8 % above a net measurement.
 *  - Slabs/walls: polygon area x section thickness. Openings are not modelled by ETABS area objects.
 *  - Formwork: columns = perimeter x length; beams = (width + 2 x depth) x length (sides + soffit,
 *    slab overlap not deducted); slabs = soffit area; walls = both faces.
 *  - Reinforcement: concrete volume x kg/m³ ratio per element category (editable). Replaced by ETABS
 *    design rebar when design results are supplied (see `designRebarKg`).
 *  - Structural steel: net section area x length x density (from the material's unit weight, or 7850).
 * All outputs are SI: m, m², m³, kg (t for steel lines in the BOQ).
 */
import type { AreaObject, FrameMember, FrameSection, GeometrySnapshot, Material, SectionsResult } from "./schemas.js";
import { lengthToMeters, unitWeightToDensity } from "./units.js";

export const ELEMENT_CATEGORIES = ["Column", "Beam", "Brace", "Slab", "Wall", "Other"] as const;
export type ElementCategory = (typeof ELEMENT_CATEGORIES)[number];

export interface QuantitySettings {
  /** Reinforcement ratio in kg per m³ of concrete, per element category. */
  rebarRatios: Record<ElementCategory, number>;
  /** Used when a steel material has no unit weight. kg/m³. */
  defaultSteelDensity: number;
  /** Added to the measured quantity (e.g. 2.5 = +2.5 %). Usually 0 when wastage is priced into rates. */
  wastagePercent: { concrete: number; formwork: number; rebar: number; steel: number };
}

export const DEFAULT_QUANTITY_SETTINGS: QuantitySettings = {
  rebarRatios: { Column: 180, Beam: 150, Brace: 150, Slab: 90, Wall: 110, Other: 100 },
  defaultSteelDensity: 7850,
  wastagePercent: { concrete: 0, formwork: 0, rebar: 0, steel: 0 },
};

export type MaterialFamily = "Concrete" | "Steel" | "Other";

/** Quantities of one ETABS object. */
export interface ElementQuantity {
  kind: "frame" | "area";
  name: string;
  label: string;
  story: string;
  category: ElementCategory;
  section: string;
  material: string;
  family: MaterialFamily;
  /** Length (frames) in m, else null. */
  length: number | null;
  /** Plan/face area (areas) in m², else null. */
  area: number | null;
  /** Gross volume in m³ (concrete or any non-steel material), else 0. */
  concreteVolume: number;
  /** Formwork contact area in m² (concrete only). */
  formwork: number;
  /** Reinforcement in kg (concrete only). */
  rebar: number;
  /** "ratio" (kg/m³ assumption) or "design" (from ETABS concrete design). */
  rebarSource: "ratio" | "design" | "none";
  /** Structural steel mass in kg. */
  steel: number;
  /** Why a quantity could not be measured (missing section data, ...), else null. */
  issue: string | null;
}

export interface QuantityOptions {
  settings?: QuantitySettings;
  /**
   * Longitudinal + shear rebar mass per frame name (kg) from ETABS concrete design results;
   * overrides the ratio for those frames.
   */
  designRebarKg?: ReadonlyMap<string, number>;
}

const STEEL_TYPES = new Set(["Steel", "ColdFormed", "Aluminum"]);

export function familyOf(material: Material | undefined): MaterialFamily {
  if (!material) return "Other";
  if (material.type === "Concrete") return "Concrete";
  if (STEEL_TYPES.has(material.type)) return "Steel";
  return "Other";
}

export function frameCategory(f: FrameMember): ElementCategory {
  return f.type === "Column" || f.type === "Beam" || f.type === "Brace" ? f.type : "Other";
}

export function areaCategory(a: AreaObject): ElementCategory {
  if (a.type === "Floor" || a.type === "Ramp") return "Slab";
  if (a.type === "Wall") return "Wall";
  return "Other";
}

/** Gross cross-section area (model units²), or null when unknown. */
export function sectionArea(s: FrameSection | undefined): number | null {
  if (!s) return null;
  if (s.properties && s.properties.area > 0) return s.properties.area;
  if (!s.depth || !s.width) return null;
  if (s.shape === "Circle") return (Math.PI * s.depth * s.depth) / 4;
  if (s.shape === "Rectangular") return s.depth * s.width;
  return null;
}

/** Outer perimeter (model units), or null when unknown. */
export function sectionPerimeter(s: FrameSection | undefined): number | null {
  if (!s || !s.depth || !s.width) return null;
  if (s.shape === "Circle" || s.shape === "Pipe") return Math.PI * s.depth;
  return 2 * (s.depth + s.width);
}

/** Area of a planar 3D polygon (Newell's method), in the coordinates' units². */
export function polygonArea(points: ReadonlyArray<{ x: number; y: number; z: number }>): number {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  return Math.hypot(nx, ny, nz) / 2;
}

/** Measures every frame and area object. */
export function computeElementQuantities(geometry: GeometrySnapshot, sections: SectionsResult, options: QuantityOptions = {}): ElementQuantity[] {
  const settings = options.settings ?? DEFAULT_QUANTITY_SETTINGS;
  const m = lengthToMeters(geometry.units);
  const frameSections = new Map(sections.frameSections.map((s) => [s.name, s]));
  const areaSections = new Map(sections.areaSections.map((s) => [s.name, s]));
  const materials = new Map(sections.materials.map((x) => [x.name, x]));
  const densityOf = (mat: Material | undefined) =>
    mat?.unitWeight && mat.unitWeight > 0 ? unitWeightToDensity(mat.unitWeight, sections.units) : settings.defaultSteelDensity;
  const sectionToM = lengthToMeters(sections.units);

  const out: ElementQuantity[] = [];

  for (const f of geometry.frames) {
    const s = frameSections.get(f.section);
    const mat = s ? materials.get(s.material) : undefined;
    const family = familyOf(mat);
    const category = frameCategory(f);
    const length = Math.hypot(f.end.x - f.start.x, f.end.y - f.start.y, f.end.z - f.start.z) * m;
    const a = sectionArea(s);
    const q: ElementQuantity = {
      kind: "frame",
      name: f.name,
      label: f.label,
      story: f.story,
      category,
      section: f.section,
      material: s?.material ?? "",
      family,
      length,
      area: null,
      concreteVolume: 0,
      formwork: 0,
      rebar: 0,
      rebarSource: "none",
      steel: 0,
      issue: null,
    };

    if (a === null) {
      q.issue = s ? `Section "${f.section}" has no area or dimensions` : `Section "${f.section}" not found`;
      out.push(q);
      continue;
    }

    const areaM2 = a * sectionToM * sectionToM;
    if (family === "Steel") {
      q.steel = areaM2 * length * densityOf(mat);
    } else {
      q.concreteVolume = areaM2 * length;
      if (family === "Concrete") {
        const depth = (s?.depth ?? 0) * sectionToM;
        const width = (s?.width ?? 0) * sectionToM;
        const perimeter = (sectionPerimeter(s) ?? 0) * sectionToM;
        q.formwork = (category === "Beam" ? width + 2 * depth : perimeter) * length;
        const design = options.designRebarKg?.get(f.name);
        if (design !== undefined) {
          q.rebar = design;
          q.rebarSource = "design";
        } else {
          q.rebar = q.concreteVolume * settings.rebarRatios[category];
          q.rebarSource = "ratio";
        }
      }
    }
    out.push(q);
  }

  for (const a of geometry.areas) {
    const s = areaSections.get(a.section);
    const mat = s ? materials.get(s.material) : undefined;
    const family = familyOf(mat);
    const category = areaCategory(a);
    const area = polygonArea(a.points) * m * m;
    const q: ElementQuantity = {
      kind: "area",
      name: a.name,
      label: a.label,
      story: a.story,
      category,
      section: a.section,
      material: s?.material ?? "",
      family,
      length: null,
      area,
      concreteVolume: 0,
      formwork: 0,
      rebar: 0,
      rebarSource: "none",
      steel: 0,
      issue: null,
    };
    const t = s?.thickness;
    if (!t || t <= 0) {
      q.issue = s ? `Section "${a.section}" has no thickness (e.g. deck)` : `Section "${a.section}" not found`;
      out.push(q);
      continue;
    }
    const volume = area * t * sectionToM;
    if (family === "Steel") {
      q.steel = volume * densityOf(mat);
    } else {
      q.concreteVolume = volume;
      if (family === "Concrete") {
        q.formwork = category === "Wall" ? 2 * area : area;
        q.rebar = volume * settings.rebarRatios[category];
        q.rebarSource = "ratio";
      }
    }
    out.push(q);
  }

  return out;
}

// ------------------------------------------------------------------ BOQ

export const BOQ_ITEMS = ["Concrete", "Formwork", "Reinforcement", "Structural steel", "Other material"] as const;
export type BoqItem = (typeof BOQ_ITEMS)[number];

export interface BoqLine {
  /** Stable code, e.g. "CON-C35-COLUMN" (story suffix when grouped by story). */
  code: string;
  item: BoqItem;
  description: string;
  unit: "m³" | "m²" | "kg" | "t";
  quantity: number;
  category: ElementCategory;
  material: string | null;
  /** Story when grouped by story, else null. */
  story: string | null;
  /** Key into the rate table (see costing.ts). */
  rateKey: string;
  /** Number of ETABS objects measured into this line. */
  count: number;
}

export interface BoqOptions {
  groupBy?: "item" | "story";
  settings?: QuantitySettings;
}

const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Rate key for a measured component. One rate per concrete grade, per formwork category, for rebar, per steel grade. */
export function rateKeyFor(item: BoqItem, category: ElementCategory, material: string | null): string {
  switch (item) {
    case "Concrete":
      return `concrete:${material ?? ""}`;
    case "Formwork":
      return `formwork:${category}`;
    case "Reinforcement":
      return "rebar";
    case "Structural steel":
      return `steel:${material ?? ""}`;
    case "Other material":
      return `other:${material ?? ""}`;
  }
}

/** Aggregates element quantities into BOQ lines (sorted by item, material, category, story). */
export function buildBoq(elements: readonly ElementQuantity[], options: BoqOptions = {}): BoqLine[] {
  const settings = options.settings ?? DEFAULT_QUANTITY_SETTINGS;
  const byStory = options.groupBy === "story";
  const lines = new Map<string, BoqLine>();

  const add = (item: BoqItem, unit: BoqLine["unit"], qty: number, e: ElementQuantity, material: string | null, description: string) => {
    if (qty <= 0) return;
    const story = byStory ? e.story : null;
    const code = [
      { Concrete: "CON", Formwork: "FWK", Reinforcement: "RFT", "Structural steel": "STL", "Other material": "OTH" }[item],
      material ? slug(material) : null,
      slug(e.category),
      story ? slug(story) : null,
    ]
      .filter(Boolean)
      .join("-");
    const existing = lines.get(code);
    if (existing) {
      existing.quantity += qty;
      existing.count += 1;
    } else {
      lines.set(code, { code, item, description, unit, quantity: qty, category: e.category, material, story, rateKey: rateKeyFor(item, e.category, material), count: 1 });
    }
  };

  const plural = (c: ElementCategory) => ({ Column: "columns", Beam: "beams", Brace: "braces", Slab: "slabs", Wall: "walls", Other: "other elements" })[c];

  for (const e of elements) {
    if (e.family === "Concrete") {
      add("Concrete", "m³", e.concreteVolume * (1 + settings.wastagePercent.concrete / 100), e, e.material, `Concrete ${e.material} in ${plural(e.category)}`);
      add("Formwork", "m²", e.formwork * (1 + settings.wastagePercent.formwork / 100), e, null, `Formwork to ${plural(e.category)}`);
      add("Reinforcement", "kg", e.rebar * (1 + settings.wastagePercent.rebar / 100), e, null, `Reinforcement in ${plural(e.category)}`);
    } else if (e.family === "Steel") {
      add("Structural steel", "t", (e.steel / 1000) * (1 + settings.wastagePercent.steel / 100), e, e.material, `Structural steel ${e.material} in ${plural(e.category)}`);
    } else {
      add("Other material", "m³", e.concreteVolume, e, e.material || "unknown", `${e.material || "Unknown material"} in ${plural(e.category)}`);
    }
  }

  const itemOrder = new Map(BOQ_ITEMS.map((x, i) => [x, i]));
  const categoryOrder = new Map(ELEMENT_CATEGORIES.map((x, i) => [x, i]));
  return [...lines.values()].sort(
    (a, b) =>
      itemOrder.get(a.item)! - itemOrder.get(b.item)! ||
      (a.material ?? "").localeCompare(b.material ?? "") ||
      categoryOrder.get(a.category)! - categoryOrder.get(b.category)! ||
      (a.story ?? "").localeCompare(b.story ?? "", undefined, { numeric: true }),
  );
}

export const BOQ_NOTES = [
  "Gross quantities measured along member centre lines; no deduction at beam-column or slab-beam intersections (typically 3-8 % above net).",
  "Beam formwork = soffit + both sides over full depth; slab formwork = soffit only; wall formwork = both faces.",
  "Reinforcement from kg/m³ ratios per element type unless ETABS concrete design results were used.",
  "Openings, end offsets and rigid zones are not modelled.",
];
