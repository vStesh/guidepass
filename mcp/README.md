# mcp

Remote MCP server that lets an AI agent read guide-writing instructions, upload and update guides, and read run results. The design and the reasons behind it are in [DESIGN.md](DESIGN.md).

The code lives in `api/src/mcp/` and runs in the API Lambda: `/mcp` next to `/api`, on the same domain as the web app, using the same services as the web API.

## Connect an agent

1. A team owner creates a token on the **Team** page (**AI agent tokens**): *Read* for analysis only, *Read and write* to upload guides. The token is shown once.
2. Add the server to Claude Code:

   ```bash
   claude mcp add --transport http guidepass https://gp.example.com/mcp --header "Authorization: Bearer gp_..."
   ```

The page shows this command with your instance's address and the new token filled in. Revoking a token cuts access immediately.

## Tools

| Tool | Scope |
| --- | --- |
| `list_apps` | read |
| `get_guide_instructions` | read |
| `list_guides` | read |
| `get_guide` | read |
| `get_results` | read |
| `create_area` | write |
| `upload_guide` | write |
| `set_guide_status` | write |

Agents never create runs or set results, and nothing can be deleted through MCP.

Locally the server runs with the API (`npm run dev -w api`) at `http://localhost:8787/mcp`, and the web dev server proxies `/mcp` too.
