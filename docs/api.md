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
| Browser origins (CORS) | Requests carrying an `Origin` header must come from `allowedOrigins` in `%APPDATA%\EtabsBridge\settings.json`, else `403 FORBIDDEN_ORIGIN`. Non-browser clients (DraftWin, MCP, curl) send no Origin and are unaffected. Chrome's Private Network Access preflight is answered. |
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
| GET | `/tables` | `{ tables[] }`: key, name, importType, isEmpty — every ETABS database table |
| GET | `/tables/data?key=K[&group=All][&fields=a,b][&offset=0][&limit=N]` | `TableData`: key, version, group, fields[], totalRows, offset, rows[][] (strings as ETABS shows them) |
| GET | `/rpc/describe[?path=FrameObj]` | Objects and methods (parameter names, types, ref/out, enum values) of any CSI API object |
| POST | `/rpc` | Body `{ "method": "FrameObj.GetSection", "args": { "Name": "C1" } }` → `{ method, returnValue, outputs }` |

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
