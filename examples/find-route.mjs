// Ask SwitchBord which sellers to call for a task. Node 18+, no dependencies.
// Usage: node find-route.mjs "search the web"
const task = process.argv[2] ?? "search the web";
const url = new URL("https://switchbord.vercel.app/route");
url.searchParams.set("task", task);
url.searchParams.set("accepts", "x402:base:usdc");
url.searchParams.set("max_price", "0.05");
url.searchParams.set("limit", "3");

const res = await fetch(url);
if (!res.ok) throw new Error(`SwitchBord answered ${res.status}: ${await res.text()}`);
const route = await res.json();

console.log(`mode=${route.mode} market=${route.market} sellersMatched=${route.sellersMatched}`);
for (const c of route.candidates) {
  console.log(`#${c.rank} ${c.service || "(no name)"} ${c.method} ${c.url} $${c.priceUsd ?? "?"} charges=${c.charges} up=${c.health?.ok}`);
}
// Next: call candidates[0].url with your own x402/MPP client; on failure try candidates[1].
