# Building and installing the ETABS plugin

## Requirements

- Windows 10/11 x64 with ETABS installed (developed against ETABS 22).
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0). It builds both the `net48` and the `net8.0-windows` plugin.
- Visual Studio 2022 is optional; the `dotnet` CLI is enough.

## Build

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
  "allowedOrigins": ["http://localhost:5173", "http://127.0.0.1:5173"],
  "webAppUrl": "http://localhost:5173/",
  "callTimeoutSeconds": 120
}
```

- Add your production web app's origin to `allowedOrigins` (exact scheme+host+port, e.g. `"https://app.example.com"`).
  For Vercel preview URLs use a host wildcard such as `"https://my-app-*.vercel.app"`; see [deploy-vercel.md](deploy-vercel.md).
  `"*"` allows any origin; the token is still required.
- Invalid values are reported in the plugin's log and replaced by defaults.

## First-run checklist (please report results)

These points could not be verified without ETABS and are the most likely to need a small fix:

| # | Check | If it fails |
| --- | --- | --- |
| 1 | The build compiles against your real `ETABSv1.dll` | A signature differs from the stub in `plugin/stubs`; the compiler names the member. Fix `EtabsApiModel.cs` (and the stub) |
| 2 | `cPlugin` implements `cPluginContract` | If your `ETABSv1.dll` has no `cPluginContract`, remove `: cPluginContract` from `cPlugin.cs` |
| 3 | ETABS loads the DLL from the framework folder you picked | Try the other framework folder |
| 4 | While the window is open, is the ETABS UI usable or locked? | Both are acceptable for reading; tell us which, because it decides how live editing will work |
| 5 | `GET /api/v1/geometry` returns your stories, frames and areas | Send the error message: it names the failing API call and return code |
| 5b | `GET /api/v1/sections` lists your materials and sections with dimensions | Send the `warnings` array: each line names the getter that is missing or failed |
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
