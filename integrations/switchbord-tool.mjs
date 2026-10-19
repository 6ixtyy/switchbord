// A dependency-free SwitchBord tool for any agent framework. Node 18+.
// `findPaidEndpoint(task)` asks SwitchBord who to call; it never pays anyone. Pay the seller with your own x402 or MPP client.
// `toolDefinitions` are ready-made function-calling schemas (OpenAI-style and Anthropic-style) for the same call.
const BASE = "https://switchbord.vercel.app";

/** Ask for the working, cheapest, fastest sellers for a task, plus backups. Try candidates in order. */
export async function findPaidEndpoint(task, { accepts = "x402:base:usdc", maxPrice, limit = 3, base = BASE } = {}) {
  const url = new URL("/route", base);
  url.searchParams.set("task", task);
  if (accepts) url.searchParams.set("accepts", accepts);
  if (maxPrice != null) url.searchParams.set("max_price", String(maxPrice));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("src", "integration");
  const res = await fetch(url, { headers: { "user-agent": "switchbord-tool/0.1" } });
  if (!res.ok) throw new Error(`SwitchBord answered ${res.status}: ${await res.text()}`);
  return res.json(); // { mode, market, sellersMatched, candidates: [{ rank, url, method, priceUsd, pay, input, health, charges }] }
}

const description = "Find which paid API (x402 or MPP) to call for a task. Returns the sellers that are working, cheapest and fastest right now, plus backups. Free; does not pay anything. Call the top candidate with your own payment client; if it fails, try the next.";
const parameters = {
  type: "object",
  properties: {
    task: { type: "string", description: "What you need, in plain words, e.g. 'search the web' or 'ETH price'." },
    max_price: { type: "number", description: "Optional ceiling in USD per call." },
  },
  required: ["task"],
};

export const toolDefinitions = {
  openai: { type: "function", function: { name: "find_paid_endpoint", description, parameters } },
  anthropic: { name: "find_paid_endpoint", description, input_schema: parameters },
};

/** Run a tool call from a model: `await runTool({ task: "search the web" })`. */
export const runTool = ({ task, max_price }) => findPaidEndpoint(task, { maxPrice: max_price });

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await findPaidEndpoint(process.argv[2] ?? "search the web");
  console.log(JSON.stringify(r.candidates.map((c) => ({ rank: c.rank, url: c.url, priceUsd: c.priceUsd, up: c.health?.ok })), null, 2));
}
