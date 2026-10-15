// SwitchBord HTTP API (request handler; used by src/server.ts locally and src/vercel.ts on Vercel). No signup, no keys. Never touches money.
//   GET  /route?task=...&market=...&accepts=x402:base:usdc,mpp:tempo&max_price=0.05&limit=5
//   POST /route   {task, market, accepts, maxPriceUsd, limit}
//   GET  /markets
//   GET  /endpoints/:id
//   POST /report  {endpointId, outcome, ms?, tx?, network?}
import type { IncomingMessage, ServerResponse } from "node:http";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Router, outcomeIsOk, type RouteRequest } from "./router.ts";
import { buildInventory, loadInventory, saveInventory } from "./inventory.ts";
import * as store from "./store.ts";
import * as history from "./history.ts";
import * as usage from "./usage.ts";
import { dashboardHtml } from "./dashboard.ts";
import { waitUntil } from "@vercel/functions";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./mcp-tools.ts";

let REPORTS = join(process.cwd(), "data", "reports.jsonl");
const OUTCOMES = new Set(["ok", "bad_output", "http_error", "timeout_before_pay", "timeout_after_pay", "no_402", "bad_terms", "settle_failed", "paid_failed"]);
const CHECK_STORE_MS = 10 * 60_000;
const MIN_REBUILD_GAP_MS = 6 * 3600_000;
const MIN_SAMPLE_GAP_MS = 10 * 60_000;

let router: Router;
let builtAt = "";
let inventoryEtag: string | undefined;
let lastStoreCheck = 0;
export const getRouter = () => router;

async function useEndpoints(endpoints: Router["endpoints"], at: string) {
  const r = new Router(endpoints);
  if (store.enabled) {
    r.addCounts(await store.loadCounts().catch(() => ({})));
    for (const rep of await store.loadRecentReports().catch(() => [])) r.addReport(rep.endpointId, rep.outcome);
  } else loadReports(r);
  router = r;
  builtAt = at;
}

/** Pull every source, rebuild, publish (Blob when available, else the local file). */
export async function rebuild() {
  const { endpoints, errors } = await buildInventory();
  if (errors.length) console.error("inventory source errors:", errors);
  if (!endpoints.length) throw new Error("no endpoints fetched: " + errors.join("; "));
  const at = new Date().toISOString();
  if (store.enabled) await store.saveInventory(at, endpoints);
  else saveInventory(endpoints);
  await useEndpoints(endpoints, at);
  console.log(`inventory: ${endpoints.length} endpoints`);
  return { endpoints: endpoints.length, errors };
}

/** Load the newest inventory: Blob (if newer than the bundled copy), else the file, else build one. */
export async function init(opts: { inventoryPath?: string; reportsPath?: string } = {}) {
  if (opts.reportsPath) REPORTS = opts.reportsPath;
  const file = loadInventory(opts.inventoryPath);
  const blob = store.enabled ? await store.loadInventory().catch((e) => (console.error("blob inventory:", e.message), null)) : null;
  lastStoreCheck = Date.now();
  if (blob && blob !== "unchanged" && (!file || blob.builtAt > file.builtAt)) { inventoryEtag = blob.etag; await useEndpoints(blob.endpoints, blob.builtAt); }
  else if (file) await useEndpoints(file.endpoints, file.builtAt);
  else await rebuild();
  console.log(`inventory ${builtAt}: ${router.endpoints.length} endpoints`);
  return router;
}

/** At most every 10 minutes, pick up an inventory another instance (the daily job) published. */
async function maybeRefresh() {
  if (!store.enabled || Date.now() - lastStoreCheck < CHECK_STORE_MS) return;
  lastStoreCheck = Date.now();
  const blob = await store.loadInventory(inventoryEtag).catch(() => null);
  if (blob && blob !== "unchanged" && blob.builtAt > builtAt) { inventoryEtag = blob.etag; await useEndpoints(blob.endpoints, blob.builtAt); }
}

function loadReports(r: Router) {
  try { for (const l of readFileSync(REPORTS, "utf8").split("\n")) if (l) { const j = JSON.parse(l); r.addReport(j.endpointId, j.outcome); } } catch {}
}

