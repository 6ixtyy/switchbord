// The inventory: every known paid endpoint across protocols, merged and tagged with a market.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
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
        byKey.set(k, { ...e, id: id(k), market: null });
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
  return { endpoints: merge([bazaar, mpp, kept]), errors, carried, fresh: bazaar.length + mpp.length };
}

export function saveInventory(endpoints: Endpoint[], path = INVENTORY_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ builtAt: new Date().toISOString(), endpoints }));
}

export function loadInventory(path = INVENTORY_PATH): { builtAt: string; endpoints: Endpoint[] } | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}
