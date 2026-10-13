# Deploying the web app on Vercel

The web app is a static single-page app. Your browser talks directly to the ETABS Bridge plugin on **your own
machine** (`http://localhost:52780`). Vercel only serves the HTML/JS, so model data and tokens never pass through
Vercel.

```
Browser (https://<your-app>.vercel.app)
   │ 1. loads the app from Vercel
   │ 2. fetch http://localhost:52780/api/v1/...  (token in header, CORS-checked by the plugin)
   ▼
ETABS + ETABS Bridge plugin (same PC)
```

## 1. Create the Vercel project

1. In Vercel: **Add New → Project →** import `ComputerHelp-BIM/etabs-mcp`.
2. **Root Directory:** leave it as the repository root. `vercel.json` already sets:
   - install `npx --yes npm@11 ci` (npm 11 is needed for the workspace install)
   - build `npm run build:libs && npm run build -w @etabs-bridge/web`
   - output `apps/web/dist`
   - security headers, including a Content-Security-Policy that only allows the app to call itself and `localhost`
3. **Production Branch:** `dev` (or `main` later), under Settings → Git.
4. Deploy. The app is at `https://<project>.vercel.app`.

No environment variables are needed.

## 2. Allow the Vercel origin in the plugin

On each PC that runs ETABS, edit `%APPDATA%\EtabsBridge\settings.json` and restart the bridge window:

```json
{
  "preferredPort": 52780,
  "allowedOrigins": [
    "http://localhost:5173",
    "https://etabs-viewer.vercel.app",
    "https://etabs-viewer-*.vercel.app"
  ],
  "webAppUrl": "https://etabs-viewer.vercel.app/",
  "callTimeoutSeconds": 120
}
```

- Replace `etabs-viewer` with your project name. The second entry covers preview deployments
  (`https://etabs-viewer-git-dev-team.vercel.app`, ...). A `*` matches exactly one DNS label (letters, digits,
  hyphens), never a dot.
- Avoid a bare `"https://*.vercel.app"`. It would let *any* Vercel-hosted site ask for your data; the token
  still protects you, but there's no reason to widen the door.
- `webAppUrl` makes **Open web app** in the plugin window open the Vercel app, already connected.

## 3. Browser notes

| Browser | Status |
| --- | --- |
| Chrome / Edge | Works. Recent versions ask once **"Allow access to apps on this device?"** (Local Network Access) when an `https://` site calls `localhost`; click **Allow**. The plugin already answers the related CORS preflight. |
| Firefox | Works. |
| Safari | Not supported for the hosted app. Safari blocks `http://localhost` requests from `https://` pages. Use Chrome or Edge, or run the app locally (`npm run dev:web`). |

## 4. Check the deployment

1. Open the model in ETABS → **Tools → ETABS Bridge** → **Open web app**.
2. If it says "Cannot reach the bridge", open the browser's developer tools. A CORS or `403 FORBIDDEN_ORIGIN` error
   means the origin is missing from `allowedOrigins`. A blocked request with no response usually means the browser
   permission prompt was dismissed (Chrome: site settings → *Local network access* → Allow).
