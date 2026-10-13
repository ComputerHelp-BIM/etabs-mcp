import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { isOriginAllowed, type ApiTypeDescription } from "@etabs-bridge/client";
import { registerInstance, unregisterInstance } from "@etabs-bridge/client/registry";
import { createSampleModel, type SampleModel, type SampleModelOptions } from "./sampleModel.js";

export interface MockBridgeOptions {
  /** 0 = pick a free port. Default 52780. */
  port?: number;
  /** Default: random 256-bit token. */
  token?: string;
  /** Default: Vite dev + preview origins on localhost. */
  allowedOrigins?: string[];
  /** Allow non Get/Count RPC methods. Default false (same as the plugin). */
  allowWrites?: boolean;
  /** Artificial delay per ETABS call, to exercise loading states. Default 0. */
  latencyMs?: number;
  /** Write a discovery record so the MCP server can find this mock. Default false. */
  register?: boolean;
  /** Registry folder override (tests). */
  registryDir?: string;
  model?: SampleModelOptions;
}

export interface MockBridge {
  url: string;
  port: number;
  token: string;
  model: SampleModel;
  /** Toggle write access at runtime, like the plugin checkbox. */
  setAllowWrites(allow: boolean): void;
  close(): Promise<void>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const PREFIX = "/api/v1";
const READ_ONLY = /^(Get|Count)/;

/**
 * Starts an HTTP server that behaves like the ETABS Bridge plugin (same routes, auth,
 * CORS, host check, error codes and JSON shapes), backed by a generated sample model.
 */
export async function startMockBridge(options: MockBridgeOptions = {}): Promise<MockBridge> {
  const token = options.token ?? randomBytes(32).toString("base64url");
  if (token.length < 16) throw new Error("token must be at least 16 characters");
  const allowedOrigins = options.allowedOrigins ?? [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
  ];
  const model = createSampleModel({ processId: process.pid, ...options.model });
  let allowWrites = options.allowWrites ?? false;
  const latency = options.latencyMs ?? 0;
  const sections = new Map(model.geometry.frames.map((f) => [f.name, f.section]));

  const delay = () => (latency > 0 ? new Promise((r) => setTimeout(r, latency)) : Promise.resolve());

  const routes: Record<string, Record<string, (url: URL, body: string) => Promise<unknown>>> = {
    "/health": {
      GET: async () => ({ status: "ok", bridgeVersion: model.geometry.model.bridgeVersion, apiVersion: "1", processId: process.pid }),
    },
    "/model": { GET: async () => (await delay(), model.geometry.model) },
    "/geometry": { GET: async () => (await delay(), model.geometry) },
    "/geometry/stories": {
      GET: async () => (await delay(), { units: model.geometry.units, baseElevation: model.geometry.baseElevation, stories: model.geometry.stories }),
    },
    "/geometry/grids": { GET: async () => (await delay(), { units: model.geometry.units, gridSystems: model.geometry.gridSystems }) },
    "/geometry/joints": { GET: async () => (await delay(), { units: model.geometry.units, joints: model.geometry.joints }) },
    "/geometry/frames": { GET: async () => (await delay(), { units: model.geometry.units, frames: model.geometry.frames }) },
    "/geometry/areas": { GET: async () => (await delay(), { units: model.geometry.units, areas: model.geometry.areas }) },
    "/sections": { GET: async () => (await delay(), model.sections) },
    "/loads": { GET: async () => (await delay(), model.loads) },
    "/tables": { GET: async () => (await delay(), { tables: model.tables }) },
    "/tables/data": { GET: async (url) => (await delay(), tableData(url)) },
    "/rpc/describe": { GET: async (url) => describe(url.searchParams.get("path") ?? "") },
    "/rpc": { POST: async (_url, body) => (await delay(), rpc(body)) },
  };

  function tableData(url: URL) {
    const key = url.searchParams.get("key")?.trim();
    if (!key) throw new HttpError(400, "BAD_REQUEST", "Query parameter 'key' is required. Get keys from /tables.");
    const offset = nonNegative(url, "offset", 0);
    const limit = nonNegative(url, "limit", Number.MAX_SAFE_INTEGER);
    const table = model.tableData.get(key);
    if (!table) {
      throw new HttpError(502, "ETABS_API_ERROR", `ETABS API call 'DatabaseTables.GetTableForDisplayArray(${key})' failed with return code 1.`);
    }
    const fieldFilter = (url.searchParams.get("fields") ?? "").split(",").map((f) => f.trim()).filter(Boolean);
    const indexes = fieldFilter.length ? fieldFilter.map((f) => table.fields.indexOf(f)).filter((i) => i >= 0) : table.fields.map((_, i) => i);
    const rows = table.rows.map((r) => indexes.map((i) => r[i] ?? ""));
    return {
      key: table.key,
      version: table.version,
      group: url.searchParams.get("group") || "All",
      fields: indexes.map((i) => table.fields[i] ?? ""),
      totalRows: rows.length,
      offset: Math.min(offset, rows.length),
      rows: rows.slice(offset, offset + limit),
    };
  }

  function nonNegative(url: URL, name: string, fallback: number): number {
    const raw = url.searchParams.get(name);
    if (raw === null || raw === "") return fallback;
    if (!/^\d+$/.test(raw)) throw new HttpError(400, "BAD_REQUEST", `Query parameter '${name}' must be a non-negative integer.`);
    return Number(raw);
  }

  const api: Record<string, ApiTypeDescription> = {
    "": {
      path: "",
      type: "cSapModel",
      objects: ["FrameObj"],
      methods: [
        { name: "GetModelFilename", returnType: "string", readOnly: true, parameters: [{ name: "IncludePath", type: "bool", direction: "in", optional: true, enumValues: null }] },
        { name: "GetPresentUnits", returnType: "eUnits", readOnly: true, parameters: [] },
        {
          name: "GetVersion",
          returnType: "int",
          readOnly: true,
          parameters: [
            { name: "Version", type: "string", direction: "ref", optional: false, enumValues: null },
            { name: "MyVersionNumber", type: "double", direction: "ref", optional: false, enumValues: null },
          ],
        },
      ],
    },
    FrameObj: {
      path: "FrameObj",
      type: "cFrameObj",
      objects: [],
      methods: [
        {
          name: "GetNameList",
          returnType: "int",
          readOnly: true,
          parameters: [
            { name: "NumberNames", type: "int", direction: "ref", optional: false, enumValues: null },
            { name: "MyName", type: "string[]", direction: "ref", optional: false, enumValues: null },
          ],
        },
        {
          name: "GetSection",
          returnType: "int",
          readOnly: true,
          parameters: [
            { name: "Name", type: "string", direction: "in", optional: false, enumValues: null },
            { name: "PropName", type: "string", direction: "ref", optional: false, enumValues: null },
            { name: "SAuto", type: "string", direction: "ref", optional: false, enumValues: null },
          ],
        },
        {
          name: "SetSection",
          returnType: "int",
          readOnly: false,
          parameters: [
            { name: "Name", type: "string", direction: "in", optional: false, enumValues: null },
            { name: "PropName", type: "string", direction: "in", optional: false, enumValues: null },
          ],
        },
      ],
    },
  };

  function normalizePath(path: string): string {
    const parts = path.split(".").filter((p, i) => !(i === 0 && p.toLowerCase() === "sapmodel"));
    return parts.join(".");
  }

  function describe(path: string): ApiTypeDescription {
    const normalized = normalizePath(path);
    const match = Object.keys(api).find((k) => k.toLowerCase() === normalized.toLowerCase());
    if (match === undefined) throw new HttpError(404, "NOT_FOUND", `'${normalized}' is not an API object. Use /rpc/describe to list available objects.`);
    return api[match]!;
  }

  function rpc(body: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      throw new HttpError(400, "BAD_REQUEST", `Request body is not valid JSON: ${(e as Error).message}`);
    }
    const method = typeof parsed === "object" && parsed !== null ? (parsed as { method?: unknown }).method : undefined;
    if (typeof method !== "string" || !method.trim()) {
      throw new HttpError(400, "BAD_REQUEST", 'Body must be {"method": "FrameObj.GetSection", "args": {...}}.');
    }
    const rawArgs = (parsed as { args?: unknown }).args;
    const full = normalizePath(method.trim());
    const dot = full.lastIndexOf(".");
    const objectPath = dot < 0 ? "" : full.slice(0, dot);
    const name = dot < 0 ? full : full.slice(dot + 1);
    const description = describe(objectPath);
    const signature = description.methods.find((m) => m.name.toLowerCase() === name.toLowerCase());
    if (!signature) throw new HttpError(404, "NOT_FOUND", `API method '${full}' does not exist.`);
    if (!READ_ONLY.test(signature.name) && !allowWrites) {
      throw new HttpError(403, "WRITE_DISABLED", `'${full}' may modify the model. Enable "Allow write operations" in the ETABS Bridge window to call it.`);
    }

    const args: Record<string, unknown> = {};
    if (Array.isArray(rawArgs)) signature.parameters.forEach((p, i) => i < rawArgs.length && (args[p.name] = rawArgs[i]));
    else if (rawArgs && typeof rawArgs === "object") {
      for (const [k, v] of Object.entries(rawArgs)) {
        const p = signature.parameters.find((x) => x.name.toLowerCase() === k.toLowerCase());
        if (!p) throw new HttpError(400, "BAD_REQUEST", `'${full}' has no parameter '${k}'.`);
        args[p.name] = v;
      }
    }
    const required = (p: string) => {
      if (typeof args[p] !== "string") throw new HttpError(400, "BAD_REQUEST", `Missing required argument '${p}' (string) for '${full}'.`);
      return args[p] as string;
    };
    const fullName = (objectPath ? `${objectPath}.` : "") + signature.name;

    switch (fullName) {
      case "GetModelFilename":
        return { method: fullName, returnValue: args.IncludePath === false ? model.geometry.model.fileName : model.geometry.model.filePath, outputs: {} };
      case "GetPresentUnits":
        return { method: fullName, returnValue: model.geometry.units.name, outputs: {} };
      case "GetVersion":
        return { method: fullName, returnValue: 0, outputs: { Version: model.geometry.model.etabsVersion, MyVersionNumber: 22 } };
      case "FrameObj.GetNameList":
        return { method: fullName, returnValue: 0, outputs: { NumberNames: sections.size, MyName: [...sections.keys()] } };
      case "FrameObj.GetSection": {
        const section = sections.get(required("Name"));
        return section === undefined
          ? { method: fullName, returnValue: 1, outputs: { PropName: "", SAuto: "" } }
          : { method: fullName, returnValue: 0, outputs: { PropName: section, SAuto: "" } };
      }
      case "FrameObj.SetSection": {
        const frameName = required("Name");
        if (!sections.has(frameName)) return { method: fullName, returnValue: 1, outputs: {} };
        sections.set(frameName, required("PropName"));
        return { method: fullName, returnValue: 0, outputs: {} };
      }
      default:
        throw new HttpError(404, "NOT_FOUND", `API method '${full}' does not exist.`);
    }
  }

