# Building and installing the ETABS plugin

## Requirements

- Windows 10/11 x64 with ETABS installed (developed against ETABS 22).
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0). It builds both the `net48` and the `net8.0-windows` plugin.
- Visual Studio 2022 is optional; the `dotnet` CLI is enough.

## Download a build (easiest)

1. Get `EtabsBridgePlugin-x.y.z.zip` from the latest
   [GitHub Release](https://github.com/ComputerHelp-BIM/etabs-mcp/releases), or from the newest
   [Plugin workflow run](https://github.com/ComputerHelp-BIM/etabs-mcp/actions/workflows/plugin.yml) on `dev`
   (*Artifacts*, kept 30 days).
2. **Unblock it before extracting:** right-click the zip → Properties → tick **Unblock** → OK. Windows marks
   downloaded files, and .NET may refuse to load a blocked plugin DLL.
3. Extract it to a permanent folder (ETABS loads the DLL from there every time), then continue with
   [Which framework folder?](#which-framework-folder) and [Register in ETABS](#register-in-etabs-once-per-user).

These builds are compiled against CSI's signed ETABS API (see [ci-cd.md](ci-cd.md)); `README.txt` in the zip records
exactly how each one was built.

## Build it yourself

```powershell
cd plugin
dotnet build EtabsBridge.sln -c Release `
  -p:EtabsInstallDir="C:\Program Files\Computers and Structures\ETABS 22"
dotnet test tests\EtabsBridge.Core.Tests -c Release
```

`EtabsInstallDir` must contain `ETABSv1.dll`. The build references it without copying it, because ETABS loads its own copy.

Output: `plugin\src\EtabsBridgePlugin\bin\Release\<framework>\EtabsBridgePlugin.dll`. This is **one self-contained DLL** with no
other files to copy.

### Which framework folder?

| ETABS runs on | Use |
| --- | --- |
| .NET Framework 4.x (ETABS 21 and older) | `net48\EtabsBridgePlugin.dll` |
| .NET 8 (newer ETABS builds) | `net8.0-windows\EtabsBridgePlugin.dll` |

If you are unsure, check `ETABS.exe` in the install folder: a `ETABS.runtimeconfig.json` next to it means .NET 8.
You can build only one with `-p:EtabsTargetFrameworks=net48` (or `net8.0-windows`). If the build fails for one
framework because your `ETABSv1.dll` targets only the other, that tells you which one ETABS uses.

## Register in ETABS (once per user)

1. ETABS → **Tools → Add/Show Plugins…**
2. **Plugin Name:** `EtabsBridgePlugin`. This must match the namespace that contains `cPlugin`.
3. **Path:** the DLL above. Set the menu text, e.g. *ETABS Bridge*.
4. **Add**, then **OK**. It now appears in the **Tools** menu.

## Use

1. Open a model and run **Tools → ETABS Bridge**.
2. The window shows the URL (`http://localhost:52780`, or the next free port for a second ETABS) and the token.
3. **Open web app** opens the configured web app with the connection in the URL fragment; **Copy connection JSON**
   is for pasting elsewhere. Local tools (DraftWin, MCP) find the instance automatically through
   `%LOCALAPPDATA%\EtabsBridge\instances\{pid}.json`.
4. **Stop and return to ETABS** (or closing the window) stops the server and tells ETABS the plugin has finished.

## Settings

`%APPDATA%\EtabsBridge\settings.json` is created on first run:

```json
{
  "preferredPort": 52780,
  "allowedOrigins": [
    "https://etabs-bridge.vercel.app",
    "https://etabs-bridge-*-computer-help.vercel.app",
    "http://localhost:5173",
    "http://127.0.0.1:5173"
  ],
  "webAppUrl": "https://etabs-bridge.vercel.app/",
  "callTimeoutSeconds": 120
}
```

- **Open web app** opens the hosted app at https://etabs-bridge.vercel.app ([deploy-vercel.md](deploy-vercel.md)).
  For local development set `webAppUrl` to `http://localhost:5173/`.
- To use another web app, add its origin to `allowedOrigins` (exact scheme+host+port, e.g. `"https://app.example.com"`,
  or a host wildcard such as `"https://my-app-*.vercel.app"`). `"*"` allows any origin; the token is still required.
- An existing file is never overwritten: files created by 0.6.0 or older still point at `localhost:5173`. Delete the
  file (or edit it) to pick up the hosted defaults.
- Invalid values are reported in the plugin's log and replaced by defaults.

## First-run checklist (please report results)

Since 0.6.1, CI compiles the plugin against CSI's signed ETABS API (v1, from a pinned reference copy) and checks
every by-name call against it, so items 1 and 2 already pass there. The rest can only be checked inside ETABS:

| # | Check | If it fails |
| --- | --- | --- |
| 1 | The build compiles against **your** `ETABSv1.dll` (only if you build it yourself) | Verified in CI against API v1. If your version differs, the compiler names the member; fix `EtabsApiModel.cs` (and the stub) |
| 2 | `cPlugin` implements `cPluginContract` | Verified in CI: the API v1 contract has `Main(ref cSapModel, ref cPluginCallback)` and `Info(ref string)` |
| 3 | ETABS loads the DLL from the framework folder you picked | Try the other framework folder |
| 4 | While the window is open, is the ETABS UI usable or locked? | Both are acceptable for reading; tell us which, because it decides how live editing will work |
| 5 | `GET /api/v1/geometry` returns your stories, frames and areas | Send the error message: it names the failing API call and return code |
| 5b | `GET /api/v1/sections` lists your materials and sections with dimensions | Send the `warnings` array: each line names the getter that is missing or failed |
| 5c | `GET /api/v1/loads` lists your patterns, combinations and assigned loads | Send the `warnings` array |
| 5d | After analysis: `GET /api/v1/results/status`, then `/results/base-reactions?cases=Dead` | Send the `warnings`; they name any results getter that differs |
| 6 | Port binding works without "Run as administrator" | Send the plugin log line; an http.sys URL ACL may be needed |

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Web app: "Cannot reach the bridge" | Plugin window closed, wrong port, or a firewall/antivirus blocking localhost |
| `401 UNAUTHORIZED` | The token is new for each session; copy it again |
| `403 FORBIDDEN_ORIGIN` | Add the web app origin to `allowedOrigins`, then restart the bridge |
| `503 ETABS_BUSY` | A modal dialog is open in ETABS, or analysis is running; close it and retry |
| `502 ETABS_API_ERROR` | The message names the API call; e.g. results tables need an analyzed model |
| Two ETABS windows | Each runs its own bridge on its own port; the web app connects to the one whose link you used |
