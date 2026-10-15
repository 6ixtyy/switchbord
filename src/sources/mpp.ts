// MPP directory (mpp.dev): Stripe/Tempo Machine Payments Protocol services.
import type { Endpoint, PayOption } from "../types.ts";
import { mppLabel } from "../labels.ts";

const API = "https://mpp.dev/api/services";

function payOptions(svc: any, ep: any): PayOption[] {
  const p = ep.payment ?? {};
  const price = p.amount != null && p.decimals != null ? Number(p.amount) / 10 ** p.decimals : null;
  const methods = new Set<string>([...(p.method ? [p.method] : []), ...Object.keys(svc.methods ?? {})]);
  return [...methods].map((m) => ({
    rail: "mpp" as const,
    label: mppLabel(m),
    network: m,
    asset: m === p.method ? p.currency : undefined,
    priceUsd: price,
    scheme: p.intent ?? svc.methods?.[m]?.intents?.[0],
  }));
}

export async function fetchMpp(): Promise<Omit<Endpoint, "id" | "market">[]> {
  const r = await fetch(API, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`mpp ${r.status}`);
  const { services } = (await r.json()) as { services: any[] };
  const out: Omit<Endpoint, "id" | "market">[] = [];
  for (const s of services) {
    if (s.status && s.status !== "active") continue;
    const base = (s.serviceUrl ?? s.url ?? "").replace(/\/$/, "");
    for (const ep of s.endpoints ?? []) {
      if (!ep.payment) continue; // free endpoint
      out.push({
        url: base + ep.path,
        method: (ep.method ?? "GET").toUpperCase(),
        service: s.name ?? s.id,
        description: (ep.description || s.description || "").slice(0, 500),
        tags: [...(s.categories ?? []), ...(s.tags ?? [])].slice(0, 12),
        pay: payOptions(s, ep),
        sources: ["mpp"],
      });
    }
  }
  return out;
}
