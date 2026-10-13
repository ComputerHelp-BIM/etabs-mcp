# Hosting the web app on Vercel

The web app is a static single-page app. Your browser talks directly to the ETABS Bridge plugin on **your own
machine** (`http://localhost:52780`). Vercel only serves the HTML/JS, so model data and tokens never pass through
Vercel.

```
Browser (https://etabs-bridge.vercel.app)
   │ 1. loads the app from Vercel
   │ 2. fetch http://localhost:52780/api/v1/...  (token in header, CORS-checked by the plugin)
   ▼
ETABS + ETABS Bridge plugin (same PC)
```

## The project

| Setting | Value |
| --- | --- |
| Vercel team / project | `computer-help` / `etabs-bridge` |
| Production URL | **https://etabs-bridge.vercel.app** |
| Git repository | `ComputerHelp-BIM/etabs-mcp` |
| Production branch | `dev` (the repository's default branch): every push to `dev` deploys to production |
| Preview deployments | every other branch and pull request, at `https://etabs-bridge-<hash>-computer-help.vercel.app` (Vercel login required by default) |
| Root directory | repository root; build settings come from `vercel.json` |
| Environment variables | none needed |

`vercel.json` sets:

- install `npx --yes npm@11 ci` (npm 11 is needed for the workspace install)
- build `npm run build:libs && npm run build -w @etabs-bridge/web`
- output `apps/web/dist`
- security headers, including a Content-Security-Policy that only lets the app call itself and `localhost`

Because production follows `dev`, CI runs on every push to `dev` as well; a red CI run does not stop Vercel from
deploying. Keep `dev` green, or move production to `main` later (Vercel → Settings → Git → Production Branch).

## Plugin settings

From 0.6.1 the plugin's defaults already point at the hosted app. A new `%APPDATA%\EtabsBridge\settings.json`
is created as:

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

- **Open web app** in the plugin window opens the hosted app, already connected.
- The second origin covers preview deployments. A `*` matches exactly one DNS label (letters, digits, hyphens),
  never a dot, and only the `computer-help` Vercel team can create hosts ending in `-computer-help.vercel.app`.
- Avoid a bare `"https://*.vercel.app"`: it would let *any* Vercel-hosted site ask for your data. The token still
  protects you, but there is no reason to widen the door.
- **Existing settings files are not changed.** If you ran an older plugin, add the two `etabs-bridge` origins and
  `webAppUrl` yourself, or delete the file to get the new defaults.

## Browser notes

| Browser | Status |
| --- | --- |
| Chrome / Edge | Works. Recent versions ask once to **allow access to devices on your local network** when an `https://` site calls `localhost`; click **Allow**. If you blocked it: site settings (icon left of the address bar) → *Local network access* → Allow. |
| Firefox | Works. |
| Safari | Not supported for the hosted app: it blocks `http://localhost` requests from `https://` pages. Use Chrome or Edge, or run the app locally (`npm run dev:web`). |

## Try it without ETABS

```bash
npm ci && npm run mock
```

The mock bridge allows the hosted origins too and prints a `https://etabs-bridge.vercel.app/#bridgeUrl=…&token=…`
link: open it to use the hosted app against a generated sample building.

## Troubleshooting

1. Open the model in ETABS → **Tools → ETABS Bridge** → **Open web app**.
2. If it says "Cannot reach the bridge", open the browser's developer tools (F12 → Console):
   - a CORS error or `403 FORBIDDEN_ORIGIN`: the page's origin is missing from `allowedOrigins`;
   - a blocked request with no response: the local-network permission prompt was dismissed (see above);
   - `ERR_CONNECTION_REFUSED`: the bridge window is closed or uses another port.
