import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  AREA_TYPES,
  BOQ_NOTES,
  DEFAULT_QUANTITY_SETTINGS,
  ELEMENT_CATEGORIES,
  buildBoq,
  computeElementQuantities,
  costCurve,
  defaultScheduleSettings,
  describeCombination,
  designRebarKg,
  driftProfile,
  generateSchedule,
  isoFromTime,
  loadTakedown,
  scheduleSpan,
  taskCosts,
  defaultRateTable,
  priceBoq,
  summarizeCost,
  BridgeError,
  FRAME_TYPES,
  summarizeGeometry,
  type AreaObject,
  type BridgeClient,
  type FrameMember,
  type Joint,
} from "@etabs-bridge/client";
import { ConnectionError, type ConnectionResolver } from "./connection.js";

export const SERVER_NAME = "etabs-bridge";
export const SERVER_VERSION = "0.6.1";

export interface ServerOptions {
  resolver: ConnectionResolver;
  /** How long list reads (joints/frames/areas) are reused across paging calls. Default 15 s; 0 disables. */
  cacheSeconds?: number;
}

const instance = z
  .number()
  .int()
  .positive()
  .optional()
  .describe("ETABS process ID from etabs_list_instances. Needed only when several models are open.");
const offset = z.number().int().min(0).default(0).describe("Index of the first item to return.");
const limit = (max: number, dflt: number) => z.number().int().min(1).max(max).default(dflt).describe(`Items per page (max ${max}).`);
const story = z.string().optional().describe('Only objects on this story, e.g. "Story3".');

const cases = z.array(z.string()).optional().describe("Load case names (see etabs_get_analysis_status).");
const combos = z.array(z.string()).optional().describe("Load combination names.");

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

/** One page of a list, with what the caller needs to fetch the next one. */
function page<T>(items: T[], from: number, size: number) {
  const slice = items.slice(from, from + size);
  return {
    total: items.length,
    offset: from,
    returned: slice.length,
    nextOffset: from + slice.length < items.length ? from + slice.length : null,
    items: slice,
  };
}

