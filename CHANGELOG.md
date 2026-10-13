# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.1] - 2026-10-13

### Added

- **Hosted web app** at https://etabs-bridge.vercel.app (Vercel project `etabs-bridge`; production follows `dev`).
- **Plugin CI/CD** (`.github/workflows/plugin.yml`): builds the plugin on Windows against CSI's signed ETABS API,
  runs the C# tests on Windows, packages `EtabsBridgePlugin-<version>.zip` (both frameworks, symbols, README with
  build provenance, SHA-256 sums) as an artifact, and publishes a GitHub Release for `v*` tags. A self-hosted runner
  with ETABS can be switched on with repository variables. See `docs/ci-cd.md`.
- **ETABS API contract check** (`scripts/check-etabs-api.sh`, `plugin/tools/ApiContractCheck`): every by-name API
  call (59 method paths, 123 output names) is checked against the real `ETABSv1.dll` metadata.
- `scripts/fetch-etabs-api.sh`: a SHA-256-pinned reference copy of `ETABSv1.dll` for builds without ETABS.
- **Currency picker** in BOQ & Cost: INR (default) plus USD, EUR, JPY, GBP, CNY, AUD, CAD, CHF, HKD, SGD, or any
  ISO code; amounts use the currency's digit grouping (lakh/crore for INR).
- The mock bridge prints a link for the hosted app and allows its origins.

### Changed

- Plugin defaults: **Open web app** opens the hosted app; `allowedOrigins` includes it and its preview deployments.
  Existing `settings.json` files are left as they are.
- Builds against a real `ETABSv1.dll` now fail unless it carries CSI's strong name (public key token
  `453d728ef24c6f5e`), so a plugin that ETABS cannot load is never produced.
- CI also runs on pushes to `dev`.
- Connection errors on the hosted app explain the browser's local-network permission and `allowedOrigins`.

### Fixed

- Changing the BOQ currency no longer clears the "sample rates" flag (the numbers are still INR samples).
- Removed two unverified fallback output names (`My`, `DeckMatProp`) that do not exist in the ETABS API.
- `README.md` described version 0.2.0.

## [0.6.0] - 2026-10-13

### Added

- **Analysis results**: `/results/status` (case run status, combinations), `/results/base-reactions`,
  `/results/story-drifts`, `/results/joint-reactions`, `/results/joint-displacements`, `/results/frame-forces`
  (select cases/combos, paged). Read by late binding with output selection through `Results.Setup`.
- **Concrete design**: `/design/concrete` required longitudinal/shear steel and PMM ratios per frame and station.
- **Design rebar in the BOQ**: required steel converted to kg per frame, optionally replacing kg/m³ ratios.
- Web app **Results** tab: case/combination picker; base reactions with a gravity cross-check against the load
  takedown; story drift profile chart with a drift limit; deformed shape in 3D; frame force diagrams; concrete design.
- MCP tools `etabs_get_analysis_status`, `etabs_get_base_reactions`, `etabs_get_story_drifts`,
  `etabs_get_joint_reactions`, `etabs_get_joint_displacements`, `etabs_get_frame_forces`, `etabs_get_concrete_design`;
  `etabs_get_boq` gains `useDesignRebar`.
- Mock bridge: consistent synthetic results (clearly flagged). See `docs/results.md`.

### Changed

- RPC policy: every method of the CSI `Results` object (results readers and `Results.Setup` output selection) is
  read-only, since none changes model data.
- Line charts support negative values (moment and shear diagrams).

## [0.5.0] - 2026-10-13

### Added

- **Loads** (`GET /api/v1/loads`): load patterns (type, self-weight multiplier), load cases (type), combinations
  (type and factored items), and assigned loads for the whole model: frame distributed and point loads, area uniform
  loads, joint forces. Late-bound like sections: missing getters give warnings, not failures.
- **Gravity takedown** per pattern (area + line + point + joint loads in the gravity direction), a quick independent
  check against base reactions.
- Web app **Loads** tab (takedown, cases, combinations, assigned loads by pattern; loaded on first open).
- MCP tool `etabs_get_loads`; `BridgeClient.loads()`; mock bridge sample loads.

### Changed

- Internal: shared `LateBoundApi` for the late-bound readers (sections, loads, results).

## [0.4.0] - 2026-10-13

### Added

- **4D simulation**: story-by-story construction schedule generated from the model (columns & walls, then beams &
  slab, with a lag between floors) on a working-day calendar with holidays; editable task dates with forward
  re-sequencing; CSV export and date import; playback in the 3D view (future elements hidden, elements under
  construction highlighted) with built/under-construction counts.
- **4D + 5D**: cost per task and a planned-value S-curve; planned cost to date during playback.
- Gantt chart and line chart components (accessible SVG, validated colours, hover/keyboard tooltips).
- MCP tool `etabs_generate_schedule`; shared client module `schedule`. See `docs/4d-simulation.md`.

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
