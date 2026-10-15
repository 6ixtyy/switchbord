// Checks that the live API still returns every field the website (site/index.html) and agents rely on.
// The contract itself is public/API.md. Read-only: never writes a report.
//   node scripts/check-api-contract.mjs [baseUrl ...]     (default: both live API addresses)
const bases = process.argv.slice(2).length ? process.argv.slice(2) : ["https://switchbord.vercel.app"];

const fails = [];
const is = {
  num: (v) => typeof v === "number" && Number.isFinite(v),
  str: (v) => typeof v === "string" && v.length > 0,
  bool: (v) => typeof v === "boolean",
  arr: (v) => Array.isArray(v),
  obj: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
};
function need(where, cond, what) { if (!cond) fails.push(`${where}: ${what}`); }

async function get(base, path, init) {
  const r = await fetch(base + path, { ...init, signal: AbortSignal.timeout(30_000) });
  let body; try { body = await r.json(); } catch { body = undefined; }
  return { status: r.status, body, headers: r.headers };
}

async function check(base) {
  const at = (p) => `${base}${p}`;

  const h = await get(base, "/healthz");
  need(at("/healthz"), h.status === 200, `status ${h.status}`);
  need(at("/healthz"), is.num(h.body?.endpoints) && h.body.endpoints > 1000, "endpoints is a number > 1000");
  need(at("/healthz"), is.str(h.body?.builtAt) && !isNaN(Date.parse(h.body.builtAt)), "builtAt is an ISO date");
  need(at("/healthz"), Date.now() - Date.parse(h.body?.builtAt) < 49 * 3600_000, "inventory rebuilt in the last 49h (daily job running)");

  const m = await get(base, "/markets");
  need(at("/markets"), m.status === 200 && is.arr(m.body?.markets) && m.body.markets.length > 0, "markets is a non-empty array");
  for (const x of m.body?.markets ?? []) {
    need(at("/markets"), is.str(x.id) && is.str(x.title) && is.num(x.sellers) && is.num(x.endpoints) && is.arr(x.rails), `market ${x.id} has id, title, sellers, endpoints, rails`);
  }

  const r = await get(base, "/route?task=search%20the%20web&accepts=x402:base:usdc&max_price=0.05&limit=5");
  const d = r.body ?? {};
  need(at("/route"), r.status === 200, `status ${r.status}`);
  need(at("/route"), ["market", "inventory", "none"].includes(d.mode), "mode is market | inventory | none");
  need(at("/route"), is.num(d.sellersMatched) && is.num(d.tookMs) && is.bool(d.fallback), "sellersMatched, tookMs, fallback");
  need(at("/route"), is.arr(d.candidates) && d.candidates.length > 0, "web search returns candidates");
  for (const c of d.candidates ?? []) {
    const w = `${at("/route")} candidate ${c.id}`;
    need(w, is.num(c.rank) && is.str(c.id) && is.str(c.url) && is.str(c.method), "rank, id, url, method");
    need(w, typeof c.service === "string" && typeof c.description === "string", "service, description (strings, may be empty)");
    need(w, c.priceUsd === null || is.num(c.priceUsd), "priceUsd is a number or null");
    need(w, is.arr(c.pay) && c.pay.every((p) => is.str(p.label)), "pay[].label");
    need(w, ["after_success", "before_handler", "unknown"].includes(c.charges), "charges");
    need(w, is.obj(c.health) && (c.health.ok === null || is.bool(c.health.ok)), "health.ok is true | false | null");
    if (c.health?.ok !== null) need(w, is.num(c.health.ms) && is.num(c.health.checkedSecondsAgo), "health.ms, health.checkedSecondsAgo");
  }

  const n = await get(base, "/route?task=zzqx%20blorf%20vvkq");
  need(at("/route (no match)"), n.status === 200 && n.body?.mode === "none" && n.body.candidates?.length === 0, "unmatched task gives mode none, no candidates");
  const bad = await get(base, "/route");
  need(at("/route (no task)"), bad.status === 400 && is.str(bad.body?.error), "400 with error");
  const rep = await get(base, "/report", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  need(at("/report (empty)"), rep.status === 400 && is.arr(rep.body?.outcomes), "400 listing valid outcomes");

  const mcp = await get(base, "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  const tools = (mcp.body?.result?.tools ?? []).map((t) => t.name);
  for (const t of ["find_paid_endpoint", "list_markets", "report_result"]) need(at("/mcp"), tools.includes(t), `tool ${t} listed`);
}

for (const b of bases) {
  try { await check(b); } catch (e) { fails.push(`${b}: ${e.message}`); }
}
if (fails.length) {
  console.error(`API contract: ${fails.length} problem(s)\n- ` + fails.join("\n- "));
  process.exit(1);
}
console.log(`API contract OK (${bases.join(", ")})`);