function ok(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function fail(err: unknown): CallToolResult {
  let text: string;
  if (err instanceof BridgeError) text = `${err.code}: ${err.message}`;
  else if (err instanceof ConnectionError) text = err.message;
  else text = `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
  return { isError: true, content: [{ type: "text", text }] };
}

/** Wraps a handler so bridge/connection failures become MCP tool errors the model can read. */
function safe<A>(handler: (args: A) => Promise<unknown>): (args: A) => Promise<CallToolResult> {
  return async (args: A) => {
    try {
      return ok(await handler(args));
    } catch (err) {
      return fail(err);
    }
  };
}

/** Builds the MCP server. Transport-agnostic: main.ts connects stdio, tests use in-memory. */
export function createEtabsMcpServer(options: ServerOptions): McpServer {
  const { resolver } = options;
  const ttlMs = (options.cacheSeconds ?? 15) * 1000;
  const cache = new Map<string, { expires: number; value: Promise<unknown> }>();

  /** Short-lived cache so paging through a large list does not re-read ETABS every call. */
  function cached<T>(client: BridgeClient, name: string, load: () => Promise<T>): Promise<T> {
    if (ttlMs <= 0) return load();
    const key = `${client.baseUrl}|${name}`;
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value as Promise<T>;
    const value = load();
    cache.set(key, { expires: Date.now() + ttlMs, value });
    value.catch(() => cache.delete(key));
    return value;
  }

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Reads live ETABS structural models through the ETABS Bridge plugin. Start with etabs_get_geometry_summary; " +
        "use the paged list tools for details, etabs_list_tables/etabs_get_table for any ETABS database table " +
        "(assignments, loads, results), and etabs_describe_api/etabs_call_api for anything else in the CSI API. " +
        "All lengths/forces are in the model's present units (see 'units').",
    },
  );

  server.registerTool(
    "etabs_list_instances",
    {
      title: "List open ETABS models",
      description: "Lists ETABS instances that are running the ETABS Bridge plugin, with process ID and model path.",
      annotations: READ_ONLY,
    },
    async () => {
      try {
        return ok(
          resolver.instances().map(({ token: _token, ...rest }) => rest), // never expose tokens to the model
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "etabs_get_model_info",
    {
      title: "Model info",
      description: "File name/path, ETABS version, lock state and present units of the model.",
      inputSchema: { instance },
      annotations: READ_ONLY,
    },
    safe(async ({ instance: pid }) => resolver.client(pid).model()),
  );

  server.registerTool(
    "etabs_get_geometry_summary",
    {
      title: "Geometry summary",
      description:
        "Compact overview: object counts by type and story, frame/area sections in use, supports and bounding box. Best first call.",
      inputSchema: { instance },
      annotations: READ_ONLY,
    },
    safe(async ({ instance: pid }) => {
      const client = resolver.client(pid);
      return summarizeGeometry(await cached(client, "geometry", () => client.geometry()));
    }),
  );

  server.registerTool(
    "etabs_get_stories",
    {
      title: "Stories",
      description: "Story names, elevations and heights (bottom to top), master/similar stories, base elevation.",
      inputSchema: { instance },
      annotations: READ_ONLY,
    },
    safe(async ({ instance: pid }) => resolver.client(pid).stories()),
  );

  server.registerTool(
    "etabs_get_grids",
    {
      title: "Grid systems",
      description: "Grid systems with origin, rotation and X/Y grid lines (ID and ordinate).",
      inputSchema: { instance },
      annotations: READ_ONLY,
    },
    safe(async ({ instance: pid }) => resolver.client(pid).grids()),
  );

  server.registerTool(
    "etabs_get_joints",
    {
      title: "Joints",
      description: "Joints (point objects) with coordinates and restraints [UX,UY,UZ,RX,RY,RZ], paged.",
      inputSchema: {
        instance,
        story,
        supportsOnly: z.boolean().default(false).describe("Only joints with at least one restraint."),
        offset,
        limit: limit(1000, 200),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ instance: pid, story: s, supportsOnly, offset: o, limit: l }) => {
      const client = resolver.client(pid);
      const { units, joints } = await cached(client, "joints", () => client.joints());
      const filtered = joints.filter((j: Joint) => (!s || j.story === s) && (!supportsOnly || j.restraints.some(Boolean)));
      return { units, ...page(filtered, o, l) };
    }),
  );

  server.registerTool(
    "etabs_get_frames",
    {
      title: "Frames",
      description: "Frame objects (columns, beams, braces) with section, end joints and coordinates, paged and filterable.",
      inputSchema: {
        instance,
        story,
        type: z.enum(FRAME_TYPES).optional().describe("Design orientation filter."),
        section: z.string().optional().describe("Only frames with this section property."),
        offset,
        limit: limit(1000, 200),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ instance: pid, story: s, type, section, offset: o, limit: l }) => {
      const client = resolver.client(pid);
      const { units, frames } = await cached(client, "frames", () => client.frames());
      const filtered = frames.filter((f: FrameMember) => (!s || f.story === s) && (!type || f.type === type) && (!section || f.section === section));
      return { units, ...page(filtered, o, l) };
    }),
  );

  server.registerTool(
    "etabs_get_areas",
    {
      title: "Areas",
      description: "Area objects (floors, walls, ramps) with section and boundary coordinates, paged and filterable.",
      inputSchema: {
        instance,
        story,
        type: z.enum(AREA_TYPES).optional().describe("Design orientation filter."),
        section: z.string().optional().describe("Only areas with this section property."),
        offset,
        limit: limit(500, 100),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ instance: pid, story: s, type, section, offset: o, limit: l }) => {
      const client = resolver.client(pid);
      const { units, areas } = await cached(client, "areas", () => client.areas());
      const filtered = areas.filter((a: AreaObject) => (!s || a.story === s) && (!type || a.type === type) && (!section || a.section === section));
      return { units, ...page(filtered, o, l) };
    }),
  );

  server.registerTool(
    "etabs_get_sections",
    {
      title: "Sections and materials",
      description:
        "Materials (type, E, unit weight, f'c, Fy, Fu), frame sections (shape, material, depth/width/flange/web dimensions, " +
        "section properties) and area sections (slab/wall/deck, thickness, material). Values ETABS could not provide are null; " +
        "'warnings' lists why.",
      inputSchema: {
        instance,
        include: z
          .enum(["all", "materials", "frameSections", "areaSections"])
          .default("all")
          .describe("Limit the output to one list."),
        search: z.string().optional().describe("Case-insensitive name filter, e.g. \"C600\" or \"slab\"."),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ instance: pid, include, search }) => {
      const client = resolver.client(pid);
      const all = await cached(client, "sections", () => client.sections());
      const q = (search ?? "").toLowerCase();
      const match = <T extends { name: string }>(items: T[]) => (q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items);
      return {
        units: all.units,
        ...(include === "all" || include === "materials" ? { materials: match(all.materials) } : {}),
        ...(include === "all" || include === "frameSections" ? { frameSections: match(all.frameSections) } : {}),
        ...(include === "all" || include === "areaSections" ? { areaSections: match(all.areaSections) } : {}),
        warnings: all.warnings,
      };
    }),
  );

  server.registerTool(
    "etabs_get_boq",
    {
      title: "Bill of quantities and cost (5D)",
      description:
        "Quantity take-off from the live model: concrete m³ by grade and element type, formwork m², reinforcement kg " +
        "(kg/m³ ratios, overridable), structural steel t; optionally per story. Priced with the given rates, or with clearly " +
        "marked SAMPLE rates when none are given (state that to the user). Gross centre-line quantities; see 'notes'.",
      inputSchema: {
        instance,
        groupBy: z.enum(["item", "story"]).default("item").describe("Aggregate per BOQ item, or per item and story."),
        rebarRatios: z
          .partialRecord(z.enum(ELEMENT_CATEGORIES), z.number().min(0).max(1000))
          .optional()
          .describe("kg of rebar per m³ of concrete by element type, e.g. {\"Column\":200}. Others keep defaults."),
        rates: z
          .record(z.string(), z.number().min(0))
          .optional()
          .describe("Unit rates by rate key (concrete:<grade>, formwork:<Column|Beam|Slab|Wall|Brace|Other>, rebar, steel:<grade>)."),
        currency: z.string().regex(/^[A-Za-z]{3}$/).optional().describe("ISO currency code for the given rates, e.g. INR."),
        useDesignRebar: z
          .boolean()
          .default(false)
          .describe("Use ETABS concrete design required steel for designed frames (needs an analysed and designed model); ratios elsewhere."),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ instance: pid, groupBy, rebarRatios, rates, currency, useDesignRebar }) => {
      const client = resolver.client(pid);
      const [geometry, sections] = await Promise.all([
        cached(client, "geometry", () => client.geometry()),
        cached(client, "sections", () => client.sections()),
      ]);
      const settings = { ...DEFAULT_QUANTITY_SETTINGS, rebarRatios: { ...DEFAULT_QUANTITY_SETTINGS.rebarRatios, ...rebarRatios } };
      const design = useDesignRebar ? designRebarKg((await client.concreteDesign()).rows, geometry, sections) : null;
      const elements = computeElementQuantities(geometry, sections, { settings, designRebarKg: design?.kgByFrame });
      const lines = buildBoq(elements, { groupBy, settings });
      const sample = defaultRateTable(lines, undefined, currency?.toUpperCase() ?? "INR");
      const table = rates
        ? { currency: currency?.toUpperCase() ?? "INR", rates: { ...Object.fromEntries(Object.keys(sample.rates).map((k) => [k, 0])), ...rates }, isSample: false }
        : sample;
      const priced = priceBoq(lines, table);
      const summary = summarizeCost(priced, elements, table);
      const issues = elements.filter((e) => e.issue).map((e) => ({ object: `${e.kind} ${e.name}`, issue: e.issue }));
      return {
        model: geometry.model.fileName,
        ratesAreSamples: table.isSample,
        currency: table.currency,
        rebarRatios: settings.rebarRatios,
        lines: priced.map((l) => ({ ...l, quantity: Math.round(l.quantity * 1000) / 1000, amount: Math.round(l.amount * 100) / 100 })),
        summary,
        unmeasured: issues.slice(0, 50),
        unmeasuredCount: issues.length,
        rebarFromDesign: design ? { frames: design.kgByFrame.size, withoutShearEstimate: design.withoutShear.length } : null,
        notes: BOQ_NOTES,
      };
    }),
  );

  server.registerTool(
    "etabs_generate_schedule",
    {
      title: "4D construction schedule",
      description:
        "Generates a story-by-story construction schedule from the live model (columns & walls, then beams & slab, per story) " +
        "on a working-day calendar, with planned cost per task and a weekly cumulative cost curve (sample rates unless given). " +
        "This is a planning baseline, not a CPM schedule.",
      inputSchema: {
        instance,
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD; default today."),
        verticalDays: z.number().int().min(1).max(365).default(5).describe("Working days for columns & walls per story."),
        horizontalDays: z.number().int().min(1).max(365).default(7).describe("Working days for beams & slab per story."),
        lagDays: z.number().int().min(0).max(365).default(2).describe("Working days between floors."),
        workingWeekdays: z.array(z.number().int().min(0).max(6)).min(1).default([1, 2, 3, 4, 5, 6]).describe("0=Sun ... 6=Sat."),
        holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).default([]),
        rates: z.record(z.string(), z.number().min(0)).optional().describe("Unit rates as in etabs_get_boq; omit for sample rates."),
        currency: z.string().regex(/^[A-Za-z]{3}$/).optional(),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ instance: pid, startDate, verticalDays, horizontalDays, lagDays, workingWeekdays, holidays, rates, currency }) => {
      const client = resolver.client(pid);
      const [geometry, sections] = await Promise.all([
        cached(client, "geometry", () => client.geometry()),
        cached(client, "sections", () => client.sections()),
      ]);
      const settings = { ...defaultScheduleSettings(), ...(startDate ? { startDate } : {}), verticalDays, horizontalDays, lagDays, workingWeekdays, holidays };
      const tasks = generateSchedule(geometry, settings);
      const elements = computeElementQuantities(geometry, sections);
      const sample = defaultRateTable(buildBoq(elements), undefined, currency?.toUpperCase() ?? "INR");
      const table = rates ? { currency: currency?.toUpperCase() ?? "INR", rates, isSample: false } : sample;
      const costs = taskCosts(tasks, elements, table);
      const curve = costCurve(tasks, costs, settings);
      const weekly = curve.filter((_, i) => i % 7 === 6 || i === curve.length - 1).map((p) => ({ date: isoFromTime(p.t), cumulativeCost: Math.round(p.cumulative) }));
      return {
        model: geometry.model.fileName,
        settings,
        span: scheduleSpan(tasks),
        currency: table.currency,
        ratesAreSamples: table.isSample,
        tasks: tasks.map(({ elements: els, ...t }) => ({ ...t, objects: els.length, cost: Math.round(costs.get(t.id) ?? 0) })),
        weeklyCumulativeCost: weekly,
      };
    }),
  );

  server.registerTool(
    "etabs_get_loads",
    {
      title: "Loads",
      description:
        "Load patterns (type, self-weight multiplier), load cases, combinations (with factors) and a gravity takedown per " +
        "pattern (total assigned downward load, excluding self-weight). Set include to list assigned loads " +
        "(frame distributed/point, area uniform, joint), paged and filterable by pattern. Values in model units.",
      inputSchema: {
        instance,
        include: z
          .enum(["summary", "frameDistributed", "framePoint", "areaUniform", "jointLoads"])
          .default("summary")
          .describe("'summary' = patterns, cases, combinations, takedown; otherwise one list of assigned loads."),
        pattern: z.string().optional().describe("Only assigned loads of this pattern."),
        offset,
        limit: limit(1000, 200),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ instance: pid, include, pattern, offset: o, limit: l }) => {
      const client = resolver.client(pid);
      const loads = await cached(client, "loads", () => client.loads());
      if (include === "summary") {
        const geometry = await cached(client, "geometry", () => client.geometry());
        return {
          units: loads.units,
          patterns: loads.patterns,
          cases: loads.cases,
          combinations: loads.combinations.map((c) => ({ ...c, formula: describeCombination(c.items) })),
          gravityTakedown: loadTakedown(loads, geometry),
          assignedCounts: {
            frameDistributed: loads.frameDistributed.length,
            framePoint: loads.framePoint.length,
            areaUniform: loads.areaUniform.length,
            jointLoads: loads.jointLoads.length,
          },
          warnings: loads.warnings,
        };
      }
      const list = (loads[include] as Array<{ pattern: string }>).filter((x) => !pattern || x.pattern === pattern);
      return { units: loads.units, ...page(list, o, l) };
    }),
  );

  server.registerTool(
    "etabs_get_analysis_status",
    {
      title: "Analysis status",
      description: "Whether the model is analysed (locked), the run status of every load case, and the combination names. Call before reading results.",
      inputSchema: { instance },
      annotations: READ_ONLY,
    },
    safe(async ({ instance: pid }) => resolver.client(pid).resultsStatus()),
  );

  server.registerTool(
    "etabs_get_base_reactions",
    {
      title: "Base reactions",
      description: "Base reaction forces and moments (FX, FY, FZ, MX, MY, MZ) for the given cases/combinations. Envelopes return Max and Min steps.",
      inputSchema: { instance, cases, combos },
      annotations: READ_ONLY,
    },
    safe(async ({ instance: pid, cases: c, combos: k }) => resolver.client(pid).baseReactions({ cases: c, combos: k })),
  );

  server.registerTool(
    "etabs_get_story_drifts",
    {
      title: "Story drifts",
      description:
        "Story drift ratios. Returns the envelope per story and direction (max |drift| and the governing case) plus the overall maximum; " +
        "set includeRows for every row.",
      inputSchema: { instance, cases, combos, includeRows: z.boolean().default(false) },
      annotations: READ_ONLY,
    },
    safe(async ({ instance: pid, cases: c, combos: k, includeRows }) => {
      const client = resolver.client(pid);
      const [drifts, geometry] = await Promise.all([client.storyDrifts({ cases: c, combos: k }), cached(client, "geometry", () => client.geometry())]);
      const profile = driftProfile(drifts.rows, geometry);
      const max = profile.flatMap((p) => Object.entries(p.drift).map(([direction, drift]) => ({ story: p.story, direction, drift, governing: p.governing[direction] })));
      return {
        cases: drifts.cases,
        combinations: drifts.combinations,
        envelope: profile,
        maximum: max.reduce<(typeof max)[number] | null>((m, x) => (!m || x.drift > m.drift ? x : m), null),
        ...(includeRows ? { rows: drifts.rows } : {}),
        warnings: drifts.warnings,
      };
    }),
  );

  server.registerTool(
    "etabs_get_joint_reactions",
    {
      title: "Joint (support) reactions",
      description: "Support reactions F1-F3, M1-M3 for all supports or one joint, for the given cases/combinations; paged.",
      inputSchema: { instance, cases, combos, joint: z.string().optional().describe("One joint name; omit for all supports."), offset, limit: limit(2000, 200) },
      annotations: READ_ONLY,
    },
    safe(async ({ instance: pid, cases: c, combos: k, joint, offset: o, limit: l }) =>
      resolver.client(pid).jointReactions({ cases: c, combos: k, joint, offset: o, limit: l }),
    ),
  );

  server.registerTool(
    "etabs_get_joint_displacements",
    {
      title: "Joint displacements",
      description: "Joint displacements U1-U3 and rotations R1-R3 (global) for one joint or all joints, for the given cases/combinations; paged.",
      inputSchema: { instance, cases, combos, joint: z.string().optional(), offset, limit: limit(2000, 200) },
      annotations: READ_ONLY,
    },
    safe(async ({ instance: pid, cases: c, combos: k, joint, offset: o, limit: l }) =>
      resolver.client(pid).jointDisplacements({ cases: c, combos: k, joint, offset: o, limit: l }),
    ),
  );

  server.registerTool(
    "etabs_get_frame_forces",
    {
      title: "Frame forces",
      description: "Internal forces P, V2, V3, T, M2, M3 at output stations of one frame (recommended) or all frames (paged), for the given cases/combinations.",
      inputSchema: { instance, cases, combos, frame: z.string().optional().describe("Frame unique name; omit for all frames (large)."), offset, limit: limit(2000, 200) },
      annotations: READ_ONLY,
    },
    safe(async ({ instance: pid, cases: c, combos: k, frame, offset: o, limit: l }) =>
      resolver.client(pid).frameForces({ cases: c, combos: k, frame, offset: o, limit: l }),
    ),
  );

  server.registerTool(
    "etabs_get_concrete_design",
    {
      title: "Concrete design (required reinforcement)",
      description:
        "Required longitudinal and shear reinforcement from ETABS concrete frame design, summarised per frame (max areas, PMM ratio, " +
        "estimated required rebar kg). Needs a designed model. Set includeStations for station-by-station rows (paged).",
      inputSchema: { instance, frame: z.string().optional(), includeStations: z.boolean().default(false), offset, limit: limit(2000, 200) },
      annotations: READ_ONLY,
    },
    safe(async ({ instance: pid, frame, includeStations, offset: o, limit: l }) => {
      const client = resolver.client(pid);
      const [design, geometry, sections] = await Promise.all([
        client.concreteDesign(),
        cached(client, "geometry", () => client.geometry()),
        cached(client, "sections", () => client.sections()),
      ]);
      const rows = design.rows.filter((r) => !frame || r.frame === frame);
      if (includeStations) return { units: design.units, ...page(rows, o, l), warnings: design.warnings };
      const kg = designRebarKg(rows, geometry, sections);
      const summary = [...new Set(rows.map((r) => r.frame))].map((f) => {
        const st = rows.filter((r) => r.frame === f);
        return {
          frame: f,
          kind: st[0]!.kind,
          maxTopArea: Math.max(...st.map((r) => r.topArea ?? 0)),
          maxBottomArea: Math.max(...st.map((r) => r.bottomArea ?? 0)),
          maxLongitudinalArea: Math.max(...st.map((r) => r.longitudinalArea ?? 0)),
          maxShearAreaPerLength: Math.max(...st.map((r) => r.shearAreaPerLength ?? 0)),
          maxRatio: st.some((r) => r.ratio !== null) ? Math.max(...st.map((r) => r.ratio ?? 0)) : null,
          requiredRebarKg: Math.round((kg.kgByFrame.get(f) ?? 0) * 10) / 10,
        };
      });
      return { units: design.units, ...page(summary, o, l), warnings: design.warnings };
    }),
  );

  server.registerTool(
    "etabs_list_tables",
    {
      title: "List database tables",
      description:
        "Lists ETABS database tables (the same as Display > Show Tables): definitions, assignments, loads and analysis results. " +
        "Use a key with etabs_get_table.",
      inputSchema: {
        instance,
        search: z.string().optional().describe('Case-insensitive filter on key/name, e.g. "drift" or "frame assign".'),
        includeEmpty: z.boolean().default(false).describe("Include tables that currently have no rows."),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ instance: pid, search, includeEmpty }) => {
      const { tables } = await resolver.client(pid).tables();
      const words = (search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      return tables
        .filter((t) => includeEmpty || !t.isEmpty)
        .filter((t) => words.every((w) => `${t.key} ${t.name}`.toLowerCase().includes(w)))
        .map((t) => ({ key: t.key, isEmpty: t.isEmpty }));
    }),
  );

  server.registerTool(
    "etabs_get_table",
    {
      title: "Get database table",
      description: "Rows of one ETABS database table (all values are strings as ETABS displays them), paged.",
      inputSchema: {
        instance,
        key: z.string().min(1).describe("Table key from etabs_list_tables."),
        fields: z.array(z.string()).optional().describe("Only these field keys (columns)."),
        group: z.string().optional().describe('ETABS group to filter by (default "All").'),
        offset,
        limit: limit(2000, 100),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ instance: pid, key, fields, group, offset: o, limit: l }) => {
      const data = await resolver.client(pid).table(key, { fields, group, offset: o, limit: l });
      const next = data.offset + data.rows.length;
      return { ...data, nextOffset: next < data.totalRows ? next : null };
    }),
  );

  server.registerTool(
    "etabs_describe_api",
    {
      title: "Describe CSI API object",
      description:
        'Lists child objects and methods (with parameter names, types, ref/out direction, enum values) of a CSI API object, e.g. "" (SapModel), ' +
        '"FrameObj", "PropFrame", "LoadPatterns", "Results". Use before etabs_call_api.',
      inputSchema: { instance, path: z.string().default("").describe('Object path, "" for SapModel.') },
      annotations: READ_ONLY,
    },
    safe(async ({ instance: pid, path }) => resolver.client(pid).describe(path)),
  );

  server.registerTool(
    "etabs_call_api",
    {
      title: "Call CSI API method",
      description:
        'Calls any CSI API method, e.g. method "FrameObj.GetSection" with args {"Name":"12"}. Returns returnValue (0 = success) and all ref/out ' +
        "outputs. Get*/Count* methods are always allowed; anything else modifies the model and is refused unless the user enabled " +
        '"Allow write operations" in the ETABS Bridge window. Ask the user before calling a modifying method.',
      inputSchema: {
        instance,
        method: z.string().min(1).describe('Method path, e.g. "FrameObj.GetSection" or "SapModel.GetVersion".'),
        args: z
          .union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
          .optional()
          .describe("Arguments by parameter name (object) or position (array). Omit ref/out parameters."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    safe(async ({ instance: pid, method, args }) => resolver.client(pid).call(method, args)),
  );

  return server;
}
