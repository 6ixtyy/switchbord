// The inventory: every known paid endpoint across protocols, merged and tagged with a market.
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, existsSync, openSync, writeSync, closeSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Endpoint } from "./types.ts";
import { classify, endpointText } from "./markets.ts";
import { fetchBazaar } from "./sources/bazaar.ts";
import { fetchMpp } from "./sources/mpp.ts";

export const INVENTORY_PATH = join(import.meta.dirname, "..", "data", "inventory.json");

function key(method: string, url: string): string {
  try {
    const u = new URL(url);
    return `${method} ${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return `${method} ${url}`;
  }
}

const id = (k: string) => createHash("sha256").update(k).digest("base64url").slice(0, 12);

export function merge(lists: Omit<Endpoint, "id" | "market">[][]): Endpoint[] {
  const byKey = new Map<string, Endpoint>();
  for (const list of lists) {
    for (const e of list) {
      const k = key(e.method, e.url);
      const prev = byKey.get(k);
      if (!prev) {
        byKey.set(k, { ...e, pay: [...e.pay], id: id(k), market: null });
        continue;
      }
      // Same endpoint listed twice (or on both rails): keep one record, union the ways to pay.
      const labels = new Set(prev.pay.map((p) => p.label + p.payTo));
      for (const p of e.pay) if (!labels.has(p.label + p.payTo)) prev.pay.push(p);
      prev.sources = [...new Set([...prev.sources, ...e.sources])];
      prev.description ||= e.description;
      prev.input ??= e.input;
      if (e.usage && (!prev.usage || e.usage.payers30d > prev.usage.payers30d)) prev.usage = e.usage;
    }
  }
  const out = [...byKey.values()];
  for (const e of out) e.market = classify(endpointText(e));
  return out;
}

/** One seller can list tens of thousands of templated endpoints (one host held 55k of 86k in 2026-10): that alone
 *  needs more memory than a small free host has. Keep each host's most-used endpoints, up to SB_MAX_PER_HOST
 *  (default 1500; 0 = no cap). Decision 0025. */
export function capPerHost(endpoints: Endpoint[], max = Number(process.env.SB_MAX_PER_HOST ?? 1500)): Endpoint[] {
  if (!(max > 0)) return endpoints;
  const host = (e: Endpoint) => { try { return new URL(e.url).host; } catch { return e.url; } };
  const groups = new Map<string, Endpoint[]>();
  for (const e of endpoints) (groups.get(host(e)) ?? groups.set(host(e), []).get(host(e))!).push(e);
  const drop = new Set<Endpoint>();
  for (const es of groups.values()) {
    if (es.length <= max) continue;
    const used = (e: Endpoint) => (e.usage?.payers30d ?? 0) * 1e6 + (e.usage?.calls30d ?? 0);
    for (const e of [...es].sort((a, b) => used(b) - used(a)).slice(max)) drop.add(e);
  }
  return drop.size ? endpoints.filter((e) => !drop.has(e)) : endpoints;
}

/** A source that failed this time keeps its endpoints from the previous inventory, so one catalog being down
 *  doesn't drop its sellers. They're tagged with the source's name, so they're replaced as soon as it answers again. */
export async function buildInventory(previous: Endpoint[] = []): Promise<{ endpoints: Endpoint[]; errors: string[]; carried: Record<string, number>; fresh: number }> {
  const errors: string[] = [];
  const failed = new Set<string>();
  const settle = async <T,>(name: string, p: Promise<T[]>) => p.catch((e) => (failed.add(name), errors.push(`${name}: ${e.message}`), [] as T[]));
  const [bazaar, mpp] = await Promise.all([settle("bazaar", fetchBazaar()), settle("mpp", fetchMpp())]);
  const carried: Record<string, number> = {};
  const kept = previous.filter((e) => e.sources.some((s) => failed.has(s)));
  for (const name of failed) carried[name] = kept.filter((e) => e.sources.includes(name)).length;
  return { endpoints: capPerHost(merge([bazaar, mpp, kept])), errors, carried, fresh: bazaar.length + mpp.length };
}

/** One JSON object per line (a header, then one endpoint each): loading never holds the whole file as one string,
 *  which halves peak memory on small hosts. Older single-object files still load. */
export function saveInventory(endpoints: Endpoint[], path = INVENTORY_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "w");
  try {
    writeSync(fd, JSON.stringify({ builtAt: new Date().toISOString() }) + "\n");
    for (let i = 0; i < endpoints.length; i += 500) writeSync(fd, endpoints.slice(i, i + 500).map((e) => JSON.stringify(e) + "\n").join(""));
  } finally { closeSync(fd); }
}

export function loadInventory(path = INVENTORY_PATH): { builtAt: string; endpoints: Endpoint[] } | null {
  if (!existsSync(path)) return null;
  const buf = readFileSync(path);
  const nl = buf.indexOf(10);
  const head = JSON.parse(buf.toString("utf8", 0, nl < 0 ? buf.length : nl));
  if (head.endpoints) return head; // legacy: whole inventory on one line
  const endpoints: Endpoint[] = [];
  for (let start = nl + 1; start < buf.length;) {
    let end = buf.indexOf(10, start);
    if (end < 0) end = buf.length;
    if (end > start) endpoints.push(JSON.parse(buf.toString("utf8", start, end)));
    start = end + 1;
  }
  return { builtAt: head.builtAt, endpoints };
}

/** Share identical pay lists and repeated strings between endpoints (a seller's endpoints mostly pay the same way):
 *  about 40 MB less heap for 55k endpoints. Call on a freshly loaded inventory, before anything mutates it. */
export function compact(endpoints: Endpoint[]): Endpoint[] {
  const pays = new Map<string, Endpoint["pay"]>(), strs = new Map<string, string>();
  for (const e of endpoints) {
    const k = JSON.stringify(e.pay), p = pays.get(k);
    if (p) e.pay = p; else pays.set(k, e.pay);
    for (const f of ["service", "description", "method", "updatedAt"] as const) {
      const v = e[f];
      if (typeof v !== "string") continue;
      const s = strs.get(v);
      if (s) (e as any)[f] = s; else strs.set(v, v);
    }
  }
  return endpoints;
}
