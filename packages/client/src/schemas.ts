/**
 * zod schemas for the ETABS Bridge REST API v1.
 *
 * Source of truth for TypeScript consumers (web app, MCP server, mock bridge).
 * Must match the C# DTOs in plugin/src/EtabsBridge.Core/Model/*.cs; both sides are
 * checked against contract/fixtures/*.json in CI.
 *
 * Objects are non-strict (unknown keys are kept, not rejected) so that a newer bridge
 * adding fields (a MINOR version bump) does not break older clients.
 */
import { z } from "zod";

export const UnitsInfoSchema = z.object({
  /** ETABS eUnits name, e.g. "kN_m_C". */
  name: z.string(),
  force: z.string(),
  length: z.string(),
  temperature: z.string(),
});

export const Point3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

export const HealthSchema = z.object({
  status: z.literal("ok"),
  bridgeVersion: z.string(),
  apiVersion: z.string(),
  processId: z.number().int(),
});

export const ModelInfoSchema = z.object({
  fileName: z.string(),
  filePath: z.string(),
  etabsVersion: z.string(),
  etabsVersionNumber: z.number(),
  isLocked: z.boolean(),
  units: UnitsInfoSchema,
  processId: z.number().int(),
  bridgeVersion: z.string(),
});

export const StorySchema = z.object({
  name: z.string(),
  /** Elevation of the story's floor level (top of the story). */
  elevation: z.number(),
  height: z.number(),
  isMaster: z.boolean(),
  similarTo: z.string().nullable(),
  spliceAbove: z.boolean(),
  spliceHeight: z.number(),
  /** "#rrggbb" */
  color: z.string(),
});

export const StoriesResultSchema = z.object({
  units: UnitsInfoSchema,
  baseElevation: z.number(),
  /** Bottom to top; the base level is not a story. */
  stories: z.array(StorySchema),
});

export const GridLineSchema = z.object({
  id: z.string(),
  ordinate: z.number(),
  visible: z.boolean(),
  bubbleLocation: z.string(),
});

export const GridSystemSchema = z.object({
  name: z.string(),
  type: z.string(),
  originX: z.number(),
  originY: z.number(),
  rotationDeg: z.number(),
  xLines: z.array(GridLineSchema),
  yLines: z.array(GridLineSchema),
});

export const GridsResultSchema = z.object({
  units: UnitsInfoSchema,
  gridSystems: z.array(GridSystemSchema),
});