async function saveReport(b: any) {
  const rep = { at: new Date().toISOString(), endpointId: String(b.endpointId), outcome: b.outcome, ms: num(b.ms), tx: b.tx ? String(b.tx).slice(0, 100) : undefined, network: b.network ? String(b.network).slice(0, 60) : undefined };
  router.addReport(rep.endpointId, rep.outcome);
  if (store.enabled) await store.saveReport(rep);
  else { mkdirSync(join(REPORTS, ".."), { recursive: true }); appendFileSync(REPORTS, JSON.stringify(rep) + "\n"); }
}

/** Daily job (Vercel cron): rebuild the inventory and fold reports. Open to anyone, but at most once per 6 hours
 *  unless the caller has CRON_SECRET (Vercel sends it automatically when the variable is set). */
async function daily(req: IncomingMessage) {
  const secret = process.env.CRON_SECRET;
  const authorized = !!secret && req.headers.authorization === `Bearer ${secret}`;
  if (!authorized && Date.now() - Date.parse(builtAt || "0") < MIN_REBUILD_GAP_MS) return { skipped: true, builtAt };
  const t0 = Date.now();
  const built = await rebuild();
  const folded = store.enabled ? await store.compactReports(outcomeIsOk) : 0;
  return { ...built, reportsFolded: folded, builtAt, tookMs: Date.now() - t0 };
}

/** Sample job (hourly, from a GitHub Action): re-check the top 5 sellers of every market and save each market's
 *  order. Open to anyone, but at most once per 10 minutes across instances unless the caller has CRON_SECRET. */
let lastSample = 0;
async function sample(req: IncomingMessage) {
  const secret = process.env.CRON_SECRET;
  const authorized = !!secret && req.headers.authorization === `Bearer ${secret}`;
  const last = Math.max(lastSample, (await history.lastSampleAt().catch(() => null))?.getTime() ?? 0);
  if (!authorized && Date.now() - last < MIN_SAMPLE_GAP_MS) return { skipped: true, lastSampleAt: new Date(last).toISOString() };
  lastSample = Date.now();
  const t0 = Date.now(), at = new Date();
  const rankings = await router.sample();
  const checks = await history.settle();
  await history.saveRankings(at, rankings);
  return { at: at.toISOString(), markets: rankings.length, checksSaved: checks, historyStore: history.enabled, tookMs: Date.now() - t0 };
}

// Remote agent tool: find + report only. Paying needs the agent's own wallet, so that tool exists only in the local MCP.
const mcpBackend = {
  route: (r: RouteRequest) => router.route(r),
  markets: async () => ({ builtAt, markets: router.markets() }),
  report: async (b: any) => {
    if (!router.get(String(b.endpointId)) || !OUTCOMES.has(b.outcome)) return { accepted: false, error: "unknown endpoint or outcome" };
    await saveReport(b);
    return { accepted: true };
  },
};

function send(res: ServerResponse, status: number, body: unknown) {
  const s = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", "content-length": Buffer.byteLength(s) });
  res.end(s);
}

async function readJson(req: IncomingMessage): Promise<any> {
  let raw = "";
  for await (const c of req) { raw += c; if (raw.length > 64_000) throw new Error("body too large"); }
  return raw ? JSON.parse(raw) : {};
}

const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? v.split(",").map((s) => s.trim()) : undefined);
const num = (v: unknown) => (v == null || v === "" ? undefined : Number(v));

function routeRequest(src: Record<string, any>): RouteRequest {
  return {
    task: src.task ? String(src.task).slice(0, 500) : undefined,
    market: src.market ? String(src.market) : undefined,
    accepts: list(src.accepts),
    maxPriceUsd: num(src.maxPriceUsd ?? src.max_price),
    limit: num(src.limit),
    sort: src.sort === "price" ? "price" : undefined,
  };
}

/** Read the MCP call out of a JSON-RPC body: which tool, what task, which client announced itself. */
function mcpInfo(b: any) {
  const m = b?.method, a = b?.params?.arguments ?? {};
  return { method: m, tool: m === "tools/call" ? String(b.params?.name ?? "") : m ? String(m) : null, task: typeof a.task === "string" ? a.task : null, market: typeof a.market === "string" ? a.market : null, client: b?.params?.clientInfo?.name ? String(b.params.clientInfo.name) : undefined };
}

