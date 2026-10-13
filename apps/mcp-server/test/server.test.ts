import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { registerInstance } from "@etabs-bridge/client/registry";
import { startMockBridge, type MockBridge } from "@etabs-bridge/mock-bridge";
import { ConnectionError, createEtabsMcpServer, createResolver } from "../src/index.js";

async function connect(registryDir: string, env: NodeJS.ProcessEnv = {}) {
  const server = createEtabsMcpServer({ resolver: createResolver({ env, registryDir }), cacheSeconds: 5 });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

type ToolResult = { isError?: boolean; content: Array<{ type: string; text?: string }> };

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult;
  const text = result.content[0]?.text ?? "";
  return { isError: result.isError === true, text, json: result.isError ? undefined : JSON.parse(text) };
}

describe("MCP server against the mock bridge", () => {
  let bridge: MockBridge;
  let registryDir: string;
  let client: Client;

  beforeAll(async () => {
    registryDir = mkdtempSync(join(tmpdir(), "etabs-mcp-"));
    bridge = await startMockBridge({ port: 0, register: true, registryDir });
    client = await connect(registryDir);
  });

  afterAll(async () => {
    await client.close();
    await bridge.close();
    rmSync(registryDir, { recursive: true, force: true });
  });

  it("lists all tools with read-only hints", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "etabs_list_instances",
        "etabs_get_model_info",
        "etabs_get_geometry_summary",
        "etabs_get_stories",
        "etabs_get_grids",
        "etabs_get_joints",
        "etabs_get_frames",
        "etabs_get_areas",
        "etabs_get_sections",
        "etabs_get_boq",
        "etabs_generate_schedule",
        "etabs_list_tables",
        "etabs_get_table",
        "etabs_describe_api",
        "etabs_call_api",
      ]),
    );
    expect(tools.find((t) => t.name === "etabs_get_frames")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "etabs_call_api")?.annotations?.destructiveHint).toBe(true);
  });

  it("lists instances without leaking tokens", async () => {
    const { json, text } = await call(client, "etabs_list_instances");
    expect(json).toEqual([expect.objectContaining({ processId: process.pid, baseUrl: bridge.url })]);
    expect(text).not.toContain(bridge.token);
  });

  it("summarizes geometry", async () => {
    const { json } = await call(client, "etabs_get_geometry_summary");
    expect(json.model).toBe("SampleTower.EDB");
    expect(json.counts.stories).toBe(6);
    expect(json.framesByType.Column).toBeGreaterThan(0);
  });

  it("pages and filters frames", async () => {
    const first = await call(client, "etabs_get_frames", { story: "Story2", type: "Column", limit: 7 });
    expect(first.json.units.name).toBe("kN_m_C");
    expect(first.json.total).toBe(20); // 5 x 4 grid intersections
    expect(first.json.returned).toBe(7);
    expect(first.json.nextOffset).toBe(7);
    expect(first.json.items.every((f: { story: string; type: string }) => f.story === "Story2" && f.type === "Column")).toBe(true);

    const last = await call(client, "etabs_get_frames", { story: "Story2", type: "Column", offset: 14, limit: 7 });
    expect(last.json.returned).toBe(6);
    expect(last.json.nextOffset).toBeNull();
  });

  it("filters joints and areas", async () => {
    expect((await call(client, "etabs_get_joints", { supportsOnly: true })).json.total).toBe(20);
    expect((await call(client, "etabs_get_areas", { type: "Wall", story: "Story1" })).json.total).toBe(3);
  });

  it("returns sections and materials, filtered", async () => {
    const all = await call(client, "etabs_get_sections");
    expect(all.json.materials.map((m: { name: string }) => m.name)).toContain("C35");
    expect(all.json.frameSections.length).toBeGreaterThan(0);

    const beams = await call(client, "etabs_get_sections", { include: "frameSections", search: "b300" });
    expect(beams.json.frameSections.map((s: { name: string }) => s.name)).toEqual(["B300x600", "B300x500"]);
    expect(beams.json.materials).toBeUndefined();
  });

  it("produces a priced BOQ, flagging sample rates", async () => {
    const res = await call(client, "etabs_get_boq");
    expect(res.json.ratesAreSamples).toBe(true);
    expect(res.json.lines.find((l: { code: string }) => l.code === "CON-C35-COLUMN").unit).toBe("m³");
    expect(res.json.summary.total).toBeGreaterThan(0);
    expect(res.json.unmeasuredCount).toBe(0);

    const custom = await call(client, "etabs_get_boq", { groupBy: "story", rates: { "concrete:C35": 100 }, currency: "usd", rebarRatios: { Column: 0 } });
    expect(custom.json.ratesAreSamples).toBe(false);
    expect(custom.json.currency).toBe("USD");
    const col = custom.json.lines.find((l: { code: string }) => l.code === "CON-C35-COLUMN-STORY1");
    expect(col.rate).toBe(100);
    expect(custom.json.lines.some((l: { code: string }) => l.code.startsWith("RFT-COLUMN"))).toBe(false);
    expect(custom.json.lines.find((l: { code: string }) => l.code.startsWith("FWK-")).amount).toBe(0); // unpriced keys are 0, not samples
  });

  it("generates a 4D schedule with costs", async () => {
    const res = await call(client, "etabs_generate_schedule", { startDate: "2026-01-05", workingWeekdays: [1, 2, 3, 4, 5] });
    expect(res.json.tasks).toHaveLength(12); // 6 stories x (vertical + horizontal)
    expect(res.json.tasks[0]).toMatchObject({ id: "V-Story1", start: "2026-01-05", finish: "2026-01-09" });
    expect(res.json.span.start).toBe("2026-01-05");
    const last = res.json.weeklyCumulativeCost[res.json.weeklyCumulativeCost.length - 1];
    const sumTasks = res.json.tasks.reduce((s: number, t: { cost: number }) => s + t.cost, 0);
    expect(Math.abs(last.cumulativeCost - sumTasks)).toBeLessThanOrEqual(12); // rounding per task
    expect(res.json.ratesAreSamples).toBe(true);
  });

  it("validates tool input", async () => {
    const res = await call(client, "etabs_get_frames", { type: "Girder" });
    expect(res.isError).toBe(true);
  });

  it("finds and reads database tables", async () => {
    const tables = await call(client, "etabs_list_tables", { search: "frame assign" });
    expect(tables.json).toEqual([{ key: "Frame Assignments - Section Properties", isEmpty: false }]);

    const data = await call(client, "etabs_get_table", { key: "Story Definitions", limit: 2 });
    expect(data.json.rows).toHaveLength(2);
    expect(data.json.nextOffset).toBe(2);
  });

  it("describes and calls the API, honouring write protection", async () => {
    const description = await call(client, "etabs_describe_api", { path: "FrameObj" });
    expect(description.json.methods.map((m: { name: string }) => m.name)).toContain("GetSection");

    const read = await call(client, "etabs_call_api", { method: "FrameObj.GetSection", args: { Name: "1" } });
    expect(read.json.outputs.PropName).toBe("C600");

    const write = await call(client, "etabs_call_api", { method: "FrameObj.SetSection", args: ["1", "X"] });
    expect(write.isError).toBe(true);
    expect(write.text).toMatch(/^WRITE_DISABLED/);
  });

  it("returns readable errors from the bridge", async () => {
    const res = await call(client, "etabs_get_table", { key: "Nope" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/^ETABS_API_ERROR/);
  });
});

