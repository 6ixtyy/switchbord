export type Rail = "x402" | "mpp";

/** One way to pay an endpoint. `label` is what agents match against, e.g. "x402:base:usdc", "mpp:tempo". */
export interface PayOption {
  rail: Rail;
  label: string;
  network?: string;
  asset?: string;
  priceUsd: number | null;
  payTo?: string;
  scheme?: string;
}

export interface Endpoint {
  id: string;
  url: string;
  method: string;
  service: string;
  description: string;
  tags: string[];
  market: string | null;
  pay: PayOption[];
  /** Example request from the listing: { query?: {...}, body?: {...} }. */
  input?: { query?: Record<string, unknown>; body?: unknown };
  sources: string[];
  usage?: { calls30d: number; payers30d: number; lastCalledAt?: string };
  updatedAt?: string;
}

export interface Health {
  ok: boolean;
  status: number | null;
  ms: number;
  checkedAt: number;
  priceUsd?: number | null;
  error?: string;
}
