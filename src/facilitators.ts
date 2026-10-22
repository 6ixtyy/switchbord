// Free facilitator health: ask each public x402 facilitator what it supports (GET /supported, no payment, no keys)
// and time the answer. A seller's offer names a network, not a facilitator, so health is reported per network:
// "is any facilitator that settles Base answering right now?"
import { networkName } from "./labels.ts";

export interface FacilitatorInfo { id: string; name: string; url: string }

/** Public facilitators we probe. Add one here; the page and API pick it up. */
export const FACILITATORS: FacilitatorInfo[] = [
  { id: "cdp", name: "Coinbase CDP", url: "https://api.cdp.coinbase.com/platform/v2/x402" },
  { id: "x402org", name: "x402.org (testnet)", url: "https://x402.org/facilitator" },
  { id: "payai", name: "PayAI", url: "https://facilitator.payai.network" },
  { id: "xpay", name: "xpay", url: "https://facilitator.xpay.sh" },
  { id: "dexter", name: "Dexter", url: "https://x402.dexter.cash" },
];

export interface FacilitatorHealth {
  id: string;
  name: string;
  /** up: answered /supported. reachable: answered but wants an API key (CDP), so networks are unknown. down: no usable answer. */
  state: "up" | "reachable" | "down";
  ms: number;
  checkedAt: string;
  networks: string[];
  error?: string;
}

export const SLOW_MS = 2000;
const TTL_MS = 60_000;
let cache: { at: number; list: FacilitatorHealth[] } | null = null;
let inflight: Promise<FacilitatorHealth[]> | null = null;

export async function probe(f: FacilitatorInfo, timeoutMs = 4000): Promise<FacilitatorHealth> {
  const t0 = performance.now();
  const base = { id: f.id, name: f.name, checkedAt: new Date().toISOString() };
  try {
    const res = await fetch(`${f.url}/supported`, { headers: { accept: "application/json", "user-agent": "switchbord/0.1" }, signal: AbortSignal.timeout(timeoutMs) });
    const ms = Math.round(performance.now() - t0);
    if (res.status === 401 || res.status === 403) { await res.body?.cancel(); return { ...base, state: "reachable", ms, networks: [] }; }
    if (!res.ok) { await res.body?.cancel(); return { ...base, state: "down", ms, networks: [], error: `status ${res.status}` }; }
    const kinds: { network?: string }[] = (await res.json())?.kinds ?? [];
    const networks = [...new Set(kinds.map((k) => networkName(k.network)))].sort();
    return networks.length ? { ...base, state: "up", ms, networks } : { ...base, state: "down", ms, networks, error: "no supported networks" };
  } catch (err: any) {
    return { ...base, state: "down", ms: Math.round(performance.now() - t0), networks: [], error: err?.name === "TimeoutError" ? "timeout" : String(err?.cause?.code ?? err?.message ?? err).slice(0, 80) };
  }
}

/** Probe all facilitators in parallel, cached for a minute. */
export function snapshot(force = false): Promise<FacilitatorHealth[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.list);
  inflight ??= Promise.all(FACILITATORS.map((f) => probe(f))).then((list) => { cache = { at: Date.now(), list }; return list; }).finally(() => { inflight = null; });
  return inflight;
}

export const cached = () => cache?.list;

export interface NetworkHealth { network: string; up: number; slow: number; total: number; bestMs: number | null }

/** Per network: how many facilitators that list it are up, and the fastest answer. */
export function byNetwork(list: FacilitatorHealth[]): NetworkHealth[] {
  const nets = new Map<string, FacilitatorHealth[]>();
  for (const h of list) for (const n of h.networks) nets.set(n, [...(nets.get(n) ?? []), h]);
  return [...nets].map(([network, hs]) => ({
    network, total: hs.length, up: hs.filter((h) => h.state === "up").length,
    slow: hs.filter((h) => h.state === "up" && h.ms > SLOW_MS).length,
    bestMs: hs.some((h) => h.state === "up") ? Math.min(...hs.filter((h) => h.state === "up").map((h) => h.ms)) : null,
  })).sort((a, b) => a.network.localeCompare(b.network));
}

/** Warnings for a route answer, from cached probes only (never adds latency). Only for networks we have seen a facilitator for. */
export function warningsFor(networks: string[], list = cached()): string[] {
  if (!list) return [];
  const health = byNetwork(list);
  const out: string[] = [];
  for (const n of new Set(networks)) {
    const h = health.find((x) => x.network === n);
    if (!h) continue; // CDP-only networks stay unknown rather than flagged
    if (!h.up) out.push(`no facilitator for ${n} is answering right now`);
    else if (h.slow === h.up) out.push(`facilitators for ${n} are slow right now (${h.bestMs} ms)`);
  }
  return out;
}
