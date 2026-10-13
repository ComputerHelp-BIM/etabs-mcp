/**
 * Node-only: reads/writes the bridge discovery folder shared with the C# plugin
 * (EtabsBridge.Core.Discovery.InstanceRegistry). Import from "@etabs-bridge/client/registry";
 * it is a separate entry point so browser bundles never pull in node:fs.
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const REGISTRY_DIR_ENV = "ETABS_BRIDGE_REGISTRY_DIR";

export const InstanceRecordSchema = z.object({
  processId: z.number().int(),
  port: z.number().int(),
  baseUrl: z.string(),
  token: z.string(),
  modelPath: z.string(),
  etabsVersion: z.string(),
  bridgeVersion: z.string(),
  startedAt: z.string(),
});

export type InstanceRecord = z.infer<typeof InstanceRecordSchema>;

/**
 * Same folder as .NET's Environment.SpecialFolder.LocalApplicationData + EtabsBridge/instances:
 * %LOCALAPPDATA%\EtabsBridge\instances on Windows, ~/.local/share/EtabsBridge/instances elsewhere.
 */
export function defaultRegistryDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[REGISTRY_DIR_ENV];
  if (override?.trim()) return override;
  if (process.platform === "win32") {
    return join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "EtabsBridge", "instances");
  }
  return join(env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "EtabsBridge", "instances");
}

/** True when a process with this PID exists (signal 0 only checks). */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: exists but owned by someone else.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Live bridge instances, oldest PID first. Stale records (exited ETABS) are deleted; unreadable ones skipped. */
export function listInstances(dir = defaultRegistryDir(), isAlive: (pid: number) => boolean = isProcessAlive): InstanceRecord[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }

  const records: InstanceRecord[] = [];
  for (const file of files) {
    const path = join(dir, file);
    let record: InstanceRecord;
    try {
      record = InstanceRecordSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    } catch {
      continue;
    }
    if (!isAlive(record.processId)) {
      rmSync(path, { force: true });
      continue;
    }
    records.push(record);
  }
  return records.sort((a, b) => a.processId - b.processId);
}

/** Writes a record atomically (used by the mock bridge; the plugin writes its own). */
export function registerInstance(record: InstanceRecord, dir = defaultRegistryDir()): string {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `${record.processId}.json`);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, JSON.stringify(record), { encoding: "utf8", mode: 0o600 });
  renameSync(temp, target);
  return target;
}

export function unregisterInstance(processId: number, dir = defaultRegistryDir()): void {
  rmSync(join(dir, `${processId}.json`), { force: true });
}
