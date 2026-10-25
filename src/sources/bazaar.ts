// Coinbase CDP Bazaar: every x402 endpoint that settled through the CDP facilitator.
import type { Endpoint, PayOption } from "../types.ts";
import { isUsdc, x402Label } from "../labels.ts";

const API = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources";
const PAGE = 1000;
const MAX_INPUT_BYTES = 2000;

async function page(offset: number): Promise<{ items: any[]; total: number }> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(`${API}?limit=${PAGE}&offset=${offset}`, { signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw new Error(`bazaar ${r.status}`);
      const j: any = await r.json();
      return { items: j.items ?? [], total: j.pagination?.total ?? 0 };
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((ok) => setTimeout(ok, 2000 * 2 ** attempt));
    }
  }
}

function payOptions(accepts: any[]): PayOption[] {
  return (accepts ?? []).map((a) => {
    const amount = a.amount ?? a.maxAmountRequired;
    return {
      rail: "x402" as const,
      label: x402Label(a.network, a.asset),
      network: a.network,
      asset: a.asset,
      priceUsd: amount != null && isUsdc(a.asset) ? Number(amount) / 1e6 : null,
      payTo: a.payTo,
      scheme: a.scheme,
    };
  });
}

function exampleInput(input: any): Endpoint["input"] {
  if (!input) return undefined;
  const out: Endpoint["input"] = {};
  if (input.queryParams && Object.keys(input.queryParams).length) out.query = input.queryParams;
  if (input.body !== undefined) out.body = input.body;
  if (!out.query && out.body === undefined) return undefined;
  return JSON.stringify(out).length <= MAX_INPUT_BYTES ? out : undefined;
}

export function toEndpoint(it: any): Omit<Endpoint, "id" | "market"> {
  const input = it.extensions?.bazaar?.info?.input;
  const q = it.quality ?? {};
  return {
    url: it.resource,
    method: (input?.method ?? "GET").toUpperCase(),
    service: it.serviceName ?? "",
    description: (it.description ?? "").slice(0, 500),
    tags: (it.tags ?? []).slice(0, 12),
    pay: payOptions(it.accepts),
    input: exampleInput(input),
    sources: ["bazaar"],
    usage: { calls30d: q.l30DaysTotalCalls ?? 0, payers30d: q.l30DaysUniquePayers ?? 0, lastCalledAt: q.lastCalledAt },
    updatedAt: it.lastUpdated,
  };
}

export async function fetchBazaar(concurrency = 6): Promise<Omit<Endpoint, "id" | "market">[]> {
  const first = await page(0);
  const offsets: number[] = [];
  for (let o = PAGE; o < first.total; o += PAGE) offsets.push(o);
  // Map each page as it arrives: the raw listings are many times bigger than what we keep.
  const map = (items: any[]) => items.filter((it) => it?.resource).map(toEndpoint);
  const out = map(first.items);
  for (let i = 0; i < offsets.length; i += concurrency) {
    const pages = await Promise.all(offsets.slice(i, i + concurrency).map(page));
    for (const p of pages) for (const e of map(p.items)) out.push(e);
  }
  return out;
}
