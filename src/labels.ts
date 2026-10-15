// Maps raw network / asset identifiers to the short labels agents use ("x402:base:usdc").
// Only official USDC contracts are called "usdc"; anything else keeps its raw address so lookalikes never match.

const NETWORKS: Record<string, string> = {
  "eip155:8453": "base", base: "base",
  "eip155:84532": "base-sepolia", "base-sepolia": "base-sepolia",
  "eip155:1": "ethereum", ethereum: "ethereum",
  "eip155:137": "polygon", polygon: "polygon",
  "eip155:42161": "arbitrum", arbitrum: "arbitrum",
  "eip155:10": "optimism", optimism: "optimism",
  "eip155:43114": "avalanche", avalanche: "avalanche",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "solana", solana: "solana",
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "solana-devnet", "solana-devnet": "solana-devnet",
};

const USDC = new Set([
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // base
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e", // base-sepolia
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // ethereum
  "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", // polygon
  "0xaf88d065e77c8cc2239327c5edb3a432268e5831", // arbitrum
  "0x0b2c639c533813f4aa9d7837caf62653d097ff85", // optimism
  "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e", // avalanche
  "epjfwdd5aufqssqem2qn1xzybapc8g4wegGkzwytdt1v".toLowerCase(), // solana
  "4zmmc9srt5ri5x14gagxhahii3gnpaeerypjgzjdncdu", // solana-devnet
]);

export const networkName = (n?: string) => (n ? NETWORKS[n] ?? n : "unknown");
export const isUsdc = (asset?: string) => !!asset && USDC.has(asset.toLowerCase());

export function x402Label(network?: string, asset?: string): string {
  return `x402:${networkName(network)}:${isUsdc(asset) ? "usdc" : asset ?? "unknown"}`;
}

export const mppLabel = (method: string) => `mpp:${method}`;

/** True if an offered label satisfies one of the agent's accepted labels. Supports trailing "*" wildcards. */
export function accepts(offered: string, wanted: string[]): boolean {
  return wanted.some((w) => (w.endsWith("*") ? offered.startsWith(w.slice(0, -1)) : offered === w));
}
