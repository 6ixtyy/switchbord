// Free live check: one unpaid request, read the payment challenge. Never pays.
// A seller is "ok" when it answers 402 with an offer we can parse (x402 v1/v2 or MPP).
import type { Endpoint, Health } from "./types.ts";
import { isUsdc } from "./labels.ts";
import * as history from "./history.ts";

export const FRESH_MS = 60_000;
const DOWN_MS = 5 * 60_000;
const cache = new Map<string, Health>();

export const getHealth = (id: string) => cache.get(id);
export const isFresh = (h?: Health) => !!h && Date.now() - h.checkedAt < (h.ok ? FRESH_MS : DOWN_MS);

export function buildRequest(e: Endpoint, query?: string): { url: string; init: RequestInit } {
  const u = new URL(e.url);
  const q = e.input?.query ?? (query ? { q: query, query } : {});
  for (const [k, v] of Object.entries(q)) if (!u.searchParams.has(k)) u.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));
  const init: RequestInit = { method: e.method, headers: { accept: "application/json", "user-agent": "switchbord/0.1" } };
  if (e.method !== "GET" && e.method !== "HEAD") {
    (init.headers as Record<string, string>)["content-type"] = "application/json";
    init.body = JSON.stringify(e.input?.body ?? (query ? { query, q: query } : {}));
  }
  return { url: u.toString(), init };
}

function offerPrice(res: Response, body: string): number | null | undefined {
  const hdr = res.headers.get("payment-required");
  let accepts: any[] | undefined;
  if (hdr) accepts = JSON.parse(Buffer.from(hdr, "base64").toString()).accepts;
  else {
    try { accepts = JSON.parse(body).accepts; } catch {}
  }
  if (accepts?.length) {
    const usd = accepts.filter((a) => isUsdc(a.asset)).map((a) => Number(a.amount ?? a.maxAmountRequired) / 1e6);
    return usd.length ? Math.min(...usd) : null;
  }
  if (/^payment\b/i.test(res.headers.get("www-authenticate") ?? "")) return null; // MPP challenge: price stays as listed
  return undefined; // not a payment challenge
}

export async function check(e: Endpoint, timeoutMs = 4000, source: history.Source = "route"): Promise<Health> {
  const { url, init } = buildRequest(e);
  const t0 = performance.now();
  let h: Health;
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
    const body = res.status === 402 ? await res.text() : (await res.body?.cancel(), "");
    const ms = Math.round(performance.now() - t0);
    const price = res.status === 402 ? offerPrice(res, body) : undefined;
    h = { ok: price !== undefined, status: res.status, ms, checkedAt: Date.now(), priceUsd: price ?? null };
    if (!h.ok) h.error = res.status === 402 ? "unparseable 402" : `status ${res.status}`;
  } catch (err: any) {
    h = { ok: false, status: null, ms: Math.round(performance.now() - t0), checkedAt: Date.now(), error: err?.name === "TimeoutError" ? "timeout" : String(err?.cause?.code ?? err?.message ?? err).slice(0, 80) };
  }
  cache.set(e.id, h);
  history.record(e, h, source);
  return h;
}

/** Check every endpoint whose result is stale (or all of them with `force`), in parallel, but give up waiting
 *  after `budgetMs`. Checks still running keep going and are saved to history when they finish. */
export async function refresh(es: Endpoint[], budgetMs: number, source: history.Source = "route", force = false): Promise<void> {
  // Endpoints with path parameters (/items/:id, /{id}) can't be checked without real values; leave them unknown.
  const stale = es.filter((e) => (force || !isFresh(cache.get(e.id))) && !/\/[:{]|%7B/i.test(e.url));
  if (!stale.length) return;
  const all = Promise.allSettled(stale.map((e) => check(e, budgetMs, source)));
  history.track(all);
  await Promise.race([all, new Promise((ok) => setTimeout(ok, budgetMs))]);
}
