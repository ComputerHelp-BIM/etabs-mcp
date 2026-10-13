import type { z } from "zod";
import {
  ApiCallResultSchema,
  ApiTypeDescriptionSchema,
  AreasResultSchema,
  ErrorBodySchema,
  FramesResultSchema,
  GeometrySnapshotSchema,
  GridsResultSchema,
  HealthSchema,
  JointsResultSchema,
  LoadsResultSchema,
  ModelInfoSchema,
  SectionsResultSchema,
  StoriesResultSchema,
  TableDataSchema,
  TablesResultSchema,
  type ApiCallResult,
  type ApiTypeDescription,
  type AreasResult,
  type FramesResult,
  type GeometrySnapshot,
  type GridsResult,
  type Health,
  type JointsResult,
  type LoadsResult,
  type ModelInfo,
  type SectionsResult,
  type StoriesResult,
  type TableData,
  type TablesResult,
} from "./schemas.js";
import { normalizeBridgeUrl } from "./connection.js";

/** Error codes from the bridge, plus client-side ones (NETWORK, TIMEOUT, INVALID_RESPONSE). */
export type BridgeErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN_ORIGIN"
  | "FORBIDDEN_HOST"
  | "WRITE_DISABLED"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "PAYLOAD_TOO_LARGE"
  | "ETABS_API_ERROR"
  | "ETABS_BUSY"
  | "INTERNAL"
  | "NETWORK"
  | "TIMEOUT"
  | "INVALID_RESPONSE";

export class BridgeError extends Error {
  constructor(
    /** HTTP status, or 0 when no response was received. */
    readonly status: number,
    readonly code: BridgeErrorCode | (string & {}),
    message: string,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

export interface BridgeClientOptions {
  /** e.g. "http://localhost:52780". 127.0.0.1 is rewritten to localhost (see normalizeBridgeUrl). */
  baseUrl: string;
  token: string;
  /** Per-request timeout. Large models can take a while on first read. Default 120 s. */
  timeoutMs?: number;
  /** Validate responses against the zod schemas. Default true. */
  validate?: boolean;
  /** Custom fetch (tests, proxies). Default globalThis.fetch. */
  fetch?: typeof fetch;
}

export interface TableQuery {
  /** Group name filter; default "All". */
  group?: string;
  /** Field keys to include; default all. */
  fields?: string[];
  offset?: number;
  limit?: number;
}

/**
 * Typed client for the ETABS Bridge REST API v1. Works in browsers and Node 20+.
 *
 * @example
 * const client = new BridgeClient({ baseUrl: "http://localhost:52780", token });
 * const geometry = await client.geometry();
 */
export class BridgeClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly validate: boolean;
  private readonly fetchImpl: typeof fetch;

  constructor(options: BridgeClientOptions) {
    if (!options.baseUrl) throw new Error("baseUrl is required");
    if (!options.token) throw new Error("token is required");
    this.baseUrl = normalizeBridgeUrl(options.baseUrl);
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.validate = options.validate ?? true;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  health(): Promise<Health> {
    return this.request("GET", "/health", HealthSchema);
  }

  model(): Promise<ModelInfo> {
    return this.request("GET", "/model", ModelInfoSchema);
  }

  /** Whole geometry in one ETABS round trip. */
  geometry(): Promise<GeometrySnapshot> {
    return this.request("GET", "/geometry", GeometrySnapshotSchema);
  }

  stories(): Promise<StoriesResult> {
    return this.request("GET", "/geometry/stories", StoriesResultSchema);
  }

  grids(): Promise<GridsResult> {
    return this.request("GET", "/geometry/grids", GridsResultSchema);
  }

  joints(): Promise<JointsResult> {
    return this.request("GET", "/geometry/joints", JointsResultSchema);
  }

  frames(): Promise<FramesResult> {
    return this.request("GET", "/geometry/frames", FramesResultSchema);
  }

  areas(): Promise<AreasResult> {
    return this.request("GET", "/geometry/areas", AreasResultSchema);
  }

  /** Materials, frame sections and area sections (with dimensions and properties). Since bridge 0.2.0. */
  sections(): Promise<SectionsResult> {
    return this.request("GET", "/sections", SectionsResultSchema);
  }

  /** Load patterns, cases, combinations and assigned loads. Since bridge 0.5.0. */
  loads(): Promise<LoadsResult> {
    return this.request("GET", "/loads", LoadsResultSchema);
  }

  /** Catalogue of ETABS database tables (Display > Show Tables). */
  tables(): Promise<TablesResult> {
    return this.request("GET", "/tables", TablesResultSchema);
  }

  /** Rows of one database table; every value is a string as ETABS displays it. */
  table(key: string, query: TableQuery = {}): Promise<TableData> {
    const params = new URLSearchParams({ key });
    if (query.group) params.set("group", query.group);
    if (query.fields?.length) params.set("fields", query.fields.join(","));
    if (query.offset !== undefined) params.set("offset", String(query.offset));
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    return this.request("GET", `/tables/data?${params.toString()}`, TableDataSchema);
  }

  /** Lists sub-objects and methods of an API object, e.g. "FrameObj" ("" for SapModel). */
  describe(path = ""): Promise<ApiTypeDescription> {
    const query = path ? `?path=${encodeURIComponent(path)}` : "";
    return this.request("GET", `/rpc/describe${query}`, ApiTypeDescriptionSchema);
  }

  /**
   * Calls any CSI API method, e.g. call("FrameObj.GetSection", { Name: "C1" }).
   * Non Get/Count methods fail with WRITE_DISABLED unless enabled in the plugin window.
   */
  call(method: string, args?: Record<string, unknown> | unknown[]): Promise<ApiCallResult> {
    return this.request("POST", "/rpc", ApiCallResultSchema, { method, args: args ?? null });
  }

  private async request<S extends z.ZodType>(method: "GET" | "POST", path: string, schema: S, body?: unknown): Promise<z.infer<S>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/v1${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new BridgeError(0, "TIMEOUT", `No response from ETABS Bridge within ${Math.round(this.timeoutMs / 1000)} s.`);
      }
      throw new BridgeError(
        0,
        "NETWORK",
        `Cannot reach ETABS Bridge at ${this.baseUrl}. Is the plugin running in ETABS? (${err instanceof Error ? err.message : String(err)})`,
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      throw new BridgeError(response.status, "INVALID_RESPONSE", `Bridge returned non-JSON (HTTP ${response.status}).`);
    }

    if (!response.ok) {
      const parsed = ErrorBodySchema.safeParse(json);
      if (parsed.success) {
        throw new BridgeError(response.status, parsed.data.error.code, parsed.data.error.message);
      }
      throw new BridgeError(response.status, "INVALID_RESPONSE", `HTTP ${response.status} without an error body.`);
    }

    if (!this.validate) return json as z.infer<S>;

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new BridgeError(
        response.status,
        "INVALID_RESPONSE",
        `Response from ${path} does not match the v1 contract (bridge/client version mismatch?): ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }
}