  function send(res: ServerResponse, status: number, headers: Record<string, string>, body?: unknown) {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    res.writeHead(status, {
      ...headers,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...(payload !== undefined ? { "Content-Type": "application/json; charset=utf-8", "Content-Length": String(Buffer.byteLength(payload)) } : {}),
    });
    res.end(payload);
  }

  async function readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > 1024 * 1024) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Request body too large.");
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  const tokenBuffer = Buffer.from(token);
  const authorized = (req: IncomingMessage) => {
    const header = req.headers["x-bridge-token"];
    let presented = typeof header === "string" ? header : undefined;
    const auth = req.headers.authorization;
    if (!presented && auth?.toLowerCase().startsWith("bearer ")) presented = auth.slice(7).trim();
    if (!presented) return false;
    const given = Buffer.from(presented);
    return given.length === tokenBuffer.length && timingSafeEqual(given, tokenBuffer);
  };

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const headers: Record<string, string> = {};
    try {
      const hostName = (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
      if (hostName && !["localhost", "127.0.0.1", "[::1]"].includes(hostName)) {
        throw new HttpError(403, "FORBIDDEN_HOST", "The bridge only serves requests addressed to localhost.");
      }

      const origin = req.headers.origin;
      if (origin) {
        if (!isOriginAllowed(origin, allowedOrigins)) throw new HttpError(403, "FORBIDDEN_ORIGIN", `Origin '${origin}' is not allowed. Add it to allowedOrigins in the ETABS Bridge settings.`);
        Object.assign(headers, {
          "Access-Control-Allow-Origin": origin,
          Vary: "Origin",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Bridge-Token",
          "Access-Control-Max-Age": "600",
        });
        if (req.headers["access-control-request-private-network"] === "true") headers["Access-Control-Allow-Private-Network"] = "true";
      }

      if (req.method === "OPTIONS") return send(res, 204, headers);

      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
      const route = path.startsWith(PREFIX) ? routes[path.slice(PREFIX.length)] : undefined;
      if (!route) throw new HttpError(404, "NOT_FOUND", `No endpoint at '${url.pathname}'. See ${PREFIX}/health.`);
      const handler = route[req.method ?? "GET"];
      if (!handler) {
        headers.Allow = Object.keys(route).join(", ");
        throw new HttpError(405, "METHOD_NOT_ALLOWED", `${req.method} is not supported on '${path}'.`);
      }
      if (path !== `${PREFIX}/health` && !authorized(req)) {
        throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid token. Send 'Authorization: Bearer <token>' from the ETABS Bridge window.");
      }

      const body = req.method === "POST" ? await readBody(req) : "";
      send(res, 200, headers, await handler(url, body));
    } catch (err) {
      const e = err instanceof HttpError ? err : new HttpError(500, "INTERNAL", `Unexpected error: ${(err as Error).message}`);
      send(res, e.status, headers, { error: { code: e.code, message: e.message } });
    }
  }

  const server: Server = createServer((req, res) => void handle(req, res));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 52780, "localhost", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  const url = `http://localhost:${port}`;

  if (options.register) {
    registerInstance(
      {
        processId: process.pid,
        port,
        baseUrl: url,
        token,
        modelPath: model.geometry.model.filePath,
        etabsVersion: model.geometry.model.etabsVersion,
        bridgeVersion: model.geometry.model.bridgeVersion,
        startedAt: new Date().toISOString(),
      },
      options.registryDir,
    );
  }

  return {
    url,
    port,
    token,
    model,
    setAllowWrites: (allow) => {
      allowWrites = allow;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (options.register) unregisterInstance(process.pid, options.registryDir);
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
