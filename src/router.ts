// Routing: task -> market (many sellers, ranked, with fallbacks) or, failing that, the best
// matching endpoints from the whole inventory. "Not available" only when nothing matches at all.
import type { Endpoint, Health, PayOption } from "./types.ts";
import { MARKETS, MARKET_IDS, classify, endpointText } from "./markets.ts";
import { accepts as matches } from "./labels.ts";
import { getHealth, refresh } from "./health.ts";

export interface RouteRequest {
  task?: string;
  market?: string;
  accepts?: string[];
  maxPriceUsd?: number;
  limit?: number;
  checkMs?: number;
  /** "best" (default) weighs trust, speed and price; "price" puts live sellers first, cheapest first. */
  sort?: "best" | "price";
}

export interface Candidate {
  rank: number;
  id: string;
  service: string;
  url: string;
  method: string;
  description: string;
  market: string | null;
  pay: PayOption[];
  priceUsd: number | null;
  input?: Endpoint["input"];
  health: { ok: boolean | null; status?: number | null; ms?: number; checkedSecondsAgo?: number; error?: string };
  charges: "after_success" | "before_handler" | "unknown";
  score: number;
}

export interface RouteResponse {
  mode: "market" | "inventory" | "none";
  market: string | null;
  task?: string;
  sellersMatched: number;
  fallback: boolean;
  candidates: Candidate[];
  rules: { nextOn: string[]; stopOn: string[] };
  tookMs: number;
}

const RULES = {
  nextOn: ["no_402", "bad_terms", "over_price_cap", "timeout_before_pay", "x402_error_without_receipt", "x402_402_after_pay"],
  stopOn: ["x402_receipt_ok", "mpp_paid"],
};

const TOKEN = /[a-z0-9]+/g;
const stem = (t: string) => (t.length > 4 ? t.replace(/ies$/, "y").replace(/(?<!s)s$/, "") : t);
const tokens = (text: string) => (text.toLowerCase().match(TOKEN) ?? []).filter((t) => !STOP.has(t)).map(stem);
const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };
const STOP = new Set("a an and are as at be by for from get i in is it me my of on or the to with what which who how this that latest current find look up lookup data api".split(" "));

export class Router {
  private byMarket = new Map<string, Endpoint[]>();
  private docs: { e: Endpoint; terms: Map<string, number>; len: number }[] = [];
  private df = new Map<string, number>();
  private hostPayers = new Map<string, number>();
  private reports = new Map<string, { ok: number; bad: number }>();

  /** Real-call results feed ranking: each good call lifts a seller, each failure drops it. */
  addReport(endpointId: string, outcome: string) {
    const ok = outcomeIsOk(outcome);
    if (ok === null) return;
    const r = this.reports.get(endpointId) ?? { ok: 0, bad: 0 };
    ok ? r.ok++ : r.bad++;
    this.reports.set(endpointId, r);
  }

