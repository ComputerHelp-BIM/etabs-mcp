import { BridgeClient } from "@etabs-bridge/client";
import { defaultRegistryDir, listInstances, type InstanceRecord } from "@etabs-bridge/client/registry";

/** Thrown when no (or no unique) ETABS instance can be selected; shown to the AI client verbatim. */
export class ConnectionError extends Error {}

export interface ConnectionResolver {
  /** Running bridges (without tokens) for etabs_list_instances. */
  instances(): InstanceRecord[];
  /** Client for the instance with this ETABS process ID, or the only one when omitted. */
  client(processId?: number): BridgeClient;
}

export interface ResolverOptions {
  env?: NodeJS.ProcessEnv;
  registryDir?: string;
  timeoutMs?: number;
}

/**
 * Chooses which ETABS instance to talk to:
 *  1. ETABS_BRIDGE_URL + ETABS_BRIDGE_TOKEN, when set, pin a single bridge (remote/manual setups).
 *  2. Otherwise the discovery folder written by the plugin: the instance given by PID, or the
 *     only running one. With several open models the caller must pass `instance`.
 */
export function createResolver(options: ResolverOptions = {}): ConnectionResolver {
  const env = options.env ?? process.env;
  const registryDir = options.registryDir ?? defaultRegistryDir(env);
  const timeoutMs = options.timeoutMs ?? 120_000;
  const pinnedUrl = env.ETABS_BRIDGE_URL?.trim();
  const pinnedToken = env.ETABS_BRIDGE_TOKEN?.trim();

  if (pinnedUrl && !pinnedToken) {
    throw new ConnectionError("ETABS_BRIDGE_URL is set but ETABS_BRIDGE_TOKEN is not. Copy the token from the ETABS Bridge window.");
  }

  const clients = new Map<string, BridgeClient>();
  const clientFor = (baseUrl: string, token: string) => {
    const key = `${baseUrl}|${token}`;
    let c = clients.get(key);
    if (!c) {
      c = new BridgeClient({ baseUrl, token, timeoutMs });
      clients.set(key, c);
    }
    return c;
  };

  return {
    instances: () => listInstances(registryDir),
    client(processId?: number): BridgeClient {
      if (pinnedUrl && pinnedToken) return clientFor(pinnedUrl, pinnedToken);

      const live = listInstances(registryDir);
      if (live.length === 0) {
        throw new ConnectionError(
          "No running ETABS Bridge found. In ETABS, open the model and run Tools > ETABS Bridge (the plugin window must stay open). " +
            `Discovery folder: ${registryDir}`,
        );
      }
      if (processId !== undefined) {
        const match = live.find((r) => r.processId === processId);
        if (!match) {
          throw new ConnectionError(`No ETABS Bridge for process ${processId}. Running: ${describe(live)}.`);
        }
        return clientFor(match.baseUrl, match.token);
      }
      if (live.length > 1) {
        throw new ConnectionError(`Several ETABS models are open; pass "instance" with one of: ${describe(live)}.`);
      }
      const only = live[0]!;
      return clientFor(only.baseUrl, only.token);
    },
  };
}

function describe(records: InstanceRecord[]): string {
  return records.map((r) => `${r.processId} (${r.modelPath || "unsaved model"})`).join(", ");
}
