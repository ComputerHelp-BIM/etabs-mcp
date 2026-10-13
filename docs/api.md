# ETABS Bridge REST API v1

Served by the plugin inside ETABS at `http://localhost:{port}` (first free port from 52780).
All routes are under `/api/v1`. Responses are JSON (`application/json; charset=utf-8`).

The contract is defined three times and kept in sync by tests:

| Where | Used by |
| --- | --- |
| `plugin/src/EtabsBridge.Core/Model/*.cs` | the plugin (C#), DraftWin (VB.NET) |
| `packages/client/src/schemas.ts` (zod) | web app, MCP server, mock bridge |
| `contract/fixtures/*.json` | golden files: C# output must match byte for byte, and the zod schemas must accept them |

## Security

| Rule | Behaviour |
| --- | --- |
| Bind address | `localhost` only. Other machines cannot connect. |
| Host header | Only `localhost`, `127.0.0.1`, `[::1]` are served (DNS-rebinding protection), else `403 FORBIDDEN_HOST`. |
| Token | Every route except `/health` needs `Authorization: Bearer <token>` (or `X-Bridge-Token: <token>`). A new 256-bit token is generated each time the plugin starts. |
| Browser origins (CORS) | Requests carrying an `Origin` header must come from `allowedOrigins` in `%APPDATA%\EtabsBridge\settings.json`, else `403 FORBIDDEN_ORIGIN`. Entries are exact origins, `"*"`, or host wildcards like `https://my-app-*.vercel.app` (one `*` = one DNS label, never a dot). Non-browser clients (DraftWin, MCP, curl) send no Origin and are unaffected. Chrome's Private Network Access preflight is answered. |
| Writes | `POST /rpc` only allows `Get*`/`Count*` methods unless **Allow write operations** is ticked in the plugin window (`403 WRITE_DISABLED`). |
| Body size | 1 MiB max (`413 PAYLOAD_TOO_LARGE`). |

## Units

All values are in the model's **present units** at the time of the request, reported in every geometry response as
`units: { name: "kN_m_C", force: "kN", length: "m", temperature: "C" }`. The bridge never changes the user's units.

## Endpoints

| Method | Path | Result |
| --- | --- | --- |
| GET | `/health` | `{ status: "ok", bridgeVersion, apiVersion: "1", processId }`. No token, never touches ETABS. |
| GET | `/model` | `ModelInfo`: fileName, filePath, etabsVersion, etabsVersionNumber, isLocked, units, processId, bridgeVersion |
| GET | `/geometry` | `GeometrySnapshot`: model, units, baseElevation, stories, gridSystems, joints, frames, areas (one ETABS round trip) |
| GET | `/geometry/stories` | `{ units, baseElevation, stories[] }`, bottom to top, base excluded |
| GET | `/geometry/grids` | `{ units, gridSystems[] }` with xLines/yLines `{ id, ordinate, visible, bubbleLocation }` |
| GET | `/geometry/joints` | `{ units, joints[] }`: name, label, story, x, y, z, restraints `[UX,UY,UZ,RX,RY,RZ]` |
| GET | `/geometry/frames` | `{ units, frames[] }`: name, label, story, section, type (`Column`/`Beam`/`Brace`/`Null`/`Other`), joint1, joint2, start, end, angle, cardinalPoint |
| GET | `/geometry/areas` | `{ units, areas[] }`: name, label, story, section, type (`Wall`/`Floor`/`Ramp`/`Null`/`Other`), joints[], points[] |
| GET | `/sections` | `SectionsResult` (0.2.0): units; `materials[]` (name, type, color, e, poisson, thermalCoefficient, unitWeight, fc, fy, fu); `frameSections[]` (name, shape, etabsType, material, color, depth, width, flangeThickness, webThickness, bottomWidth, bottomFlangeThickness, properties{area, as2, as3, torsion, i22, i33, s22, s33, z22, z33, r22, r33}); `areaSections[]` (name, kind Slab/Wall/Deck/Other, subType, shellType, material, thickness, color); `warnings[]` |
| GET | `/loads` | `LoadsResult` (0.5.0): units; `patterns[]` (name, type, selfWeightMultiplier); `cases[]` (name, type, subType); `combinations[]` (name, type, items[{kind LoadCase/LoadCombo, name, factor}]); `frameDistributed[]`, `framePoint[]`, `areaUniform[]`, `jointLoads[]` (assigned loads of the whole model; direction codes 1-3 local, 4-6 global X/Y/Z, 7-9 projected, 10 gravity, 11 projected gravity); `warnings[]` |
| GET | `/results/status` | `{ isLocked, cases[{name, status NotRun/CouldNotStart/NotFinished/Finished}], combinations[], warnings[] }` (0.6.0) |
| GET | `/results/base-reactions?cases=A,B&combos=C` | Result page of `{loadCase, stepType, stepNum, fx, fy, fz, mx, my, mz}` |
| GET | `/results/story-drifts?cases=…` | Rows `{story, loadCase, stepType, stepNum, direction, drift, label, x, y, z}` |
| GET | `/results/joint-reactions?cases=…[&joint=]` | Rows `{joint, loadCase, stepType, stepNum, f1..f3, m1..m3}` (all supports, or one joint) |
| GET | `/results/joint-displacements?cases=…[&joint=]` | Rows `{joint, …, u1..u3, r1..r3}` |
| GET | `/results/frame-forces?cases=…[&frame=]` | Rows `{frame, station, …, p, v2, v3, t, m2, m3}`; page it when `frame` is omitted |
| GET | `/design/concrete` | Rows `{frame, kind Beam/Column, location, topArea, bottomArea, longitudinalArea, shearAreaPerLength, ratio, combo}` |
| GET | `/tables` | `{ tables[] }`: key, name, importType, isEmpty — every ETABS database table |
| GET | `/tables/data?key=K[&group=All][&fields=a,b][&offset=0][&limit=N]` | `TableData`: key, version, group, fields[], totalRows, offset, rows[][] (strings as ETABS shows them) |
| GET | `/rpc/describe[?path=FrameObj]` | Objects and methods (parameter names, types, ref/out, enum values) of any CSI API object |
| POST | `/rpc` | Body `{ "method": "FrameObj.GetSection", "args": { "Name": "C1" } }` → `{ method, returnValue, outputs }` |

**Sections are read by late binding.** The bridge calls the CSI section/material getters by name (for example
`PropFrame.GetISection_1`, falling back to `GetISection`). A getter that is missing or fails in your ETABS version
leaves the affected values `null` and adds a line to `warnings`; the request still succeeds. Section depth (`t3`)
is along local axis 2, width (`t2`) along local axis 3.

**Result pages** share one envelope: `{ units, cases[], combinations[], totalRows, offset, rows[], warnings[] }`, with
`offset`/`limit` paging. At least one of `cases` or `combos` (comma-separated names) is required. Selecting
results changes the ETABS session's output selection (`Results.Setup`), never model data, so it works without
write mode.

`name` is the ETABS unique name. `label` is what the ETABS UI shows, and it is unique only within a story.

### RPC details

- `method` is a dot path from `SapModel`; a leading `SapModel.` is optional. Method and parameter names are case-insensitive.
- `args` is an object (by parameter name), an array (positional), or omitted. Omitted `ref`/`out` parameters start empty;
  omitted optional parameters use their declared default.
- Enums are accepted as name (`"Column"`) or number, and returned as names.
- `returnValue` is the API's return code (0 = success for most CSI methods). A non-zero code is **not** an HTTP error, so
  the client decides. Exceptions thrown inside ETABS become `502 ETABS_API_ERROR`.

## Errors

```json
{ "error": { "code": "UNAUTHORIZED", "message": "Missing or invalid token. ..." } }
```

| HTTP | code | Meaning |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | Invalid query, body or RPC arguments |
| 401 | `UNAUTHORIZED` | Missing or wrong token |
| 403 | `FORBIDDEN_ORIGIN` / `FORBIDDEN_HOST` / `WRITE_DISABLED` | See Security |
| 404 | `NOT_FOUND` | Unknown route, API object or method |
| 405 | `METHOD_NOT_ALLOWED` | Wrong HTTP method (`Allow` header lists valid ones) |
| 413 | `PAYLOAD_TOO_LARGE` | Body over 1 MiB |
| 502 | `ETABS_API_ERROR` | An ETABS API call failed (message names the call and return code) |
| 503 | `ETABS_BUSY` | ETABS did not run the request within `callTimeoutSeconds` (e.g. a modal dialog is open) |
| 500 | `INTERNAL` | Bug; please report with the message |

## Examples

```bash
TOKEN=...   # from the ETABS Bridge window
curl -H "Authorization: Bearer $TOKEN" http://localhost:52780/api/v1/model
curl -H "Authorization: Bearer $TOKEN" "http://localhost:52780/api/v1/tables/data?key=Story%20Definitions"
curl -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"method":"PropFrame.GetNameList"}' http://localhost:52780/api/v1/rpc
```

## Versioning

- `apiVersion` (`/api/v1`) changes only for breaking changes, which also bump the MAJOR version.
- Adding fields or endpoints is a MINOR change; clients must ignore unknown fields (the zod schemas do).
- `bridgeVersion` is the plugin's semantic version (`MAJOR.MINOR.PATCH`, from `/VERSION`).
