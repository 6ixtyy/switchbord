// npm run inventory — pull every source, merge, classify, save data/inventory.json, print a summary.
import { buildInventory, saveInventory, INVENTORY_PATH } from "../inventory.ts";

const t0 = Date.now();
const { endpoints, errors } = await buildInventory();
if (!endpoints.length) {
  console.error("No endpoints fetched.", errors);
  process.exit(1);
}
saveInventory(endpoints);

const count = (f: (e: (typeof endpoints)[number]) => string | null) => {
  const m = new Map<string, number>();
  for (const e of endpoints) { const k = f(e) ?? "(none)"; m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1]);
};
const hosts = (es: typeof endpoints) => new Set(es.map((e) => { try { return new URL(e.url).host; } catch { return e.url; } })).size;

console.log(`${endpoints.length} endpoints from ${hosts(endpoints)} hosts in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${INVENTORY_PATH}`);
if (errors.length) console.log("source errors:", errors);
console.log("by source:", Object.fromEntries(count((e) => e.sources.join("+"))));
console.log("by rail:", Object.fromEntries(count((e) => [...new Set(e.pay.map((p) => p.rail))].sort().join("+"))));
console.log("\nmarket                 endpoints  sellers");
for (const [m, n] of count((e) => e.market)) {
  const es = endpoints.filter((e) => (e.market ?? "(none)") === m);
  console.log(`${m.padEnd(22)} ${String(n).padStart(9)} ${String(hosts(es)).padStart(8)}`);
}
