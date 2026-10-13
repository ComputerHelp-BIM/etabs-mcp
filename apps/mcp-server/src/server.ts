import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  AREA_TYPES,
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
export const SERVER_VERSION = "0.1.0";

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
