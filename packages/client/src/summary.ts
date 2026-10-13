import type { GeometrySnapshot, Point3 } from "./schemas.js";

export interface StorySummary {
  name: string;
  elevation: number;
  joints: number;
  columns: number;
  beams: number;
  braces: number;
  otherFrames: number;
  floors: number;
  walls: number;
  otherAreas: number;
}

export interface GeometrySummary {
  model: string;
  units: string;
  counts: {
    stories: number;
    gridSystems: number;
    joints: number;
    supports: number;
    frames: number;
    areas: number;
  };
  framesByType: Record<string, number>;
  areasByType: Record<string, number>;
  /** Section name -> number of objects using it. */
  frameSections: Record<string, number>;
  areaSections: Record<string, number>;
  /** Axis-aligned bounding box of all joints, or null for an empty model. */
  bounds: { min: Point3; max: Point3 } | null;
  stories: StorySummary[];
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function sortedByKey(map: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Compact, LLM- and dashboard-friendly overview of a geometry snapshot:
 * counts per type and story, sections in use, and extents.
 */
export function summarizeGeometry(g: GeometrySnapshot): GeometrySummary {
  const framesByType: Record<string, number> = {};
  const areasByType: Record<string, number> = {};
  const frameSections: Record<string, number> = {};
  const areaSections: Record<string, number> = {};

  const perStory = new Map<string, StorySummary>();
  const storyRow = (name: string): StorySummary => {
    let row = perStory.get(name);
    if (!row) {
      const story = g.stories.find((s) => s.name === name);
      row = {
        name,
        elevation: story?.elevation ?? g.baseElevation,
        joints: 0,
        columns: 0,
        beams: 0,
        braces: 0,
        otherFrames: 0,
        floors: 0,
        walls: 0,
        otherAreas: 0,
      };
      perStory.set(name, row);
    }
    return row;
  };
  // Seed in story order so stories without objects still appear.
  for (const s of g.stories) storyRow(s.name);

  let supports = 0;
  let min: Point3 | null = null;
  let max: Point3 | null = null;
  for (const j of g.joints) {
    storyRow(j.story).joints++;
    if (j.restraints.some(Boolean)) supports++;
    min = min ? { x: Math.min(min.x, j.x), y: Math.min(min.y, j.y), z: Math.min(min.z, j.z) } : { x: j.x, y: j.y, z: j.z };
    max = max ? { x: Math.max(max.x, j.x), y: Math.max(max.y, j.y), z: Math.max(max.z, j.z) } : { x: j.x, y: j.y, z: j.z };
  }

  for (const f of g.frames) {
    increment(framesByType, f.type);
    increment(frameSections, f.section);
    const row = storyRow(f.story);
    if (f.type === "Column") row.columns++;
    else if (f.type === "Beam") row.beams++;
    else if (f.type === "Brace") row.braces++;
    else row.otherFrames++;
  }

  for (const a of g.areas) {
    increment(areasByType, a.type);
    increment(areaSections, a.section);
    const row = storyRow(a.story);
    if (a.type === "Floor") row.floors++;
    else if (a.type === "Wall") row.walls++;
    else row.otherAreas++;
  }

  return {
    model: g.model.fileName || "(unsaved model)",
    units: g.units.name,
    counts: {
      stories: g.stories.length,
      gridSystems: g.gridSystems.length,
      joints: g.joints.length,
      supports,
      frames: g.frames.length,
      areas: g.areas.length,
    },
    framesByType: sortedByKey(framesByType),
    areasByType: sortedByKey(areasByType),
    frameSections: sortedByKey(frameSections),
    areaSections: sortedByKey(areaSections),
    bounds: min && max ? { min, max } : null,
    stories: [...perStory.values()].sort((a, b) => a.elevation - b.elevation),
  };
}
