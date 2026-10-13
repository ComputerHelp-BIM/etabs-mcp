import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BridgeClient, BridgeError, GeometrySnapshotSchema, summarizeGeometry } from "@etabs-bridge/client";
import { listInstances } from "@etabs-bridge/client/registry";
import { createSampleModel, startMockBridge, type MockBridge } from "../src/index.js";

describe("createSampleModel", () => {
  it("builds a schema-valid, consistent building", () => {
    const { geometry } = createSampleModel({ baysX: 2, baysY: 1, stories: 3 });
    GeometrySnapshotSchema.parse(geometry);

    const s = summarizeGeometry(geometry);
    // 3x2 grid intersections per level, 4 levels.
    expect(s.counts.joints).toBe(24);
    expect(s.counts.supports).toBe(6);
    expect(s.framesByType).toEqual({ Beam: 3 * (2 * 2 + 3 * 1), Brace: 6, Column: 18 });
    expect(s.areasByType).toEqual({ Floor: 6, Wall: 9 });

    const jointNames = new Set(geometry.joints.map((j) => j.name));
    for (const f of geometry.frames) {
      expect(jointNames.has(f.joint1) && jointNames.has(f.joint2)).toBe(true);
    }
    for (const a of geometry.areas) expect(a.points).toHaveLength(a.joints.length);
  });

  it("rejects empty buildings", () => {
    expect(() => createSampleModel({ stories: 0 })).toThrow();
  });
});

describe("mock bridge over HTTP", () => {
  let bridge: MockBridge;
  let client: BridgeClient;
  let registryDir: string;

  beforeAll(async () => {
    registryDir = mkdtempSync(join(tmpdir(), "etabs-mock-"));
    bridge = await startMockBridge({ port: 0, token: "test-token-0123456789", register: true, registryDir });
    client = new BridgeClient({ baseUrl: bridge.url, token: bridge.token });
  });

  afterAll(async () => {
    await bridge.close();
    expect(listInstances(registryDir)).toEqual([]);
    rmSync(registryDir, { recursive: true, force: true });
  });

  it("registers itself for discovery", () => {
    expect(listInstances(registryDir)).toEqual([expect.objectContaining({ processId: process.pid, baseUrl: bridge.url })]);
  });

  it("serves every geometry endpoint through the typed client", async () => {
    expect((await client.health()).status).toBe("ok");
    expect((await client.model()).fileName).toBe("SampleTower.EDB");
    const g = await client.geometry();
    expect(g.frames.length).toBeGreaterThan(100);
    expect((await client.stories()).stories).toHaveLength(6);
    expect((await client.grids()).gridSystems[0]?.xLines).toHaveLength(5);
    expect((await client.joints()).joints).toHaveLength(g.joints.length);
    expect((await client.frames()).frames).toHaveLength(g.frames.length);
    expect((await client.areas()).areas).toHaveLength(g.areas.length);
  });

  it("serves database tables with paging and field selection", async () => {
    const { tables } = await client.tables();
    expect(tables.find((t) => t.key === "Story Definitions")?.isEmpty).toBe(false);

    const page = await client.table("Frame Assignments - Section Properties", { fields: ["Label", "Section Property"], offset: 2, limit: 3 });
    expect(page.fields).toEqual(["Label", "Section Property"]);
    expect(page.rows).toHaveLength(3);
    expect(page.offset).toBe(2);
    expect(page.totalRows).toBeGreaterThan(100);

    await expect(client.table("Nope")).rejects.toMatchObject({ status: 502, code: "ETABS_API_ERROR" });
  });

  it("supports RPC with write protection", async () => {
    const read = await client.call("FrameObj.GetSection", { Name: "1" });
    expect(read.outputs.PropName).toBe("C600");

    await expect(client.call("FrameObj.SetSection", ["1", "C900"])).rejects.toMatchObject({ code: "WRITE_DISABLED" });
    bridge.setAllowWrites(true);
    await client.call("SapModel.FrameObj.SetSection", { name: "1", propName: "C900" });
    expect((await client.call("FrameObj.GetSection", ["1"])).outputs.PropName).toBe("C900");
    bridge.setAllowWrites(false);

    expect((await client.describe("FrameObj")).methods.map((m) => m.name)).toContain("GetSection");
    await expect(client.call("FrameObj.Nope")).rejects.toMatchObject({ status: 404 });
  });

  it("enforces token, origin and host like the plugin", async () => {
    const wrong = new BridgeClient({ baseUrl: bridge.url, token: "wrong-token-0123456789" });
    await expect(wrong.model()).rejects.toBeInstanceOf(BridgeError);
    await expect(wrong.model()).rejects.toMatchObject({ status: 401, code: "UNAUTHORIZED" });

    const evil = await fetch(`${bridge.url}/api/v1/model`, {
      headers: { Origin: "https://evil.example.com", Authorization: `Bearer ${bridge.token}` },
    });
    expect(evil.status).toBe(403);
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();

    const preflight = await fetch(`${bridge.url}/api/v1/model`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:5173", "Access-Control-Request-Private-Network": "true" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-private-network")).toBe("true");

    const notFound = await fetch(`${bridge.url}/api/v1/nope`, { headers: { Authorization: `Bearer ${bridge.token}` } });
    expect(notFound.status).toBe(404);
  });
});
