/**
 * "Data binding" for the 3D view: maps model data (type, material, section, story) to colours.
 */
import type { AreaObject, FrameMember, GeometrySnapshot, SectionsResult } from "@etabs-bridge/client";
import { AREA_COLORS, FRAME_COLORS } from "./scene";

export const COLOR_MODES = ["type", "material", "section", "story"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

export const COLOR_MODE_LABELS: Record<ColorMode, string> = {
  type: "Object type",
  material: "Material",
  section: "Section",
  story: "Story",
};

/** Realistic-ish colours for material families (used for the "concrete" look). */
export const MATERIAL_TYPE_COLORS: Record<string, string> = {
  Concrete: "#b9b6ad",
  Steel: "#5b84b1",
  ColdFormed: "#6f95bd",
  Aluminum: "#c3cbd3",
  Rebar: "#a0522d",
  Tendon: "#8b4f8b",
  Masonry: "#b5651d",
};

const FALLBACK = "#9aa0a6";

/** Distinct, deterministic colours for an arbitrary number of categories (golden-angle hues). */
export function categoricalColor(index: number): string {
  const hue = (index * 137.508) % 360;
  return hslToHex(hue, 0.55, 0.55);
}

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

export interface LegendEntry {
  label: string;
  color: string;
}

export interface Colorizer {
  frame: (f: FrameMember) => string;
  area: (a: AreaObject) => string;
  legend: LegendEntry[];
}

/**
 * Builds colour functions + legend for a mode. Section/material lookups degrade to a neutral
 * colour when sections were not loaded (e.g. bridge older than 0.2.0).
 */
export function createColorizer(mode: ColorMode, geometry: GeometrySnapshot, sections: SectionsResult | null): Colorizer {
  const frameSection = new Map(sections?.frameSections.map((s) => [s.name, s]) ?? []);
  const areaSection = new Map(sections?.areaSections.map((s) => [s.name, s]) ?? []);
  const materials = new Map(sections?.materials.map((m) => [m.name, m]) ?? []);

  switch (mode) {
    case "type":
      return {
        frame: (f) => FRAME_COLORS[f.type],
        area: (a) => AREA_COLORS[a.type],
        legend: [
          { label: "Column", color: FRAME_COLORS.Column },
          { label: "Beam", color: FRAME_COLORS.Beam },
          { label: "Brace", color: FRAME_COLORS.Brace },
          { label: "Floor", color: AREA_COLORS.Floor },
          { label: "Wall", color: AREA_COLORS.Wall },
        ],
      };

    case "material": {
      const frameMaterial = (f: FrameMember) => frameSection.get(f.section)?.material ?? "";
      const areaMaterial = (a: AreaObject) => areaSection.get(a.section)?.material ?? "";
      // Several concrete grades get distinct shades; one grade per family keeps the realistic colour.
      const used = [...new Set([...geometry.frames.map(frameMaterial), ...geometry.areas.map(areaMaterial)])].filter(Boolean).sort();
      const perType = new Map<string, string[]>();
      for (const name of used) {
        const type = materials.get(name)?.type ?? "Other";
        perType.set(type, [...(perType.get(type) ?? []), name]);
      }
      const colorOf = new Map<string, string>();
      let other = 0;
      for (const [type, names] of perType) {
        names.forEach((name, i) => {
          const base = MATERIAL_TYPE_COLORS[type];
          colorOf.set(name, base ? (i === 0 ? base : shade(base, i)) : categoricalColor(other++));
        });
      }
      return {
        frame: (f) => colorOf.get(frameMaterial(f)) ?? FALLBACK,
        area: (a) => colorOf.get(areaMaterial(a)) ?? FALLBACK,
        legend: used.length ? used.map((name) => ({ label: name, color: colorOf.get(name) ?? FALLBACK })) : [{ label: "No section data", color: FALLBACK }],
      };
    }

    case "section": {
      const names = [...new Set([...geometry.frames.map((f) => f.section), ...geometry.areas.map((a) => a.section)])].sort();
      const colorOf = new Map(names.map((n, i) => [n, categoricalColor(i)]));
      return {
        frame: (f) => colorOf.get(f.section) ?? FALLBACK,
        area: (a) => colorOf.get(a.section) ?? FALLBACK,
        legend: names.map((n) => ({ label: n, color: colorOf.get(n) ?? FALLBACK })),
      };
    }

    case "story": {
      const colorOf = new Map(geometry.stories.map((s) => [s.name, s.color]));
      return {
        frame: (f) => colorOf.get(f.story) ?? FALLBACK,
        area: (a) => colorOf.get(a.story) ?? FALLBACK,
        legend: geometry.stories.map((s) => ({ label: s.name, color: s.color })),
      };
    }
  }
}

/** Lightens/darkens a hex colour in steps, for multiple materials of one family. */
function shade(hex: string, step: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const factor = step % 2 === 1 ? 1 - 0.12 * Math.ceil(step / 2) : 1 + 0.12 * (step / 2);
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * factor)))
      .toString(16)
      .padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}
