/** Payment protocols SwitchBord routes. Add a rail here, then see docs/ADDING-A-RAIL.md. */
export const RAILS = {
  /** When the buyer is charged: x402 settles only after the seller succeeds; MPP charges before the handler runs. */
  x402: { charges: "after_success" },
  mpp: { charges: "before_handler" },
} as const;

export type Rail = keyof typeof RAILS;

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
