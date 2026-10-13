ETABS Bridge plugin {VERSION}
================================

Connects the model open in ETABS to the ETABS Bridge web app
(https://etabs-bridge.vercel.app), MCP clients and DraftWin over a local, token-protected API.

Contents
--------
  net48\EtabsBridgePlugin.dll            for ETABS running on .NET Framework 4.x (ETABS 21 and older)
  net8.0-windows\EtabsBridgePlugin.dll   for ETABS running on .NET 8 (newer ETABS builds)
  *.pdb                                  debug symbols (keep them next to the DLL for readable error reports)
  SHA256SUMS.txt                         checksums of the files above

Not sure which one? If ETABS.runtimeconfig.json exists next to ETABS.exe, use net8.0-windows.

Install
-------
1. BEFORE extracting: right-click the downloaded .zip > Properties > tick "Unblock" > OK.
   (Windows marks downloaded files; .NET may refuse to load a blocked plugin DLL.)
2. Extract to a permanent folder, e.g. C:\ETABS Plugins\EtabsBridge\{VERSION}\
3. ETABS > Tools > Add/Show Plugins...
     Plugin Name : EtabsBridgePlugin   (exactly this: it is the namespace of cPlugin)
     Path        : the EtabsBridgePlugin.dll for your framework
     Menu text   : ETABS Bridge
   Add > OK.
4. Open a model, run Tools > ETABS Bridge, then click "Open web app".

Settings: %APPDATA%\EtabsBridge\settings.json (created on first run).
Full guide and first-run checklist: docs/install-plugin.md in the repository.

Build provenance
----------------
{PROVENANCE}
