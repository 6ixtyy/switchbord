# SwitchBord

**A free, live router for paid agent APIs (x402 and MPP).** Your agent asks for a task ("search the web", "ETH price", "scrape a page"). SwitchBord answers with the sellers that are working, cheapest and fastest right now, checked live just before it answers, plus backups.

- **Free.** No signup, no keys, no auth.
- **Never touches your money.** Your agent pays the seller directly with its own wallet and x402 or MPP client. SwitchBord only says who to call.
- **One inventory across protocols.** 33,000+ paid endpoints from x402 (Coinbase Bazaar) and MPP (mpp.dev), rebuilt daily and grouped into markets of interchangeable sellers. If no market fits, you still get the closest single endpoints.
- **Live, not a directory.** The top candidates get a free, unpaid check right before the answer, so dead sellers drop out.

Site: **https://switchbord.xyz** · API: `https://switchbord.vercel.app` · MCP: `https://switchbord.vercel.app/mcp`

## Connect over MCP

Remote MCP server, streamable HTTP, stateless, no auth.

Claude Code:

```bash
claude mcp add --transport http switchbord https://switchbord.vercel.app/mcp
```

Most other clients (Cursor, Windsurf, Cline and others that read an `mcpServers` block):

```json
{ "mcpServers": { "switchbord": { "type": "http", "url": "https://switchbord.vercel.app/mcp" } } }
```

Per-client setup (Claude Desktop, VS Code, Cursor): [MCP.md](MCP.md).

| Tool | Use it to |
|---|---|
| `find_paid_endpoint` | Get the best sellers for a task, with backups. Pass `accepts` (e.g. `["x402:base:usdc"]`) so you only get sellers you can pay |
| `list_markets` | See the markets and how many sellers each has |
| `report_result` | Optional: say how a call went, which improves rankings for everyone |

## Or call the HTTP API

```bash
curl "https://switchbord.vercel.app/route?task=search%20the%20web&accepts=x402:base:usdc&max_price=0.05"
```

Returns ranked `candidates`, each with the URL to call, price, payment options, the seller's example input and a live health check. Full shapes: [API.md](API.md). Runnable snippets: [examples/](examples/).

| Endpoint | What |
|---|---|
| `GET /route?task=…` | Ranked sellers for a task, checked live |
| `GET /markets` | Markets and seller counts |
| `GET /endpoints/:id` | One endpoint from the inventory |
| `POST /report` | Optional: how a call went |
| `GET /healthz` | Inventory size and when it was last rebuilt |
| `POST /mcp` | The MCP server |

## How it works

1. Your agent asks for a task.
2. SwitchBord picks the matching sellers, checks the top ones live (a free, unpaid request that reads the seller's payment terms), and ranks them by health, speed, price and real use.
3. Your agent calls the best one and pays it directly. If it fails, it can try a backup.
4. Optionally, your agent reports how the call went.

## Paying sellers

SwitchBord does not pay for you, hold funds, or guarantee sellers. To call a paid seller your agent needs its own wallet and an x402 or MPP client, for example Coinbase's `@x402/fetch` for x402. Each candidate says how it charges: `after_success` (x402: only charged when the seller answers OK, so trying a backup after a failure is safe) or `before_handler` (MPP: charged up front).

## For LLMs

[llms.txt](llms.txt) is a short, plain-text summary of this repo for language models and agents.

## This repo

Public docs for SwitchBord: the API contract, MCP setup and examples. The service itself is developed in a separate private repo and this one is published from it, so pull requests here can't be merged directly; open an issue instead ([CONTRIBUTING.md](CONTRIBUTING.md)). What changed: [CHANGELOG.md](CHANGELOG.md). Security: [SECURITY.md](SECURITY.md). License: [MIT](LICENSE).
