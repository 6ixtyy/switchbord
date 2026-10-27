# Changelog

## 2026-10-27
- The API moved to `https://api.switchbord.xyz` (MCP at `/mcp`). The old `switchbord.vercel.app` address is retired. Site and API now run on free hosting (Cloudflare and Render); the API's memory use dropped by half.

## 2026-10-15
- Open source under MIT: the service code (`src/`), the site (`site/`) and build scripts are now published here alongside the docs. Run your own copy with `npm ci && npm run inventory && npm start`.
- New README with a quick start, a real example answer and a self-hosting guide. Pull requests welcome ([CONTRIBUTING.md](CONTRIBUTING.md)).

## 2026-10-13
- Claude Code plugin marketplace and Gemini CLI extension in this repo. MCP tools have titles and read-only/destructive hints. Privacy page.
- Listed in the official MCP Registry and on Smithery.
- `server.json` for the official MCP Registry (`io.github.6ixtyy/switchbord`).
- Public repo filled: README with MCP and API quick start, per-client MCP setup, `llms.txt`, runnable examples, contributing guide.

## 2026-10-12
- Public docs repo published: README, API contract, MCP setup.

## 2026-10-11
- Renamed to SwitchBord. Site live at switchbord.xyz. API also at switchbord.vercel.app.

## 2026-10-10
- Live on Vercel. Inventory rebuilt daily. Reports stored durably.

## 2026-10-09
- v0.1: one inventory of x402 and MPP endpoints, 19 markets, live health checks, ranking with backups, MCP tool.