export async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  const t0 = Date.now();
  const log = (kind: usage.UsageEvent["kind"], via: "http" | "mcp", x: { tool?: string | null; task?: string | null; market?: string | null; mode?: string | null; results?: number | null; mcpClient?: string } = {}) =>
    usage.record(req, { kind, via, tool: x.tool ?? null, task: x.task ?? null, market: x.market ?? null, mode: x.mode ?? null, results: x.results ?? null, ms: Date.now() - t0, status: res.statusCode || 200, mcpClient: x.mcpClient });
  try {
    await maybeRefresh().catch((e) => console.error("refresh failed", e));
    if (url.pathname === "/cron/daily") return send(res, 200, await daily(req));
    if (url.pathname === "/cron/sample") return send(res, 200, await sample(req));
    if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization" }); return res.end(); }
    if (url.pathname === "/route") {
      const r = routeRequest(req.method === "POST" ? await readJson(req) : Object.fromEntries(url.searchParams));
      if (!r.task && !r.market) return send(res, 400, { error: "give a task (plain words) or a market id" });
      const out = await router.route(r);
      log("route", "http", { task: r.task, market: r.market, mode: out.mode, results: out.candidates.length });
      return send(res, 200, out);
    }
    if (url.pathname === "/dashboard") { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); return res.end(dashboardHtml); }
    if (url.pathname === "/stats") {
      const secret = process.env.CRON_SECRET;
      if (!secret || req.headers.authorization !== `Bearer ${secret}`) return send(res, 401, { error: "usage stats are private: send Authorization: Bearer <CRON_SECRET>" });
      await usage.flush();
      return send(res, 200, await usage.summary(Number(url.searchParams.get("days") ?? 14)));
    }
    if (url.pathname === "/mcp") {
      if (req.method !== "POST") return send(res, 405, { error: "MCP over streamable HTTP: POST only (stateless)" });
      const mcp = createMcpServer(mcpBackend);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => { transport.close(); mcp.close(); });
      await mcp.connect(transport);
      const body = await readJson(req);
      const info = mcpInfo(Array.isArray(body) ? body[0] : body);
      if (info.method && info.method !== "notifications/initialized") res.on("finish", () => log("mcp", "mcp", { tool: info.tool, task: info.task, market: info.market, mcpClient: info.client }));
      return await transport.handleRequest(req, res, body);
    }
    if (url.pathname === "/markets") log("markets", "http");
    if (url.pathname === "/markets") return send(res, 200, { builtAt, markets: router.markets() });
    if (url.pathname.startsWith("/endpoints/")) {
      const e = router.get(url.pathname.slice("/endpoints/".length));
      return e ? send(res, 200, e) : send(res, 404, { error: "unknown endpoint id" });
    }
    if (url.pathname === "/report" && req.method === "POST") {
      const b = await readJson(req);
      if (!router.get(String(b.endpointId)) || !OUTCOMES.has(b.outcome)) return send(res, 400, { error: "need endpointId and outcome", outcomes: [...OUTCOMES] });
      await saveReport(b);
      return send(res, 202, { accepted: true });
    }
    if (url.pathname === "/" || url.pathname === "/healthz") {
      return send(res, 200, {
        name: "SwitchBord", builtAt, endpoints: router.endpoints.length, durableStore: store.enabled, historyStore: history.enabled,
        usage: {
          route: "GET /route?task=search the web for x&accepts=x402:base:usdc&max_price=0.05",
          mcp: "POST /mcp (MCP streamable HTTP; tools: find_paid_endpoint, list_markets, report_result)",
          markets: "GET /markets", endpoint: "GET /endpoints/:id",
          report: "POST /report {endpointId, outcome, ms, tx, network}",
          accepts: "labels like x402:base:usdc, x402:solana:usdc, mpp:tempo, mpp:stripe; trailing * allowed (x402:*)",
        },
      });
    }
    send(res, 404, { error: "not found" });
  } catch (e: any) {
    send(res, 500, { error: String(e?.message ?? e) });
  } finally {
    // Save this request's live checks after the response; on Vercel waitUntil keeps the instance alive for it.
    waitUntil(Promise.all([history.settle().catch(() => 0), usage.flush().catch(() => 0)]));
  }
}
