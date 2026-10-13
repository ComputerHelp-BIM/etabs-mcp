# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
