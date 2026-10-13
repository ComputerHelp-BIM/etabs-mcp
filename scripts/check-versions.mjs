#!/usr/bin/env node
/**
 * Fails when any component's version differs from /VERSION (semantic versioning,
 * MAJOR.MINOR.PATCH). Run in CI and before tagging a release:
 *   npm run check-versions
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const expected = read("VERSION").trim();
if (!/^\d+\.\d+\.\d+$/.test(expected)) {
  console.error(`VERSION "${expected}" is not MAJOR.MINOR.PATCH`);
  process.exit(1);
}

const found = [
  ["package.json", JSON.parse(read("package.json")).version],
  ...["packages/client", "apps/mock-bridge", "apps/mcp-server", "apps/web"].map((p) => [
    `${p}/package.json`,
    JSON.parse(read(`${p}/package.json`)).version,
  ]),
  ["plugin/Directory.Build.props", read("plugin/Directory.Build.props").match(/<Version>([^<]+)<\/Version>/)?.[1]],
  ["packages/client/src/index.ts", read("packages/client/src/index.ts").match(/CLIENT_VERSION = "([^"]+)"/)?.[1]],
  ["apps/mcp-server/src/server.ts", read("apps/mcp-server/src/server.ts").match(/SERVER_VERSION = "([^"]+)"/)?.[1]],
];

// Internal workspace dependencies must point at the same version.
for (const p of ["apps/mock-bridge", "apps/mcp-server", "apps/web"]) {
  const pkg = JSON.parse(read(`${p}/package.json`));
  for (const [name, range] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    if (name.startsWith("@etabs-bridge/")) found.push([`${p} -> ${name}`, range]);
  }
}

const bad = found.filter(([, v]) => v !== expected);
for (const [where, v] of found) console.log(`${v === expected ? "ok  " : "FAIL"} ${where}: ${v}`);
if (bad.length) {
  console.error(`\n${bad.length} version(s) differ from VERSION ${expected}.`);
  process.exit(1);
}
console.log(`\nAll components at ${expected}.`);