describe("instance selection", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  const tempDir = () => {
    const d = mkdtempSync(join(tmpdir(), "etabs-mcp-sel-"));
    dirs.push(d);
    return d;
  };

  it("explains how to start the plugin when nothing runs", async () => {
    const client = await connect(tempDir());
    const res = await call(client, "etabs_get_model_info");
    expect(res.isError).toBe(true);
    expect(res.text).toContain("No running ETABS Bridge found");
    await client.close();
  });

  it("requires an instance when several models are open", async () => {
    const dir = tempDir();
    const bridge = await startMockBridge({ port: 0, register: true, registryDir: dir });
    // A second "ETABS" registered under our parent PID (alive) pointing at the same mock.
    registerInstance(
      { processId: process.ppid, port: bridge.port, baseUrl: bridge.url, token: bridge.token, modelPath: "B.EDB", etabsVersion: "", bridgeVersion: "", startedAt: "" },
      dir,
    );
    const client = await connect(dir);

    const ambiguous = await call(client, "etabs_get_model_info");
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.text).toContain('pass "instance"');

    const chosen = await call(client, "etabs_get_model_info", { instance: process.pid });
    expect(chosen.json.fileName).toBe("SampleTower.EDB");

    const unknown = await call(client, "etabs_get_model_info", { instance: 999999 });
    expect(unknown.text).toContain("No ETABS Bridge for process 999999");

    await client.close();
    await bridge.close();
  });

  it("can be pinned with environment variables", async () => {
    const bridge = await startMockBridge({ port: 0 });
    const client = await connect(tempDir(), { ETABS_BRIDGE_URL: bridge.url, ETABS_BRIDGE_TOKEN: bridge.token });
    expect((await call(client, "etabs_get_model_info")).json.fileName).toBe("SampleTower.EDB");
    await client.close();
    await bridge.close();
  });

  it("rejects a pinned URL without token", () => {
    expect(() => createResolver({ env: { ETABS_BRIDGE_URL: "http://localhost:1" } })).toThrow(ConnectionError);
  });
});
