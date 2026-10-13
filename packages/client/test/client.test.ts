import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BridgeClient,
  BridgeError,
  GeometrySnapshotSchema,
  TableDataSchema,
  TablesResultSchema,
  isBridgeUrl,
  isOriginAllowed,
  SectionsResultSchema,
  normalizeBridgeUrl,
  parseConnectionFragment,
  parseConnectionJson,
  summarizeGeometry,
} from "../src/index.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../contract/fixtures/${name}`, import.meta.url)), "utf8"));

describe("contract fixtures (written by the C# serializer)", () => {
  it("geometry.json matches GeometrySnapshotSchema", () => {
    const parsed = GeometrySnapshotSchema.parse(fixture("geometry.json"));
    expect(parsed.frames).toHaveLength(5);
    expect(parsed.areas[0]?.points).toHaveLength(4);
  });

  it("sections.json matches SectionsResultSchema", () => {
    const parsed = SectionsResultSchema.parse(fixture("sections.json"));
    expect(parsed.frameSections.find((s) => s.name === "W12X26")?.shape).toBe("I");
    expect(parsed.materials.find((m) => m.name === "C30")?.fc).toBe(30000);
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });

  it("tables.json and table-data.json match their schemas", () => {
    expect(TablesResultSchema.parse(fixture("tables.json")).tables).toHaveLength(2);
    expect(TableDataSchema.parse(fixture("table-data.json")).rows).toHaveLength(2);
  });
});

describe("summarizeGeometry", () => {
  it("counts objects per type, section and story", () => {
    const s = summarizeGeometry(GeometrySnapshotSchema.parse(fixture("geometry.json")));

    expect(s.model).toBe("Sample.EDB");
    expect(s.counts).toEqual({ stories: 2, gridSystems: 1, joints: 12, supports: 4, frames: 5, areas: 2 });
    expect(s.framesByType).toEqual({ Beam: 1, Brace: 1, Column: 3 });
    expect(s.areaSections).toEqual({ Slab200: 1, Wall250: 1 });
    expect(s.bounds).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 6, y: 5, z: 7.5 } });
    // "Base" joints are not on a story but still listed, lowest first.
    expect(s.stories.map((r) => r.name)).toEqual(["Base", "Story1", "Story2"]);
    expect(s.stories.find((r) => r.name === "Story1")).toMatchObject({ columns: 2, beams: 1, floors: 1, walls: 1 });
  });
});

describe("connection parsing", () => {
  it("reads the plugin's web-app link fragment", () => {
    expect(parseConnectionFragment("#bridgeUrl=http%3A%2F%2Flocalhost%3A52780&token=a%20b%26c")).toEqual({
      bridgeUrl: "http://localhost:52780",
      token: "a b&c",
    });
  });

  it("rejects non-localhost or incomplete fragments", () => {
    expect(parseConnectionFragment("#bridgeUrl=http%3A%2F%2Fevil.com&token=x")).toBeNull();
    expect(parseConnectionFragment("#bridgeUrl=http%3A%2F%2Flocalhost%3A1")).toBeNull();
    expect(parseConnectionFragment("")).toBeNull();
  });

  it("reads the plugin's connection JSON", () => {
    expect(parseConnectionJson('{"bridgeUrl":"http://localhost:52781","token":"t"}')).toEqual({
      bridgeUrl: "http://localhost:52781",
      token: "t",
    });
    expect(parseConnectionJson("nope")).toBeNull();
    expect(parseConnectionJson('{"bridgeUrl":"https://localhost:1","token":"t"}')).toBeNull();
  });

  it("normalizes loopback URLs to localhost", () => {
    expect(normalizeBridgeUrl("http://127.0.0.1:52780/")).toBe("http://localhost:52780");
    expect(normalizeBridgeUrl("http://[::1]:52781")).toBe("http://localhost:52781");
    expect(normalizeBridgeUrl("http://localhost:52780//")).toBe("http://localhost:52780");
    expect(new BridgeClient({ baseUrl: "http://127.0.0.1:1/", token: "t" }).baseUrl).toBe("http://localhost:1");
  });

  it.each([
    ["https://app.example.com", true],
    ["https://APP.example.com/", true],
    ["http://app.example.com", false],
    ["https://etabs-viewer.vercel.app", true],
    ["https://etabs-viewer-git-dev-team.vercel.app", true],
    ["https://a.b.vercel.app", false],
    ["https://vercel.app", false],
    ["https://x.vercel.app.evil.com", false],
    ["http://localhost:5173", true],
    ["http://localhost:5174", false],
    ["", false],
  ])("isOriginAllowed(%s) = %s (same table as the C# OriginMatcher tests)", (origin, expected) => {
    expect(isOriginAllowed(origin, ["https://app.example.com/", "https://*.vercel.app", "http://localhost:5173", " "])).toBe(expected);
  });

  it.each([
    ["http://localhost:52780", true],
    ["http://127.0.0.1:52780", true],
    ["http://[::1]:52780", true],
    ["https://localhost:52780", false],
    ["http://example.com", false],
    ["not a url", false],
  ])("isBridgeUrl(%s) = %s", (url, expected) => {
    expect(isBridgeUrl(url)).toBe(expected);
  });
});

