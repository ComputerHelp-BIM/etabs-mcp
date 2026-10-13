import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultRegistryDir,
  isProcessAlive,
  listInstances,
  registerInstance,
  unregisterInstance,
  type InstanceRecord,
} from "../src/registry.js";

const record = (processId: number): InstanceRecord => ({
  processId,
  port: 52780,
  baseUrl: "http://localhost:52780",
  token: "t",
  modelPath: "C:\\M\\A.EDB",
  etabsVersion: "22.0.0",
  bridgeVersion: "0.1.0",
  startedAt: "2026-01-01T00:00:00Z",
});

describe("instance registry", () => {
  const dirs: string[] = [];
  const tempDir = () => {
    const d = mkdtempSync(join(tmpdir(), "etabs-registry-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it("registers, lists and unregisters", () => {
    const dir = tempDir();
    registerInstance(record(11), dir);
    registerInstance(record(10), dir);

    expect(listInstances(dir, () => true).map((r) => r.processId)).toEqual([10, 11]);
    unregisterInstance(10, dir);
    expect(listInstances(dir, () => true).map((r) => r.processId)).toEqual([11]);
    expect(readdirSync(dir).some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  it("reads records written by the C# plugin (same JSON shape)", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "42.json"),
      '{"processId":42,"port":52781,"baseUrl":"http://localhost:52781","token":"abc","modelPath":"","etabsVersion":"22.1.0","bridgeVersion":"0.1.0","startedAt":"2026-10-13T07:00:00.0000000Z"}',
    );
    expect(listInstances(dir, () => true)[0]).toMatchObject({ processId: 42, port: 52781, token: "abc" });
  });

  it("removes stale records and skips corrupt files", () => {
    const dir = tempDir();
    registerInstance(record(20), dir);
    registerInstance(record(21), dir);
    writeFileSync(join(dir, "99.json"), "{ corrupt");

    expect(listInstances(dir, (pid) => pid === 21).map((r) => r.processId)).toEqual([21]);
    expect(readdirSync(dir).sort()).toEqual(["21.json", "99.json"]);
  });

  it("missing folder means no instances", () => {
    expect(listInstances(join(tempDir(), "nope"))).toEqual([]);
  });

  it("honours the override variable", () => {
    expect(defaultRegistryDir({ ETABS_BRIDGE_REGISTRY_DIR: "/x/y" })).toBe("/x/y");
    expect(defaultRegistryDir({})).toMatch(/EtabsBridge[\\/]instances$/);
  });

  it("detects live processes", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(2 ** 22 + 12345)).toBe(false);
    expect(isProcessAlive(0)).toBe(false);
  });
});
