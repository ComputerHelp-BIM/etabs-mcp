#!/usr/bin/env node
/**
 * ETABS Bridge MCP server (stdio). Configure in an MCP client, e.g. Claude Desktop:
 *
 *   { "mcpServers": { "etabs": { "command": "node", "args": ["C:\\path\\to\\apps\\mcp-server\\dist\\main.js"] } } }
 *
 * Environment (all optional):
 *   ETABS_BRIDGE_URL, ETABS_BRIDGE_TOKEN  pin one bridge instead of auto-discovery
 *   ETABS_BRIDGE_REGISTRY_DIR             discovery folder override
 *   ETABS_BRIDGE_TIMEOUT_SECONDS          per-request timeout (default 120)
 *   ETABS_BRIDGE_CACHE_SECONDS            list cache for paging (default 15, 0 = off)
 *
 * stdout carries the MCP protocol; diagnostics go to stderr only.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createResolver } from "./connection.js";
import { createEtabsMcpServer, SERVER_VERSION } from "./server.js";

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`${name} must be a non-negative number; using ${fallback}.`);
    return fallback;
  }
  return n;
}

try {
  const resolver = createResolver({ timeoutMs: seconds("ETABS_BRIDGE_TIMEOUT_SECONDS", 120) * 1000 });
  const server = createEtabsMcpServer({ resolver, cacheSeconds: seconds("ETABS_BRIDGE_CACHE_SECONDS", 15) });
  await server.connect(new StdioServerTransport());
  console.error(`etabs-bridge MCP server ${SERVER_VERSION} running on stdio`);
} catch (err) {
  console.error(`etabs-bridge MCP server failed to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