export const JointSchema = z.object({
  name: z.string(),
  label: z.string(),
  story: z.string(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  /** [UX, UY, UZ, RX, RY, RZ] */
  restraints: z.array(z.boolean()).length(6),
});

export const JointsResultSchema = z.object({
  units: UnitsInfoSchema,
  joints: z.array(JointSchema),
});

export const FRAME_TYPES = ["Column", "Beam", "Brace", "Null", "Other"] as const;
export const FrameTypeSchema = z.enum(FRAME_TYPES);

export const FrameMemberSchema = z.object({
  name: z.string(),
  label: z.string(),
  story: z.string(),
  section: z.string(),
  type: FrameTypeSchema,
  joint1: z.string(),
  joint2: z.string(),
  start: Point3Schema,
  end: Point3Schema,
  angle: z.number(),
  cardinalPoint: z.number().int(),
});

export const FramesResultSchema = z.object({
  units: UnitsInfoSchema,
  frames: z.array(FrameMemberSchema),
});

export const AREA_TYPES = ["Wall", "Floor", "Ramp", "Null", "Other"] as const;
export const AreaTypeSchema = z.enum(AREA_TYPES);

export const AreaObjectSchema = z.object({
  name: z.string(),
  label: z.string(),
  story: z.string(),
  section: z.string(),
  type: AreaTypeSchema,
  joints: z.array(z.string()),
  points: z.array(Point3Schema),
});

export const AreasResultSchema = z.object({
  units: UnitsInfoSchema,
  areas: z.array(AreaObjectSchema),
});

export const GeometrySnapshotSchema = z.object({
  model: ModelInfoSchema,
  units: UnitsInfoSchema,
  baseElevation: z.number(),
  stories: z.array(StorySchema),
  gridSystems: z.array(GridSystemSchema),
  joints: z.array(JointSchema),
  frames: z.array(FrameMemberSchema),
  areas: z.array(AreaObjectSchema),
});

// ---- Sections & materials (0.2.0). Values ETABS could not provide are null.

export const MATERIAL_TYPES = ["Concrete", "Steel", "Rebar", "Tendon", "Aluminum", "ColdFormed", "Masonry", "NoDesign", "Other"] as const;

export const MaterialSchema = z.object({
  name: z.string(),
  type: z.enum(MATERIAL_TYPES),
  color: z.string(),
  /** Modulus of elasticity (force/length²). */
  e: z.number().nullable(),
  poisson: z.number().nullable(),
  thermalCoefficient: z.number().nullable(),
  /** Weight per unit volume (force/length³). */
  unitWeight: z.number().nullable(),
  /** Concrete f'c (force/length²). */
  fc: z.number().nullable(),
  fy: z.number().nullable(),
  fu: z.number().nullable(),
});

export const SectionPropertiesSchema = z.object({
  area: z.number(),
  as2: z.number(),
  as3: z.number(),
  torsion: z.number(),
  i22: z.number(),
  i33: z.number(),
  s22: z.number(),
  s33: z.number(),
  z22: z.number(),
  z33: z.number(),
  r22: z.number(),
  r33: z.number(),
});

export const FRAME_SHAPES = [
  "Rectangular",
  "Circle",
  "I",
  "Box",
  "Pipe",
  "Tee",
  "Angle",
  "Channel",
  "DoubleAngle",
  "DoubleChannel",
  "SectionDesigner",
  "Nonprismatic",
  "AutoSelect",
  "General",
  "Other",
] as const;

export const FrameSectionSchema = z.object({
  name: z.string(),
  shape: z.enum(FRAME_SHAPES),
  etabsType: z.string(),
  material: z.string(),
  color: z.string(),
  /** t3, along local axis 2 (diameter for circles/pipes). */
  depth: z.number().nullable(),
  /** t2, along local axis 3. */
  width: z.number().nullable(),
  flangeThickness: z.number().nullable(),
  webThickness: z.number().nullable(),
  bottomWidth: z.number().nullable(),
  bottomFlangeThickness: z.number().nullable(),
  properties: SectionPropertiesSchema.nullable(),
});

export const AREA_SECTION_KINDS = ["Slab", "Wall", "Deck", "Other"] as const;

export const AreaSectionSchema = z.object({
  name: z.string(),
  kind: z.enum(AREA_SECTION_KINDS),
  subType: z.string(),
  shellType: z.string(),
  material: z.string(),
  thickness: z.number().nullable(),
  color: z.string(),
});

export const SectionsResultSchema = z.object({
  units: UnitsInfoSchema,
  materials: z.array(MaterialSchema),
  frameSections: z.array(FrameSectionSchema),
  areaSections: z.array(AreaSectionSchema),
  /** API calls that were unavailable or failed (affected values are null). */
  warnings: z.array(z.string()),
});

// ---- Loads (0.5.0). Values in the model's present units.

export const LoadPatternSchema = z.object({ name: z.string(), type: z.string(), selfWeightMultiplier: z.number().nullable() });
export const LoadCaseSchema = z.object({ name: z.string(), type: z.string(), subType: z.number().int().nullable() });
export const CombinationItemSchema = z.object({ kind: z.enum(["LoadCase", "LoadCombo"]), name: z.string(), factor: z.number() });
export const LoadCombinationSchema = z.object({ name: z.string(), type: z.string(), items: z.array(CombinationItemSchema) });
export const FrameDistributedLoadSchema = z.object({
  frame: z.string(),
  pattern: z.string(),
  loadType: z.enum(["Force", "Moment"]),
  cSys: z.string(),
  /** 1-3 local, 4-6 global X/Y/Z, 7-9 projected X/Y/Z, 10 gravity, 11 projected gravity. */
  direction: z.number().int(),
  relativeStart: z.number(),
  relativeEnd: z.number(),
  distanceStart: z.number(),
  distanceEnd: z.number(),
  valueStart: z.number(),
  valueEnd: z.number(),
});
export const FramePointLoadSchema = z.object({
  frame: z.string(),
  pattern: z.string(),
  loadType: z.enum(["Force", "Moment"]),
  cSys: z.string(),
  direction: z.number().int(),
  relativeDistance: z.number(),
  distance: z.number(),
  value: z.number(),
});
export const AreaUniformLoadSchema = z.object({ area: z.string(), pattern: z.string(), cSys: z.string(), direction: z.number().int(), value: z.number() });
export const JointLoadSchema = z.object({
  joint: z.string(),
  pattern: z.string(),
  cSys: z.string(),
  f1: z.number(),
  f2: z.number(),
  f3: z.number(),
  m1: z.number(),
  m2: z.number(),
  m3: z.number(),
});
export const LoadsResultSchema = z.object({
  units: UnitsInfoSchema,
  patterns: z.array(LoadPatternSchema),
  cases: z.array(LoadCaseSchema),
  combinations: z.array(LoadCombinationSchema),
  frameDistributed: z.array(FrameDistributedLoadSchema),
  framePoint: z.array(FramePointLoadSchema),
  areaUniform: z.array(AreaUniformLoadSchema),
  jointLoads: z.array(JointLoadSchema),
  warnings: z.array(z.string()),
});

export const TableInfoSchema = z.object({
  key: z.string(),
  name: z.string(),
  importType: z.number().int(),
  isEmpty: z.boolean(),
});

export const TablesResultSchema = z.object({
  tables: z.array(TableInfoSchema),
});

export const TableDataSchema = z.object({
  key: z.string(),
  version: z.number().int(),
  group: z.string(),
  fields: z.array(z.string()),
  totalRows: z.number().int(),
  offset: z.number().int(),
  rows: z.array(z.array(z.string())),
});

export const ApiCallResultSchema = z.object({
  method: z.string(),
  returnValue: z.unknown(),
  outputs: z.record(z.string(), z.unknown()),
});

export const ApiParameterDescriptionSchema = z.object({
  name: z.string(),
  type: z.string(),
  direction: z.enum(["in", "ref", "out"]),
  optional: z.boolean(),
  enumValues: z.array(z.string()).nullable(),
});

export const ApiMethodDescriptionSchema = z.object({
  name: z.string(),
  returnType: z.string(),
  readOnly: z.boolean(),
  parameters: z.array(ApiParameterDescriptionSchema),
});

export const ApiTypeDescriptionSchema = z.object({
  path: z.string(),
  type: z.string(),
  objects: z.array(z.string()),
  methods: z.array(ApiMethodDescriptionSchema),
});

export const ErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export type UnitsInfo = z.infer<typeof UnitsInfoSchema>;
export type Point3 = z.infer<typeof Point3Schema>;
export type Health = z.infer<typeof HealthSchema>;
export type ModelInfo = z.infer<typeof ModelInfoSchema>;
export type Story = z.infer<typeof StorySchema>;
export type StoriesResult = z.infer<typeof StoriesResultSchema>;
export type GridLine = z.infer<typeof GridLineSchema>;
export type GridSystem = z.infer<typeof GridSystemSchema>;
export type GridsResult = z.infer<typeof GridsResultSchema>;
export type Joint = z.infer<typeof JointSchema>;
export type JointsResult = z.infer<typeof JointsResultSchema>;
export type FrameType = z.infer<typeof FrameTypeSchema>;
export type FrameMember = z.infer<typeof FrameMemberSchema>;
export type FramesResult = z.infer<typeof FramesResultSchema>;
export type AreaType = z.infer<typeof AreaTypeSchema>;
export type AreaObject = z.infer<typeof AreaObjectSchema>;
export type AreasResult = z.infer<typeof AreasResultSchema>;
export type GeometrySnapshot = z.infer<typeof GeometrySnapshotSchema>;
export type MaterialType = z.infer<typeof MaterialSchema>["type"];
export type Material = z.infer<typeof MaterialSchema>;
export type SectionProperties = z.infer<typeof SectionPropertiesSchema>;
export type FrameShape = z.infer<typeof FrameSectionSchema>["shape"];
export type FrameSection = z.infer<typeof FrameSectionSchema>;
export type AreaSection = z.infer<typeof AreaSectionSchema>;
export type SectionsResult = z.infer<typeof SectionsResultSchema>;
export type LoadPattern = z.infer<typeof LoadPatternSchema>;
export type LoadCase = z.infer<typeof LoadCaseSchema>;
export type LoadCombination = z.infer<typeof LoadCombinationSchema>;
export type FrameDistributedLoad = z.infer<typeof FrameDistributedLoadSchema>;
export type FramePointLoad = z.infer<typeof FramePointLoadSchema>;
export type AreaUniformLoad = z.infer<typeof AreaUniformLoadSchema>;
export type JointLoad = z.infer<typeof JointLoadSchema>;
export type LoadsResult = z.infer<typeof LoadsResultSchema>;
export type TableInfo = z.infer<typeof TableInfoSchema>;
export type TablesResult = z.infer<typeof TablesResultSchema>;
export type TableData = z.infer<typeof TableDataSchema>;
export type ApiCallResult = z.infer<typeof ApiCallResultSchema>;
export type ApiParameterDescription = z.infer<typeof ApiParameterDescriptionSchema>;
export type ApiMethodDescription = z.infer<typeof ApiMethodDescriptionSchema>;
export type ApiTypeDescription = z.infer<typeof ApiTypeDescriptionSchema>;
export type ErrorBody = z.infer<typeof ErrorBodySchema>;