describe("BridgeClient", () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("sends the bearer token and validates responses", async () => {
    let seen: Request | undefined;
    const client = new BridgeClient({
      baseUrl: "http://localhost:52780/",
      token: "tok",
      fetch: async (input, init) => {
        seen = new Request(input as string, init);
        return json(200, fixture("tables.json"));
      },
    });

    const result = await client.tables();
    expect(result.tables[0]?.key).toBe("Story Definitions");
    expect(seen?.url).toBe("http://localhost:52780/api/v1/tables");
    expect(seen?.headers.get("Authorization")).toBe("Bearer tok");
  });

  it("encodes table queries", async () => {
    let url = "";
    const client = new BridgeClient({
      baseUrl: "http://localhost:1",
      token: "t",
      fetch: async (input) => {
        url = String(input);
        return json(200, fixture("table-data.json"));
      },
    });
    await client.table("Frame Assignments - Sections", { fields: ["Story", "Label"], offset: 10, limit: 5 });
    expect(url).toBe(
      "http://localhost:1/api/v1/tables/data?key=Frame+Assignments+-+Sections&fields=Story%2CLabel&offset=10&limit=5",
    );
  });

  it("maps bridge error bodies to BridgeError", async () => {
    const client = new BridgeClient({
      baseUrl: "http://localhost:1",
      token: "t",
      fetch: async () => json(403, { error: { code: "WRITE_DISABLED", message: "no" } }),
    });
    await expect(client.call("FrameObj.SetSection", ["C1", "X"])).rejects.toMatchObject({
      status: 403,
      code: "WRITE_DISABLED",
      message: "no",
    });
  });

  it("reports contract mismatches", async () => {
    const client = new BridgeClient({ baseUrl: "http://localhost:1", token: "t", fetch: async () => json(200, { tables: "x" }) });
    await expect(client.tables()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("reports network failures and timeouts", async () => {
    const down = new BridgeClient({
      baseUrl: "http://localhost:1",
      token: "t",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(down.health()).rejects.toMatchObject({ code: "NETWORK", status: 0 });

    const slow = new BridgeClient({
      baseUrl: "http://localhost:1",
      token: "t",
      timeoutMs: 10,
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    });
    const err = await slow.health().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BridgeError);
    expect((err as BridgeError).code).toBe("TIMEOUT");
  });

  it("requires baseUrl and token", () => {
    expect(() => new BridgeClient({ baseUrl: "", token: "t" })).toThrow();
    expect(() => new BridgeClient({ baseUrl: "http://localhost:1", token: "" })).toThrow();
  });
});
