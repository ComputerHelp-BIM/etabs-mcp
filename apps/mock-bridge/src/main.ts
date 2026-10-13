#!/usr/bin/env node
/**
 * CLI: run a mock ETABS Bridge for development without ETABS.
 *
 *   npm run mock                      # port 52780, random token, registered for MCP discovery
 *   MOCK_TOKEN=dev-token-0123456789 npm run mock
 *   node dist/main.js --port 52790 --stories 12 --bays-x 6 --bays-y 4 --latency 300 --allow-writes
 */
import { parseArgs } from "node:util";
import { startMockBridge } from "./server.js";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: process.env.MOCK_PORT ?? "52780" },
    token: { type: "string", default: process.env.MOCK_TOKEN },
    stories: { type: "string", default: "6" },
    "bays-x": { type: "string", default: "4" },
    "bays-y": { type: "string", default: "3" },
    latency: { type: "string", default: "0" },
    "allow-writes": { type: "boolean", default: false },
    "no-register": { type: "boolean", default: false },
    "web-app": { type: "string", default: process.env.MOCK_WEB_APP ?? "http://localhost:5173/" },
    "allow-origin": { type: "string", multiple: true },
  },
});

const int = (name: string, raw: string | undefined): number => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    console.error(`--${name} must be a non-negative integer (got "${raw}")`);
    process.exit(2);
  }
  return n;
};

const bridge = await startMockBridge({
  port: int("port", values.port),
  token: values.token,
  allowWrites: values["allow-writes"],
  latencyMs: int("latency", values.latency),
  register: !values["no-register"],
  allowedOrigins: values["allow-origin"],
  model: {
    stories: int("stories", values.stories),
    baysX: int("bays-x", values["bays-x"]),
    baysY: int("bays-y", values["bays-y"]),
  },
});

const link = `${values["web-app"]}#bridgeUrl=${encodeURIComponent(bridge.url)}&token=${encodeURIComponent(bridge.token)}`;
const g = bridge.model.geometry;
console.log(`Mock ETABS Bridge listening on ${bridge.url}`);
console.log(`  model : ${g.model.fileName} - ${g.stories.length} stories, ${g.joints.length} joints, ${g.frames.length} frames, ${g.areas.length} areas`);
console.log(`  token : ${bridge.token}`);
console.log(`  web   : ${link}`);
console.log(`  writes: ${values["allow-writes"] ? "ENABLED" : "disabled"}  |  Ctrl+C to stop`);

const shutdown = () => {
  bridge.close().finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
