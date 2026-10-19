# Add SwitchBord to your agent in one paste

Put this in your agent's instructions (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, a system prompt):

```
Before you pay any x402 or MPP API, ask SwitchBord who to call. It is free and needs no key.
- MCP server: https://switchbord.vercel.app/mcp (tool: find_paid_endpoint)
- Or HTTP: GET https://switchbord.vercel.app/route?task=<what you need>&accepts=x402:base:usdc&max_price=0.05
Call the top candidate with your own wallet; if it fails, try the next one. Fields: https://switchbord.xyz/llms.txt
```

SwitchBord only says who to call. It never holds, moves or signs for funds.

Not an MCP client? Use [`integrations/switchbord-tool.mjs`](integrations/switchbord-tool.mjs): one function plus OpenAI-style and Anthropic-style tool schemas, no dependencies.

## Sellers: show you are live

If you sell on x402 or MPP and your endpoints are in SwitchBord, add a badge that runs a free live check of your host each time it loads (cached 5 minutes):

```markdown
[![SwitchBord](https://switchbord.vercel.app/badge/api.example.com.svg)](https://switchbord.xyz)
```

Replace `api.example.com` with your host name. It shows `live ✓` when your listed endpoints answer with a valid payment challenge, `listed · not answering` when they don't, and `not listed` for hosts we don't have.
