import type {
  AreaObject,
  FrameMember,
  GeometrySnapshot,
  GridLine,
  Joint,
  SectionsResult,
  Story,
  TableData,
  TableInfo,
} from "@etabs-bridge/client";

export interface SampleModelOptions {
  /** Bays along X (grid lines A, B, ...). Default 4. */
  baysX?: number;
  /** Bays along Y (grid lines 1, 2, ...). Default 3. */
  baysY?: number;
  /** Number of stories above the base. Default 6. */
  stories?: number;
  bayX?: number;
  bayY?: number;
  firstStoryHeight?: number;
  typicalStoryHeight?: number;
  processId?: number;
}

export interface SampleModel {
  geometry: GeometrySnapshot;
  sections: SectionsResult;
  tables: TableInfo[];
  tableData: Map<string, Omit<TableData, "totalRows" | "offset" | "group">>;
}

const STORY_COLORS = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948", "#b07aa1", "#ff9da7"];

const round = (v: number) => Math.round(v * 1e6) / 1e6;

/** "A".."Z", "AA".. like ETABS grid labels. */
function letters(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/**
 * Generates a plausible reinforced-concrete frame building: columns on every grid
 * intersection, beams on every grid line, a slab per bay, a C-shaped core of walls in
 * one interior bay, and X-bracing in one end bay. Deterministic for given options.
 */
export function createSampleModel(options: SampleModelOptions = {}): SampleModel {
  const baysX = options.baysX ?? 4;
  const baysY = options.baysY ?? 3;
  const storyCount = options.stories ?? 6;
  const bayX = options.bayX ?? 6;
  const bayY = options.bayY ?? 5;
  const h1 = options.firstStoryHeight ?? 4.5;
  const h = options.typicalStoryHeight ?? 3.5;
  if (baysX < 1 || baysY < 1 || storyCount < 1) throw new Error("baysX, baysY and stories must be >= 1");

  const units = { name: "kN_m_C", force: "kN", length: "m", temperature: "C" };

  const stories: Story[] = [];
  let elevation = 0;
  for (let s = 1; s <= storyCount; s++) {
    const height = s === 1 ? h1 : h;
    elevation = round(elevation + height);
    stories.push({
      name: `Story${s}`,
      elevation,
      height,
      isMaster: s === 1 || s === 2,
      similarTo: s > 2 ? "Story2" : null,
      spliceAbove: false,
      spliceHeight: 0,
      color: STORY_COLORS[(s - 1) % STORY_COLORS.length] ?? "#808080",
    });
  }
  const levels = [{ name: "Base", elevation: 0 }, ...stories.map((s) => ({ name: s.name, elevation: s.elevation }))];

  const xLines: GridLine[] = Array.from({ length: baysX + 1 }, (_, i) => ({
    id: letters(i),
    ordinate: i * bayX,
    visible: true,
    bubbleLocation: "End",
  }));
  const yLines: GridLine[] = Array.from({ length: baysY + 1 }, (_, j) => ({
    id: String(j + 1),
    ordinate: j * bayY,
    visible: true,
    bubbleLocation: "Start",
  }));

  // Joints: one per grid intersection per level. Labels repeat per story, names are unique.
  const joints: Joint[] = [];
  const jointAt = new Map<string, Joint>();
  const key = (i: number, j: number, level: number) => `${i}:${j}:${level}`;
  let jointName = 1;
  levels.forEach((level, l) => {
    let label = 1;
    for (let j = 0; j <= baysY; j++) {
      for (let i = 0; i <= baysX; i++) {
        const joint: Joint = {
          name: String(jointName++),
          label: String(label++),
          story: level.name,
          x: i * bayX,
          y: j * bayY,
          z: level.elevation,
          restraints: l === 0 ? [true, true, true, true, true, true] : [false, false, false, false, false, false],
        };
        joints.push(joint);
        jointAt.set(key(i, j, l), joint);
      }
    }
  });
  const J = (i: number, j: number, l: number): Joint => {
    const joint = jointAt.get(key(i, j, l));
    if (!joint) throw new Error(`no joint ${i},${j},${l}`);
    return joint;
  };

  const frames: FrameMember[] = [];
  let frameName = 1;
  const addFrame = (type: FrameMember["type"], label: string, section: string, story: string, a: Joint, b: Joint) => {
    frames.push({
      name: String(frameName++),
      label,
      story,
      section,
      type,
      joint1: a.name,
      joint2: b.name,
      start: { x: a.x, y: a.y, z: a.z },
      end: { x: b.x, y: b.y, z: b.z },
      angle: 0,
      cardinalPoint: type === "Beam" ? 8 : 10,
    });
  };

  const areas: AreaObject[] = [];
  let areaName = 1;
  const addArea = (type: AreaObject["type"], label: string, section: string, story: string, corners: Joint[]) => {
    areas.push({
      name: String(areaName++),
      label,
      story,
      section,
      type,
      joints: corners.map((c) => c.name),
      points: corners.map((c) => ({ x: c.x, y: c.y, z: c.z })),
    });
  };

  const coreI = Math.floor(baysX / 2);
  const coreJ = Math.floor(baysY / 2);

  for (let l = 1; l < levels.length; l++) {
    const story = levels[l]!.name;
    const lower = storyCount - l < 2 ? "C400" : "C600"; // top two stories use smaller columns
    let c = 1;
    let b = 1;
    let f = 1;
    let w = 1;
    let d = 1;

    for (let j = 0; j <= baysY; j++) {
      for (let i = 0; i <= baysX; i++) {
        addFrame("Column", `C${c++}`, lower, story, J(i, j, l - 1), J(i, j, l));
      }
    }
    for (let j = 0; j <= baysY; j++) {
      for (let i = 0; i < baysX; i++) {
        const edge = j === 0 || j === baysY;
        addFrame("Beam", `B${b++}`, edge ? "B300x600" : "B300x500", story, J(i, j, l), J(i + 1, j, l));
      }
    }
    for (let i = 0; i <= baysX; i++) {
      for (let j = 0; j < baysY; j++) {
        const edge = i === 0 || i === baysX;
        addFrame("Beam", `B${b++}`, edge ? "B300x600" : "B300x500", story, J(i, j, l), J(i, j + 1, l));
      }
    }
    // X-bracing in the first bay of the front face.
    addFrame("Brace", `D${d++}`, "HSS200x10", story, J(0, 0, l - 1), J(1, 0, l));
    addFrame("Brace", `D${d++}`, "HSS200x10", story, J(1, 0, l - 1), J(0, 0, l));

    for (let j = 0; j < baysY; j++) {
      for (let i = 0; i < baysX; i++) {
        addArea("Floor", `F${f++}`, "Slab200", story, [J(i, j, l), J(i + 1, j, l), J(i + 1, j + 1, l), J(i, j + 1, l)]);
      }
    }
    // C-shaped core: three walls around bay (coreI, coreJ).
    const wall = (a: [number, number], bb: [number, number]) =>
      addArea("Wall", `W${w++}`, "Wall250", story, [J(a[0], a[1], l - 1), J(bb[0], bb[1], l - 1), J(bb[0], bb[1], l), J(a[0], a[1], l)]);
    if (baysX >= 1 && baysY >= 1) {
      wall([coreI, coreJ], [Math.min(coreI + 1, baysX), coreJ]);
      wall([coreI, coreJ], [coreI, Math.min(coreJ + 1, baysY)]);
      wall([Math.min(coreI + 1, baysX), coreJ], [Math.min(coreI + 1, baysX), Math.min(coreJ + 1, baysY)]);
    }
  }

  const geometry: GeometrySnapshot = {
    model: {
      fileName: "SampleTower.EDB",
      filePath: "C:\\Models\\SampleTower.EDB",
      etabsVersion: "22.0.0 (mock)",
      etabsVersionNumber: 22,
      isLocked: false,
      units,
      processId: options.processId ?? process.pid,
      bridgeVersion: "0.2.0-mock",
    },
    units,
    baseElevation: 0,
    stories,
    gridSystems: [{ name: "G1", type: "Cartesian", originX: 0, originY: 0, rotationDeg: 0, xLines, yLines }],
    joints,
    frames,
    areas,
  };

  const tableData = new Map<string, Omit<TableData, "totalRows" | "offset" | "group">>();
  tableData.set("Story Definitions", {
    key: "Story Definitions",
    version: 1,
    fields: ["Tower", "Story", "Height", "Master Story", "Similar To", "Splice Story"],
    rows: [...stories].reverse().map((s) => ["T1", s.name, String(s.height), s.isMaster ? "Yes" : "No", s.similarTo ?? "None", "No"]),
  });
  tableData.set("Frame Assignments - Section Properties", {
    key: "Frame Assignments - Section Properties",
    version: 1,
    fields: ["Story", "Label", "UniqueName", "Shape", "Section Property"],
    rows: frames.map((fr) => [fr.story, fr.label, fr.name, fr.type === "Brace" ? "Steel Tube" : "Concrete Rectangular", fr.section]),
  });
  tableData.set("Area Assignments - Section Properties", {
    key: "Area Assignments - Section Properties",
    version: 1,
    fields: ["Story", "Label", "UniqueName", "Section Property"],
    rows: areas.map((a) => [a.story, a.label, a.name, a.section]),
  });
  tableData.set("Point Object Connectivity", {
    key: "Point Object Connectivity",
    version: 1,
    fields: ["UniqueName", "Story", "Label", "X", "Y", "Z"],
    rows: joints.map((jt) => [jt.name, jt.story, jt.label, String(jt.x), String(jt.y), String(jt.z)]),
  });

  const tables: TableInfo[] = [
    ...[...tableData.keys()].map((k) => ({ key: k, name: k, importType: 3, isEmpty: false })),
    { key: "Joint Reactions", name: "Joint Reactions", importType: 0, isEmpty: true },
    { key: "Story Drifts", name: "Story Drifts", importType: 0, isEmpty: true },
  ];

  return { geometry, sections: sampleSections(units), tables, tableData };
}

const props = (b: number, d: number) => {
  const area = b * d;
  const i33 = (b * d ** 3) / 12;
  const i22 = (d * b ** 3) / 12;
  return {
    area,
    as2: (area * 5) / 6,
    as3: (area * 5) / 6,
    torsion: 0.141 * Math.max(b, d) * Math.min(b, d) ** 3,
    i22,
    i33,
    s22: i22 / (b / 2),
    s33: i33 / (d / 2),
    z22: (d * b ** 2) / 4,
    z33: (b * d ** 2) / 4,
    r22: Math.sqrt(i22 / area),
    r33: Math.sqrt(i33 / area),
  };
};

/** Sections and materials used by createSampleModel (kN, m). */
function sampleSections(units: SectionsResult["units"]): SectionsResult {
  const rect = (name: string, b: number, d: number) => ({
    name,
    shape: "Rectangular" as const,
    etabsType: "Rectangular",
    material: "C35",
    color: "#a0a0a0",
    depth: d,
    width: b,
    flangeThickness: null,
    webThickness: null,
    bottomWidth: null,
    bottomFlangeThickness: null,
    properties: props(b, d),
  });
  return {
    units,
    materials: [
      { name: "C35", type: "Concrete", color: "#a0a0a0", e: 29_580_000, poisson: 0.2, thermalCoefficient: 1e-5, unitWeight: 25, fc: 35_000, fy: null, fu: null },
      { name: "HRB500", type: "Rebar", color: "#b05050", e: 200_000_000, poisson: null, thermalCoefficient: 1.17e-5, unitWeight: 76.98, fc: null, fy: 500_000, fu: 545_000 },
      { name: "S355", type: "Steel", color: "#4a7fb5", e: 200_000_000, poisson: 0.3, thermalCoefficient: 1.17e-5, unitWeight: 76.98, fc: null, fy: 355_000, fu: 490_000 },
    ],
    frameSections: [
      rect("C600", 0.6, 0.6),
      rect("C400", 0.4, 0.4),
      rect("B300x600", 0.3, 0.6),
      rect("B300x500", 0.3, 0.5),
      {
        name: "HSS200x10",
        shape: "Box",
        etabsType: "Box",
        material: "S355",
        color: "#4a7fb5",
        depth: 0.2,
        width: 0.2,
        flangeThickness: 0.01,
        webThickness: 0.01,
        bottomWidth: null,
        bottomFlangeThickness: null,
        properties: { ...props(0.2, 0.2), area: 0.2 * 0.2 - 0.18 * 0.18 },
      },
    ],
    areaSections: [
      { name: "Slab200", kind: "Slab", subType: "Slab", shellType: "ShellThin", material: "C35", thickness: 0.2, color: "#9fb8c8" },
      { name: "Wall250", kind: "Wall", subType: "Specified", shellType: "ShellThin", material: "C35", thickness: 0.25, color: "#c8a46a" },
    ],
    warnings: [],
  };
}
