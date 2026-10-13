import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BridgeClient, BridgeError, GeometrySnapshotSchema, LoadsResultSchema, SectionsResultSchema, loadTakedown, summarizeGeometry } from "@etabs-bridge/client";
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

  it("defines every section and material the geometry uses", () => {
    const { geometry, sections } = createSampleModel();
    SectionsResultSchema.parse(sections);
    const frameSections = new Set(sections.frameSections.map((s) => s.name));
    const areaSections = new Set(sections.areaSections.map((s) => s.name));
    const materials = new Set(sections.materials.map((m) => m.name));
    for (const f of geometry.frames) expect(frameSections.has(f.section)).toBe(true);
    for (const a of geometry.areas) expect(areaSections.has(a.section)).toBe(true);
    for (const s of [...sections.frameSections, ...sections.areaSections]) expect(materials.has(s.material)).toBe(true);
  });

  it("has consistent sample loads", () => {
    const { geometry, loads } = createSampleModel({ baysX: 2, baysY: 1, stories: 2 });
    LoadsResultSchema.parse(loads);
    const t = loadTakedown(loads, geometry);
    // 2 floors x 12 x 5 m = 120 m² x 3 kN/m²
    expect(t.find((r) => r.pattern === "Live")!.total).toBeCloseTo(360);
    // SDL: 120 m² x 1.5 + perimeter beams (2 x (12 + 5) = 34 m per floor) x 10 kN/m x 2 floors
    expect(t.find((r) => r.pattern === "SDL")!.total).toBeCloseTo(180 + 680);
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
    bridge = await startMockBridge({
      port: 0,
      token: "test-token-0123456789",
      register: true,
      registryDir,
      allowedOrigins: ["http://localhost:5173", "https://etabs-viewer-*.vercel.app"],
    });
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
    expect((await client.sections()).frameSections.map((s) => s.name)).toContain("B300x600");
    expect((await client.loads()).combinations.map((c) => c.name)).toContain("ENVELOPE");
  });

  it("serves consistent synthetic results", async () => {
    const status = await client.resultsStatus();
    expect(status.cases.every((c) => c.status === "Finished")).toBe(true);

    const base = await client.baseReactions({ cases: ["Dead", "Live", "EQX"], combos: ["1.5(D+L)", "ENVELOPE"] });
    const fz = (n: string, step = "") => base.rows.find((r) => r.loadCase === n && r.stepType === step)!.fz;
    expect(fz("Live")).toBeCloseTo(loadTakedown(bridge.model.loads, bridge.model.geometry).find((t) => t.pattern === "Live")!.total);
    expect(fz("1.5(D+L)")).toBeCloseTo(1.5 * (fz("Dead") + fz("Live") + (await client.baseReactions({ cases: ["SDL"] })).rows[0]!.fz));
    expect(fz("ENVELOPE", "Max")).toBeGreaterThanOrEqual(fz("ENVELOPE", "Min"));
    expect(base.rows.find((r) => r.loadCase === "EQX")!.fx).toBeCloseTo(-bridge.model.loads.jointLoads.reduce((s, j) => s + j.f1, 0));
    expect(base.warnings[0]).toMatch(/synthetic/);

    const supports = await client.jointReactions({ cases: ["Dead"] });
    expect(supports.rows.reduce((s, r) => s + r.f3, 0)).toBeCloseTo(fz("Dead"));

    const drifts = await client.storyDrifts({ cases: ["EQX"] });
    expect(drifts.rows.filter((r) => r.direction === "X")).toHaveLength(6);

    const forces = await client.frameForces({ cases: ["Dead"], frame: "1" });
    expect(forces.rows.map((r) => r.station)).toEqual([0, 2.25, 4.5]);

    const paged = await client.jointDisplacements({ cases: ["EQX"], offset: 10, limit: 5 });
    expect(paged.rows).toHaveLength(5);
    expect(paged.totalRows).toBe(bridge.model.geometry.joints.length);

    const unknown = await client.baseReactions({ cases: ["Nope"] });
    expect(unknown.rows).toEqual([]);
    expect(unknown.warnings.some((w) => w.includes("Nope"))).toBe(true);

    await expect(client.storyDrifts({})).rejects.toMatchObject({ status: 400 });
    expect((await client.concreteDesign({ limit: 3 })).rows).toHaveLength(3);
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

    const vercel = await fetch(`${bridge.url}/api/v1/health`, { headers: { Origin: "https://etabs-viewer-abc123.vercel.app" } });
    expect(vercel.status).toBe(200);

    const notFound = await fetch(`${bridge.url}/api/v1/nope`, { headers: { Authorization: `Bearer ${bridge.token}` } });
    expect(notFound.status).toBe(404);
  });
});
