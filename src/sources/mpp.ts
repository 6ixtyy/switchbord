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
  return mppEndpoints(services);
}

/** A service's own tags describe the whole service. A multi-topic service (AIsa: web search, finance, weather,
 *  travel...) must not hand every endpoint every topic, or each one lands in every market. Such a service's
 *  endpoints are tagged from their own description only. */
export function mppEndpoints(services: any[]): Omit<Endpoint, "id" | "market">[] {
  const out: Omit<Endpoint, "id" | "market">[] = [];
  for (const s of services) {
    if (s.status && s.status !== "active") continue;
    const multiTopic = (s.tags ?? []).length > 1;
    const base = (s.serviceUrl ?? s.url ?? "").replace(/\/$/, "");
    for (const ep of s.endpoints ?? []) {
      if (!ep.payment) continue; // free endpoint
      out.push({
        url: base + ep.path,
        method: (ep.method ?? "GET").toUpperCase(),
        service: s.name ?? s.id,
        description: (ep.description || (multiTopic ? s.name : s.description) || "").slice(0, 500),
        tags: [...(s.categories ?? []), ...(multiTopic ? [] : s.tags ?? [])].slice(0, 12),
        pay: payOptions(s, ep),
        sources: ["mpp"],
      });
    }
  }
  return out;
}
