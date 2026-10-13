# Architecture and design decisions

```
 ETABS process (one per open model)                          Clients
┌──────────────────────────────────────────────┐
│ EtabsBridgePlugin.dll  (Tools > ETABS Bridge) │   HTTP    ┌──────────────────────┐
│                                               │◄─────────►│ Web app (React/Three)│
│  cPlugin ─► BridgeForm (modeless window)      │ localhost │ apps/web             │
│               │                               │  + token  └──────────────────────┘
│               ▼                               │           ┌──────────────────────┐
│  BridgeHost ─ BridgeHttpServer (HttpListener) │◄─────────►│ MCP server (stdio)   │◄─► Claude / AI clients
│      │         └─ BridgeApi (auth, CORS,      │           │ apps/mcp-server      │
│      │             routing, errors)           │           └──────────────────────┘
│      │               │                        │           ┌──────────────────────┐
│      │     SynchronizationContextDispatcher   │◄─────────►│ DraftWin (VB.NET)    │
│      │      (marshals to ETABS UI thread)     │           └──────────────────────┘
│      │               ▼                        │
│      │   GeometryService / ApiInvoker (RPC)   │   %LOCALAPPDATA%\EtabsBridge\instances\{pid}.json
│      │               ▼                        │   (discovery: URL + token per instance)
│      │     EtabsApiModel ─► cSapModel (OAPI)  │
│      └─► InstanceRegistry ───────────────────────►
└──────────────────────────────────────────────┘
```

## Projects

| Path | Language | Role |
| --- | --- | --- |
| `plugin/src/EtabsBridge.Core` | C# netstandard2.0 | Contract DTOs, JSON, geometry service, reflective RPC, HTTP server, discovery, settings. **No ETABS dependency, so it is fully unit-tested on Linux CI.** |
| `plugin/src/EtabsBridge.Etabs` | C# net48 / net8.0-windows | The only code calling `ETABSv1`: `EtabsApiModel` adapter and `EtabsConnector` (attach by PID) |
| `plugin/src/EtabsBridgePlugin` | C# WinForms | `cPlugin` entry point and the bridge window. Compiles Core + Etabs sources into one DLL |
| `plugin/stubs/ETABSv1.Stub` | C# | Compile-only stub so CI can type-check the adapter/plugin without ETABS |
| `packages/client` | TypeScript | zod schemas, typed `BridgeClient`, geometry summary, connection-link parsing, discovery reader (Node entry) |
| `apps/mock-bridge` | TypeScript | Same API backed by a generated building: development and tests without ETABS |
| `apps/mcp-server` | TypeScript | MCP tools over the client |
| `apps/web` | React + Vite + Three.js | Sample web app |

## Key decisions

**HTTP server inside the plugin (not an external process attaching over COM).**
ETABS hands the plugin the exact `cSapModel` of the instance the user clicked, so "which instance?" is solved by
construction. Clients connect over localhost TCP, which works across UAC elevation levels; COM attach does not, and
that caused the original "sometimes reads nothing" bug. Trade-off: the plugin window must stay open while clients
read. External attach is still available for DraftWin (`EtabsConnector`).

**All ETABS calls are marshalled onto the ETABS UI thread.**
The OAPI object belongs to the thread ETABS called `Main` on. HTTP requests arrive on worker threads, so the
`SynchronizationContextDispatcher` posts each unit of work to the UI thread and waits with a timeout (`ETABS_BUSY`
instead of a hang). A whole `/geometry` read is one dispatch, not thousands.

**Ports and adapters.** `IEtabsModel` is the port. `EtabsApiModel` is a thin adapter: one API call group per method,
with each return code checked. Ordering, base-story handling, area coordinate resolution, unit parsing and colour
conversion all live in Core, where they are tested with fakes.

**Sections and materials use late binding (0.2.0).** The material/section API has dozens of shape-specific getters
whose names and signatures vary between ETABS versions (`GetISection` vs `GetISection_1`, ...). `SectionService`
calls them by name through the same reflective engine as `/rpc` (`ApiInvoker.InvokeWithInputs`), reading outputs by
parameter name. A missing or changed getter becomes a `warnings` entry with `null` values instead of a compile error
or a failed request. It also keeps all of that logic in Core, where it is unit-tested against fake CSI objects.

**Solid view geometry follows CSI conventions.** The web app sweeps each frame's section profile along local axis 1
using ETABS's local axes (2 up, or +X for vertical members; 3 = 1 × 2; rotation angle) and cardinal points (e.g. 8 =
top-centre for beams). Floors hang below their story level; walls are centred. Simplifications: end offsets, rigid
zones and insertion offsets are ignored; boxes and pipes are drawn solid; openings are not cut; asymmetric profiles
are placed by their bounding box.

**Zero NuGet dependencies in anything loaded into ETABS.** A plugin DLL runs under `ETABS.exe.config`, so shipping
System.Text.Json and its seven transitive assemblies risks version conflicts that we cannot fix with binding redirects.
Core therefore contains a small, strict, tested JSON reader/writer, and the plugin is a single DLL.

**Typed endpoints plus two "no restriction" paths.**
- The typed geometry endpoints are a stable, versioned contract for apps.
- `/tables` exposes every ETABS database table (definitions, assignments, loads, results) without per-table code.
- `/rpc` reaches any CSI API method by reflection, read-only by default and with an explicit, confirmed opt-in for writes.

**Security on localhost.** A random token for each session (constant-time compare), a CORS allow-list, a Host header
check against DNS rebinding, a body size limit, and a write opt-in. The token reaches the web app in the URL
*fragment*, which browsers never send to the web server, and the app removes it from the address bar immediately.

**Contract drift is a test failure.** C# writes `contract/fixtures/*.json`. The C# tests require byte-identical output and
the TypeScript tests validate the same files with the zod schemas.

## Known limits (v0.2.0)

- Loads and results are reachable through `/tables` and `/rpc` but have no typed endpoints yet (see the roadmap in the README).
- Section Designer, non-prismatic and auto-select sections have no dimensions; the solid view draws them with a
  marked placeholder size.
- Per-object API calls (labels, restraints, orientation) make very large models (100k+ objects) take seconds;
  bulk database tables could replace them later.
- Curved frames, cylindrical grid details and openings in areas are not modelled specially.
