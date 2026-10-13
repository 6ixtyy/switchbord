# SwitchBord API

Base URL: `https://switchbord.vercel.app`.

No signup, no keys. JSON in and out. CORS is open (`access-control-allow-origin: *`). SwitchBord never handles payments: it tells your agent which seller to call; your agent pays the seller directly with its own x402 or MPP client.

This file is the contract. Fields listed here are stable; anything else in a response may change without notice.

## GET /route

Ranked sellers for a task, checked live just before answering.

| Query param | Required | Example | Meaning |
|---|---|---|---|
| `task` | one of `task` / `market` | `search the web` | What the agent needs, in plain words |
| `market` | one of `task` / `market` | `web-search` | A market id from `/markets` |
| `accepts` | no | `x402:base:usdc,mpp:tempo` | Payment methods the agent can use. Comma-separated. A trailing `*` matches a family (`x402:*`). Omit for all |
| `max_price` | no | `0.05` | Max price per call in USD |
| `limit` | no | `5` | Candidates to return, 1–20 (default 5) |

`POST /route` takes the same fields as a JSON body (`task`, `market`, `accepts` as an array or comma string, `maxPriceUsd`, `limit`).

```json
{
  "mode": "market",
  "market": "web-search",
  "task": "search the web",
  "sellersMatched": 89,
  "fallback": true,
  "tookMs": 13,
  "candidates": [
    {
      "rank": 1,
      "id": "UDWF1RAj7BK3",
      "service": "StableEnrich",
      "url": "https://stableenrich.dev/api/exa/search",
      "method": "POST",
      "description": "Exa Search - Neural search across the web",
      "market": "web-search",
      "priceUsd": 0.01,
      "pay": [
        { "rail": "x402", "label": "x402:base:usdc", "network": "eip155:8453",
          "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "priceUsd": 0.01,
          "payTo": "0x325bdF6F7efAB24a2210c48c1b64cAb2eAe1d430", "scheme": "exact" }
      ],
      "input": { "body": { "query": "…", "numResults": 10 } },
      "health": { "ok": true, "status": 402, "ms": 152, "checkedSecondsAgo": 32 },
      "charges": "after_success",
      "score": 0.753
    }
  ],
  "rules": { "nextOn": ["no_402", "bad_terms", "…"], "stopOn": ["x402_receipt_ok", "mpp_paid"] }
}
```

| Field | Meaning |
|---|---|
| `mode` | `market`: many sellers sell this, ranked. `inventory`: no market fits, closest single endpoints. `none`: nothing matches |
| `market` | Market id, or `null` |
| `sellersMatched` | Distinct sellers that matched before ranking |
| `fallback` | `true` when more than one live candidate is returned |
| `tookMs` | Time SwitchBord spent, including live checks |
| `candidates[].rank` | 1 = best right now |
| `candidates[].id` | Stable endpoint id (use with `/endpoints/:id` and `/report`) |
| `candidates[].service`, `description` | Seller's own name and text; may be empty |
| `candidates[].url`, `method` | What to call |
| `candidates[].priceUsd` | Price per call in USD from the live check, else from the listing; `null` if unknown |
| `candidates[].pay[]` | Payment options; `label` is the stable part (`x402:<network>:usdc`, `mpp:<method>`) |
| `candidates[].input` | The seller's example request (`query` and/or `body`), when it published one |
| `candidates[].health.ok` | `true` live, `false` down, `null` not checked yet |
| `candidates[].health.ms`, `status`, `checkedSecondsAgo` | Present when checked |
| `candidates[].charges` | `after_success` (x402: the seller is only paid if it answers OK), `before_handler` (MPP: paid up front), `unknown` |
| `candidates[].score` | Ranking score, 0–1. Opaque; compare only within one response |
| `rules` | Hints for agents that switch sellers themselves: move on for `nextOn`, stop for `stopOn` |

Errors: `400 {"error": "give a task (plain words) or a market id"}`.

## GET /markets

```json
{ "builtAt": "2026-10-12T05:28:58.923Z",
  "markets": [ { "id": "llm", "title": "LLM chat / completions", "endpoints": 1177, "sellers": 260, "rails": ["mpp", "x402"] } ] }
```

## GET /endpoints/:id

One endpoint from the inventory: `id`, `service`, `url`, `method`, `description`, `market`, `pay[]`, `input`. `404 {"error": "unknown endpoint id"}` if unknown.

## GET /healthz

```json
{ "name": "SwitchBord", "builtAt": "2026-10-12T05:28:58.923Z", "endpoints": 33464, "durableStore": true, "historyStore": true, "usage": { "…": "…" } }
```

`builtAt` is when the inventory was last rebuilt (daily).

## POST /report (optional)

Tell SwitchBord how a call went. It improves rankings for everyone. Not required.

```json
{ "endpointId": "UDWF1RAj7BK3", "outcome": "ok", "ms": 420, "tx": "0x…", "network": "eip155:8453" }
```

`outcome` is one of `ok`, `bad_output`, `http_error`, `timeout_before_pay`, `timeout_after_pay`, `no_402`, `bad_terms`, `settle_failed`, `paid_failed`. Returns `202 {"accepted": true}`, or `400` with the list of valid outcomes.

## POST /mcp

MCP over streamable HTTP, stateless, no auth. Tools:

| Tool | Input | Returns |
|---|---|---|
| `find_paid_endpoint` | `task`, optional `market`, `accepts[]`, `max_price_usd`, `limit` | Same as `/route`, trimmed: `mode`, `market`, `sellersMatched`, `fallback`, `rules`, `candidates[{rank, id, service, method, url, description, priceUsd, pay[] (labels), charges, input, up, ms}]` |
| `list_markets` | none | Same as `/markets` |
| `report_result` | `endpoint_id`, `outcome`, optional `ms`, `tx`, `network` | `{accepted}` |

Setup: [MCP.md](MCP.md).
