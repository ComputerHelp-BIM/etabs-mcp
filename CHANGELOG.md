# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-10-13

### Added

- **BOQ (quantity take-off)** from the live model: concrete m³ by grade and element type, formwork m², reinforcement
  kg (editable kg/m³ ratios), structural steel t; grouped by item or by item and story; wastage %; SI output for any
  model unit system. Unmeasurable objects are listed, never guessed. See `docs/boq-5d.md`.
- **5D costing**: editable rate table (currency, concrete per grade, formwork per element type, rebar, steel per
  grade) with clearly flagged sample rates; totals by item, element type and story; cost-by-story chart.
- **Project files**: settings and rates are kept per model in the browser, with export/import as JSON; BOQ and rates
  export/import as CSV (formula-injection safe).
- MCP tool `etabs_get_boq` (optional rates, currency, rebar-ratio overrides, grouping).
- Shared client modules `units`, `quantities`, `costing`.

## [0.2.0] - 2026-10-13

### Added

- **Sections & materials** (`GET /api/v1/sections`): materials (type, E, Poisson, thermal coefficient, unit weight,
  f'c, Fy, Fu), frame sections (normalized shape, material, depth/width/flange/web dimensions, section properties),
  and area sections (slab/wall/deck, sub-type, shell type, thickness, material). Read by late binding: a getter
  missing in your ETABS version yields `null` values plus a `warnings` entry instead of failing.
- **Solid 3D view** (default) next to the analytical view: frames swept with their real section profile using ETABS
  local axes, rotation angle and cardinal points; slabs and walls extruded by thickness; crease edges for a concrete look.
- **Colour by** object type, material, section or story, with a data-driven legend.
- Web app **Sections** and **Materials** tabs; the Properties panel shows section size, area and material.
- MCP tool `etabs_get_sections`; `BridgeClient.sections()`.
- Host-wildcard **allowed origins** (`https://my-app-*.vercel.app`), with identical rules in C# and TypeScript.
- **Vercel deployment**: `vercel.json` (build, output, security headers with a strict Content-Security-Policy) and
  `docs/deploy-vercel.md`.

### Changed

- RPC: omitted enum parameters now default to value 0 (CSI's "all/none"), not the first enum member.

## [0.1.0] - 2026-10-13

### Added

- **ETABS plugin** (`EtabsBridgePlugin.dll`, net48 and net8.0-windows): Tools-menu command that serves the clicked
  ETABS instance over a localhost REST API, with a window showing the URL and token, a request log, "Open web app",
  and a confirmed opt-in for write operations.
- **REST API v1**: model info; geometry (stories, grids, joints, frames, areas, and a full snapshot); the ETABS
  database table catalogue and paged table data; reflective RPC to any CSI API method with introspection.
- **Security**: per-session 256-bit token, CORS allow-list, Host header check, body size limit, write protection,
  request timeout (`ETABS_BUSY`).
- **Discovery**: one record per ETABS process in `%LOCALAPPDATA%\EtabsBridge\instances`.
- **EtabsBridge.Core** (netstandard2.0, no dependencies) and **EtabsBridge.Etabs** for direct use from DraftWin/VB.NET,
  including attach-by-process-ID.
- **@etabs-bridge/client**: zod schemas, typed client, geometry summary, discovery reader.
- **Sample web app**: 3D viewer (story filter, selection, properties), summary, data tables, database table browser,
  API console.
- **MCP server**: 12 tools for model info, geometry, tables and the CSI API, with paging and instance selection.
- **Mock bridge** for development and tests without ETABS.
- Contract fixtures shared by the C# and TypeScript test suites; CI for both.
