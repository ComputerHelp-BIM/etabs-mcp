# MCP server: ETABS models for AI assistants

`apps/mcp-server` is a [Model Context Protocol](https://modelcontextprotocol.io) server (stdio). With it, Claude Desktop,
Claude Code or any other MCP client can read the model that is open in ETABS. It talks to the plugin's REST API, so the
plugin window must be open in ETABS.

## Setup

```powershell
npm install -g npm@11      # once; npm 10.9 has a workspace bug
npm ci
npm run build
```

Claude Desktop (`%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "etabs": {
      "command": "node",
      "args": ["C:\\path\\to\\etabs-mcp\\apps\\mcp-server\\dist\\main.js"]
    }
  }
}
```

Claude Code: `claude mcp add etabs -- node C:\path\to\etabs-mcp\apps\mcp-server\dist\main.js`

## Choosing the ETABS instance

1. If `ETABS_BRIDGE_URL` and `ETABS_BRIDGE_TOKEN` are set, that bridge is used.
2. Otherwise the server reads `%LOCALAPPDATA%\EtabsBridge\instances`. With one model open it is used automatically.
   With several, the assistant calls `etabs_list_instances` and passes `instance` (the ETABS process ID).

Tokens never appear in tool output.

## Tools

| Tool | Purpose |
| --- | --- |
| `etabs_list_instances` | Open models (process ID, model path, versions) |
| `etabs_get_model_info` | File, ETABS version, lock state, units |
| `etabs_get_geometry_summary` | Counts by type/story, sections in use, supports, bounding box (best first call) |
| `etabs_get_stories`, `etabs_get_grids` | Levels and grid lines |
| `etabs_get_joints`, `etabs_get_frames`, `etabs_get_areas` | Paged (`offset`/`limit`, `nextOffset`), filterable by story/type/section |
| `etabs_list_tables`, `etabs_get_table` | Any ETABS database table, searchable and paged |
| `etabs_describe_api`, `etabs_call_api` | The whole CSI API. Writes are refused unless enabled in the plugin window |

List reads are cached for 15 s (`ETABS_BRIDGE_CACHE_SECONDS`) so paging through a large model reads ETABS once.

## Try it without ETABS

```bash
npm run mock          # mock bridge on :52780, registered for discovery
npx @modelcontextprotocol/inspector node apps/mcp-server/dist/main.js
```
