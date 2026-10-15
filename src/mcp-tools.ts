// The SwitchBord agent tools: find, list markets, report. Served remotely at /mcp. They only say who to call;
// nothing here pays or holds funds.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RouteRequest, RouteResponse } from "./router.ts";

export interface Backend {
  route(r: RouteRequest): Promise<RouteResponse>;
  markets(): Promise<unknown>;
  report(r: { endpointId: string; outcome: string; ms?: number; tx?: string; network?: string }): Promise<unknown>;
}

export const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v) }] });

/** Trim the route response to what an agent needs to act. */
function compact(r: RouteResponse) {
  return {
    mode: r.mode, market: r.market, sellersMatched: r.sellersMatched, fallback: r.fallback, rules: r.rules,
    candidates: r.candidates.map((c) => ({
      rank: c.rank, id: c.id, service: c.service, method: c.method, url: c.url, description: c.description.slice(0, 200),
      priceUsd: c.priceUsd, pay: [...new Set(c.pay.map((p) => p.label))], charges: c.charges, input: c.input,
      up: c.health.ok, ms: c.health.ms,
    })),
  };
}

const accepts = z.array(z.string()).optional().describe('Payment methods you can use, e.g. ["x402:base:usdc","mpp:tempo"]. Trailing * allowed. Omit for all.');

export function createMcpServer(b: Backend): McpServer {
  const s = new McpServer({ name: "switchbord", version: "0.1.0" });

  s.registerTool("find_paid_endpoint", {
    title: "Find a paid API seller",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    description: "Find the best paid API endpoint (x402 / MPP) for a task right now. Returns sellers ranked by live health, speed and price, with fallbacks when several sell the same thing. Works for any task: if no group of sellers matches, it returns the closest single endpoints from the full inventory. You pay the seller directly; SwitchBord never touches money.",
    inputSchema: {
      task: z.string().describe('What you need in plain words, e.g. "search the web", "ETH price", "scrape a page"'),
      market: z.string().optional().describe("Optional market id from list_markets, e.g. web-search"),
      accepts, max_price_usd: z.number().optional(), limit: z.number().int().min(1).max(20).optional(),
    },
  }, async (a) => json(compact(await b.route({ task: a.task, market: a.market, accepts: a.accepts, maxPriceUsd: a.max_price_usd, limit: a.limit }))));

  s.registerTool("list_markets", {
    title: "List markets",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "List the markets (groups of interchangeable paid endpoints) with seller counts and payment rails.",
    inputSchema: {},
  }, async () => json(await b.markets()));

  s.registerTool("report_result", {
    title: "Report a call result",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: "Report how a paid call went so rankings stay honest. Include the payment tx hash when you paid.",
    inputSchema: {
      endpoint_id: z.string(),
      outcome: z.enum(["ok", "bad_output", "http_error", "timeout_before_pay", "timeout_after_pay", "no_402", "bad_terms", "settle_failed", "paid_failed"]),
      ms: z.number().optional(), tx: z.string().optional(), network: z.string().optional(),
    },
  }, async (a) => json(await b.report({ endpointId: a.endpoint_id, outcome: a.outcome, ms: a.ms, tx: a.tx, network: a.network })));

  return s;
}
