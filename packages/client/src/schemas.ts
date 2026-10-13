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
export type TableInfo = z.infer<typeof TableInfoSchema>;
export type TablesResult = z.infer<typeof TablesResultSchema>;
export type TableData = z.infer<typeof TableDataSchema>;
export type ApiCallResult = z.infer<typeof ApiCallResultSchema>;
export type ApiParameterDescription = z.infer<typeof ApiParameterDescriptionSchema>;
export type ApiMethodDescription = z.infer<typeof ApiMethodDescriptionSchema>;
export type ApiTypeDescription = z.infer<typeof ApiTypeDescriptionSchema>;
export type ErrorBody = z.infer<typeof ErrorBodySchema>;