  addCounts(counts: Record<string, { ok: number; bad: number }>) {
    for (const [id, c] of Object.entries(counts)) {
      const r = this.reports.get(id) ?? { ok: 0, bad: 0 };
      r.ok += c.ok; r.bad += c.bad;
      this.reports.set(id, r);
    }
  }
  endpoints: Endpoint[];
  constructor(endpoints: Endpoint[]) {
    this.endpoints = endpoints;
    for (const e of endpoints) {
      if (e.market) (this.byMarket.get(e.market) ?? this.byMarket.set(e.market, []).get(e.market)!).push(e);
      const terms = new Map<string, number>();
      for (const t of tokens(endpointText(e))) terms.set(t, (terms.get(t) ?? 0) + 1);
      const h = hostOf(e.url);
      this.hostPayers.set(h, Math.max(this.hostPayers.get(h) ?? 0, e.usage?.payers30d ?? 0));
      for (const t of terms.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ e, terms, len: [...terms.values()].reduce((a, b) => a + b, 0) });
    }
  }

  markets() {
    return MARKETS.map((m) => {
      const es = this.byMarket.get(m.id) ?? [];
      const rails = new Set(es.flatMap((e) => e.pay.map((p) => p.rail)));
      return { id: m.id, title: m.title, endpoints: es.length, sellers: hosts(es), rails: [...rails].sort() };
    });
  }

  private byId = new Map<string, Endpoint>();
  get(id: string) {
    if (this.byId.size !== this.endpoints.length) this.byId = new Map(this.endpoints.map((e) => [e.id, e]));
    return this.byId.get(id);
  }

  /** BM25 over the whole inventory; used when a task matches no market (or the market is empty after filters). */
  search(task: string, pool?: Endpoint[], n = 40): Endpoint[] {
    return this.scored(task, pool, n).map((x) => x.e);
  }

  /** BM25 plus coverage (share of the task's words an endpoint mentions). Inventory hits must cover half the words. */
  private scored(task: string, pool?: Endpoint[], n = 40, minCoverage = 0): { e: Endpoint; rel: number }[] {
    const q = [...new Set(tokens(task))];
    if (!q.length) return [];
    const N = this.docs.length, avg = this.docs.reduce((a, d) => a + d.len, 0) / N;
    const allowed = pool && new Set(pool.map((e) => e.id));
    const scored: [number, Endpoint][] = [];
    for (const d of this.docs) {
      if (allowed && !allowed.has(d.e.id)) continue;
      let s = 0, hit = 0;
      for (const t of q) {
        const f = d.terms.get(t);
        if (!f) continue;
        hit++;
        const idf = Math.log(1 + (N - this.df.get(t)! + 0.5) / (this.df.get(t)! + 0.5));
        s += (idf * f * 2.2) / (f + 1.2 * (0.25 + 0.75 * d.len / avg));
      }
      const cov = hit / q.length;
      if (s > 0 && cov >= minCoverage) scored.push([s * (0.4 + 0.6 * cov), d.e]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    const top = scored[0]?.[0] ?? 1;
    return scored.slice(0, n).map(([sc, e]) => ({ e, rel: sc / top }));
  }

  async route(req: RouteRequest): Promise<RouteResponse> {
    const t0 = performance.now();
    const limit = Math.min(Math.max(req.limit ?? 5, 1), 20);
    const market = req.market && MARKET_IDS.has(req.market) ? req.market : req.task ? classify(req.task) : null;
    const usable = (es: Endpoint[]) => es.filter((e) => this.payable(e, req).length);

    let mode: RouteResponse["mode"] = "market";
    let pool = market ? usable(this.byMarket.get(market) ?? []) : [];
    // Relevance of each endpoint to the task wording. Inside a market it only nudges the order (every seller
    // there sells the thing); in the inventory it decides what qualifies.
    let rel = new Map<string, number>();
    if (pool.length && req.task) rel = new Map(this.scored(req.task, pool, pool.length).map((x) => [x.e.id, x.rel]));
    if (!pool.length) {
      mode = "inventory";
      const q = req.task ? new Set(tokens(req.task)).size : 0;
      const hits = req.task ? this.scored(req.task, undefined, 80, q >= 2 ? 0.5 : 0) : [];
      pool = usable(hits.map((x) => x.e));
      rel = new Map(hits.map((x) => [x.e.id, x.rel]));
    }
    const relOf = (id: string) => (mode === "market" ? 0.6 + 0.4 * (rel.get(id) ?? 0) : rel.get(id) ?? 0);
    if (!pool.length) return { mode: "none", market, task: req.task, sellersMatched: 0, fallback: false, candidates: [], rules: RULES, tookMs: ms(t0) };

    // Pre-rank on what we know, then check the top few live (right before the call), then re-rank.
    let ranked = this.rank(pool, req, relOf);
    await refresh(ranked.slice(0, Math.max(limit + 3, 6)).map((c) => this.get(c.id)!), req.checkMs ?? 2500);
    ranked = this.rank(pool, req, relOf);

    const candidates = ranked.slice(0, limit).map((c, i) => ({ ...c, rank: i + 1 }));
    const live = candidates.filter((c) => c.health.ok !== false);
    return {
      mode, market: mode === "market" ? market : null, task: req.task,
      sellersMatched: hosts(pool), fallback: live.length > 1,
      candidates, rules: RULES, tookMs: ms(t0),
    };
  }

  /** Keep the top sellers of every market freshly checked, so most routes answer from cache. */
  async warm(perMarket = 8): Promise<void> {
    const top = [...this.byMarket.values()].flatMap((es) => this.rank(es, {}).slice(0, perMarket).map((c) => this.get(c.id)!));
    top.push(...[...this.reports.keys()].map((id) => this.get(id)!).filter(Boolean));
    await refresh(top, 8000, "warm");
  }

  /** Check the top sellers of every market now (fresh or not), then return each market's order afterwards.
   *  Saved as history so we can tell how often the best seller changes. */
  async sample(perMarket = 5, budgetMs = 8000): Promise<{ market: string; ids: string[] }[]> {
    const markets = [...this.byMarket.entries()];
    const top = markets.flatMap(([, es]) => this.rank(es, {}).slice(0, perMarket).map((c) => this.get(c.id)!));
    await refresh(top, budgetMs, "sample", true);
    return markets.map(([market, es]) => ({ market, ids: this.rank(es, {}).slice(0, perMarket).map((c) => c.id) }));
  }

  private payable(e: Endpoint, req: RouteRequest): PayOption[] {
    return e.pay.filter((p) =>
      (!req.accepts?.length || matches(p.label, req.accepts)) &&
      (req.maxPriceUsd == null || p.priceUsd == null || p.priceUsd <= req.maxPriceUsd));
  }

  /** Trust from real use: the seller's paying users (its best endpoint lends some to the rest), discounted when
   *  calls == payers (the bot pattern), adjusted by our own real-call reports. 0 = untried, 1 = proven. */
  private trust(e: Endpoint): number {
    const payers = e.usage?.payers30d ?? 0, calls = e.usage?.calls30d ?? 0;
    const p = Math.max(payers, 0.3 * (this.hostPayers.get(hostOf(e.url)) ?? 0));
    let t = Math.min(1, Math.log1p(p) / Math.log1p(200));
    if (payers >= 20 && calls <= payers * 1.1) t *= 0.6;
    const r = this.reports.get(e.id);
    if (r) t = Math.min(1, t * 0.5 + (r.ok + 1) / (r.ok + r.bad + 2) * (r.ok + r.bad >= 3 ? 1 : 0.6));
    return t;
  }

  private rank(pool: Endpoint[], req: RouteRequest, relOf: (id: string) => number = () => 1): Candidate[] {
    const out: Candidate[] = [];
    const prices = pool.map((e) => minPrice(e.pay)).filter((x): x is number => x != null && x > 0).sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)] ?? 0.01;
    for (const e of pool) {
      const pay = this.payable(e, req);
      if (!pay.length) continue;
      const h: Health | undefined = getHealth(e.id);
      const price = h?.ok && h.priceUsd != null ? h.priceUsd : minPrice(pay);
      if (req.maxPriceUsd != null && price != null && price > req.maxPriceUsd) continue;
      const up = h ? (h.ok ? 1 : 0.02) : 0.5;
      const speed = h?.ok ? 1 / (1 + h.ms / 1500) : 0.4;
      const cheap = price != null ? 1 / (1 + price / median) : 0.3;
      const score = up * relOf(e.id) * (0.45 * this.trust(e) + 0.25 * speed + 0.3 * cheap);
      out.push({
        rank: 0, id: e.id, service: e.service, url: e.url, method: e.method, description: e.description,
        market: e.market, pay, priceUsd: price, input: e.input,
        health: h ? { ok: h.ok, status: h.status, ms: h.ms, checkedSecondsAgo: Math.round((Date.now() - h.checkedAt) / 1000), error: h.error } : { ok: null },
        charges: pay.some((p) => p.rail === "x402") ? "after_success" : pay.some((p) => p.rail === "mpp") ? "before_handler" : "unknown",
        score: Math.round(score * 1000) / 1000,
      });
    }
    if (req.sort === "price") {
      // Sellers that failed their live check go last; among the rest, cheapest first, ties by score.
      const down = (c: Candidate) => (c.health.ok === false ? 1 : 0);
      return out.sort((a, b) => down(a) - down(b) || (a.priceUsd ?? Infinity) - (b.priceUsd ?? Infinity) || b.score - a.score);
    }
    return out.sort((a, b) => b.score - a.score);
  }
}

/** ok -> true, seller's fault -> false, not the seller's fault (we gave up before paying, or terms didn't fit) -> null. */
export function outcomeIsOk(outcome: string): boolean | null {
  if (outcome === "ok") return true;
  return ["timeout_before_pay", "bad_terms"].includes(outcome) ? null : false;
}

const ms = (t0: number) => Math.round(performance.now() - t0);
const minPrice = (pay: PayOption[]) => { const p = pay.map((x) => x.priceUsd).filter((x): x is number => x != null); return p.length ? Math.min(...p) : null; };
function hosts(es: Endpoint[]) { return new Set(es.map((e) => { try { return new URL(e.url).host; } catch { return e.url; } })).size; }
