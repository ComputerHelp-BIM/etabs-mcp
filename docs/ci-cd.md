# CI/CD

| What | Where | When | Result |
| --- | --- | --- | --- |
| **CI** (`.github/workflows/ci.yml`) | GitHub, Linux | push to `dev`/`main`, pull requests | C# tests, stub type-check, version check, TS typecheck/tests/build |
| **Plugin** (`.github/workflows/plugin.yml`) | GitHub, Windows (or your ETABS PC) | push to `dev`/`main`, pull requests, manual, `v*` tags | plugin built against the signed ETABS API, checked, zipped; on a tag also a GitHub Release |
| **Web app** | Vercel (`etabs-bridge`) | push to any branch | `dev` → production at https://etabs-bridge.vercel.app; other branches → previews. See [deploy-vercel.md](deploy-vercel.md) |

## The plugin workflow

1. **Version gate.** Reads `/VERSION`. On a tag, the tag must be exactly `v` + `VERSION` (e.g. `v0.6.1`), or the run
   fails before building anything.
2. **ETABS API.** A deployable plugin must be compiled against CSI's *signed* `ETABSv1.dll`. GitHub's machines have
   no ETABS, so by default `scripts/fetch-etabs-api.sh` downloads a reference copy (see
   [Where the ETABS API comes from](#where-the-etabs-api-comes-from)).
3. **API contract check.** `scripts/check-etabs-api.sh` compares every by-name API call in `EtabsBridge.Core`
   (sections, loads, results: 59 method paths, 123 output names) with the real API's metadata, and fails on any
   misspelt or missing method or output.
4. **Windows tests.** All C# tests again, on Windows, so the HTTP server is exercised on real `http.sys`.
5. **Build.** `net48` and `net8.0-windows` plugin. The build fails unless `ETABSv1` resolves with CSI's public key
   token `453d728ef24c6f5e` (see `plugin/EtabsApi.targets`), so a plugin that ETABS could not load is never produced.
6. **Package.** `EtabsBridgePlugin-<version>.zip` containing both DLLs with their `.pdb` files, `README.txt`
   (install steps and build provenance) and `SHA256SUMS.txt`, plus `EtabsBridgePlugin-<version>.zip.sha256`.
   It is uploaded as a workflow **artifact** for 30 days.
7. **Release** (tags only). Creates the GitHub Release `v<version>` with the zip and checksum, and release notes
   taken from that version's section in `CHANGELOG.md`. `0.x` versions are marked *pre-release*.

### Getting a build

- **Latest from `dev`:** Actions → *Plugin* → the newest run on `dev` → *Artifacts* → `EtabsBridgePlugin-x.y.z`.
- **A release:** Releases → `vX.Y.Z` → `EtabsBridgePlugin-X.Y.Z.zip`.

Unblock the zip before extracting (right-click → Properties → Unblock): Windows marks downloaded files, and .NET may
refuse to load a blocked plugin DLL.

### Making a release

1. Bump the version everywhere (`/VERSION`, packages, `plugin/Directory.Build.props`, `CLIENT_VERSION`,
   `SERVER_VERSION`); `npm run check-versions` confirms they agree.
2. Add the `## [X.Y.Z] - date` section to `CHANGELOG.md`.
3. Push to `dev` and wait for CI and *Plugin* to pass.
4. Tag that commit and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.

## Where the ETABS API comes from

| Mode | When | Source of `ETABSv1.dll` |
| --- | --- | --- |
| Reference copy (default) | GitHub-hosted `windows-latest` | `CSIAPIv1-All 2.12.0` from nuget.org, pinned by SHA-256 in `scripts/fetch-etabs-api.sh` |
| Your ETABS | a self-hosted runner, when configured (below) | the `ETABSv1.dll` of the ETABS installed on that PC |

About the reference copy:

- It is an **unofficial** third-party redistribution of CSI's API files; CSI publishes no NuGet package.
- It is used **only to compile against**: MSBuild never executes it, and it is not included in the plugin zip
  (`Private=false`). At run time the plugin binds to the `ETABSv1.dll` inside your ETABS.
- Its identity was verified: `ETABSv1, Version=1.0.0.0, PublicKeyToken=453d728ef24c6f5e`, "ETABS API v1",
  Computers and Structures, Inc. The plugin and every late-bound call compile and check cleanly against it.
- If the download ever changes, the SHA-256 check fails the build instead of using it.

### Switching to a self-hosted runner on your ETABS PC (optional, later)

This builds against the exact API of your installed ETABS. No code change is needed:

1. GitHub → repository **Settings → Actions → Runners → New self-hosted runner → Windows**. Follow the commands,
   and when asked for labels add `etabs`. Install it as a service if you want it to run without being logged in.
2. On that PC install **Git for Windows** (the workflow's scripts use its bash) and keep it on `PATH`.
3. Repository **Settings → Secrets and variables → Actions → Variables**:
   - `ETABS_RUNNER_LABEL` = `etabs`
   - `ETABS_INSTALL_DIR` = `C:\Program Files\Computers and Structures\ETABS 22` (your ETABS folder)
4. Re-run *Plugin*. The log line `ETABS API: ETABSv1.dll from the ETABS installation …` confirms it.

Safety rules built into the workflow:

- **Pull requests never run on the self-hosted runner**: they always use `windows-latest`, so code from a pull
  request cannot run on the PC with your ETABS licence.
- While the PC is off, pushes and tags wait for it. Delete `ETABS_RUNNER_LABEL` to go back to GitHub's machines.

## Local equivalents

```bash
scripts/fetch-etabs-api.sh                       # reference ETABSv1.dll into .etabs-api/ (git-ignored)
scripts/check-etabs-api.sh                       # contract check (or pass a path to your own ETABSv1.dll)
dotnet build plugin/src/EtabsBridgePlugin -c Release -p:EtabsInstallDir="$PWD/.etabs-api"
dotnet build plugin/EtabsBridge.sln -p:UseEtabsStub=true    # type-check only; never deploy this output
```
