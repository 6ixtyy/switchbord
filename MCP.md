# Connect an agent over MCP

SwitchBord is a remote MCP server: streamable HTTP, stateless, no auth.

**URL:** `https://api.switchbord.xyz/mcp`

## Setup by client

**Claude Code**

```bash
claude mcp add --transport http switchbord https://api.switchbord.xyz/mcp
```

Or install it as a Claude Code plugin (same server, updates with this repo):

```
/plugin marketplace add 6ixtyy/switchbord
/plugin install switchbord@switchbord
```

**Gemini CLI:**

```bash
gemini extensions install https://github.com/6ixtyy/switchbord
```

**Claude Desktop and claude.ai:** Settings → Connectors → Add custom connector, then paste the URL above.

**Cursor** (`~/.cursor/mcp.json` or `.cursor/mcp.json` in a project):

```json
{ "mcpServers": { "switchbord": { "url": "https://api.switchbord.xyz/mcp" } } }
```

**VS Code** (`.vscode/mcp.json`):

```json
{ "servers": { "switchbord": { "type": "http", "url": "https://api.switchbord.xyz/mcp" } } }
```

**Other clients** that read an `mcpServers` block:

```json
{ "mcpServers": { "switchbord": { "type": "http", "url": "https://api.switchbord.xyz/mcp" } } }
```

Clients that only speak stdio can bridge with [`mcp-remote`](https://www.npmjs.com/package/mcp-remote): `npx mcp-remote https://api.switchbord.xyz/mcp`.

## Tools

| Tool | Use it to |
|---|---|
| `find_paid_endpoint` | Get the best sellers for a task, with backups. Pass `accepts` with the payment methods your agent has (e.g. `["x402:base:usdc"]`) so you only get sellers you can pay |
| `list_markets` | See the markets and how many sellers each has |
| `report_result` | Optional: say how a call went |

Shapes are in [API.md](API.md).

## Check it by hand

```bash
curl -s -X POST https://api.switchbord.xyz/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Paying

SwitchBord does not pay for you. To call a paid seller your agent needs its own wallet and an x402 or MPP client, for example Coinbase's `@x402/fetch` for x402. Each candidate shows how it charges: `after_success` (x402: you are only charged when the seller answers OK, so trying a backup after a failure is safe) or `before_handler` (MPP: charged up front).
