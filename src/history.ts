// Check history: every live check is saved, so ranking, a public index and benchmarks can use it later.
// Postgres when DATABASE_URL (or POSTGRES_URL) is set, e.g. Neon from the Vercel Marketplace; else data/checks.jsonl.
// Not Blob: on Hobby it allows 2,000 writes a month and locks the store for 30 days past that.
//   checks    one row per live check (route = right before answering, warm = keeping top sellers fresh, sample = hourly job)
//   rankings  one row per market per sample: endpoint ids in ranked order after the checks (how often #1 changes)
// Writes are buffered and flushed after the response; a failed write is logged and never breaks a route.
import postgres from "postgres";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Endpoint, Health } from "./types.ts";

export type Source = "route" | "warm" | "sample";
interface Row { at: Date; endpoint_id: string; market: string | null; ok: boolean; status: number | null; ms: number; price_usd: number | null; error: string | null; source: Source }

const URL_ = dbUrl(process.env.DATABASE_URL ?? process.env.POSTGRES_URL);
export const enabled = !!URL_;
const FILE = join(process.cwd(), "data", "checks.jsonl");
const MAX_BUFFER = 5000;

// prepare: false works behind poolers (Neon's -pooler host, pgbouncer). One connection per instance is plenty.
const sql = URL_ ? postgres(URL_, { max: 1, idle_timeout: 20, connect_timeout: 10, prepare: false, onnotice: () => {} }) : null;
let schema: Promise<unknown> | null = null;
const ensureSchema = () => (schema ??= sql!.begin(async (tx) => {
  await tx`create table if not exists checks (
    id bigserial primary key, at timestamptz not null, endpoint_id text not null, market text,
    ok boolean not null, status smallint, ms integer not null, price_usd double precision, error text, source text not null)`;
  await tx`create index if not exists checks_endpoint_at on checks (endpoint_id, at)`;
  await tx`create index if not exists checks_at on checks (at)`;
  await tx`create table if not exists rankings (at timestamptz not null, market text not null, endpoint_ids text[] not null, primary key (market, at))`;
}).catch((e) => { schema = null; throw e; }));

/** postgres.js sends unknown URL parameters to the server as settings; drop the libpq-only one Neon adds. */
function dbUrl(raw?: string) {
  if (!raw) return undefined;
  const u = new URL(raw);
  u.searchParams.delete("channel_binding");
  return u.toString();
}

const buffer: Row[] = [];
const inflight = new Set<Promise<unknown>>();

// On Vercel without a database there is nowhere durable (the disk is read-only), so nothing is kept.
const keep = enabled || !process.env.VERCEL;

export function record(e: Endpoint, h: Health, source: Source) {
  if (!keep) return;
  buffer.push({ at: new Date(h.checkedAt), endpoint_id: e.id, market: e.market, ok: h.ok, status: h.status, ms: h.ms, price_usd: h.priceUsd ?? null, error: h.error ?? null, source });
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
}

/** Checks still running past the route's time budget: `settle()` waits for them so their result is saved too. */
export function track(p: Promise<unknown>) {
  inflight.add(p);
  p.finally(() => inflight.delete(p)).catch(() => {});
}

/** Write buffered checks. Returns how many were written; on failure they go back in the buffer for the next flush. */
export async function flush(): Promise<number> {
  if (!buffer.length) return 0;
  const rows = buffer.splice(0);
  try {
    if (sql) {
      await ensureSchema();
      for (let i = 0; i < rows.length; i += 1000) await sql`insert into checks ${sql(rows.slice(i, i + 1000))}`;
    } else {
      mkdirSync(join(FILE, ".."), { recursive: true });
      appendFileSync(FILE, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    }
    return rows.length;
  } catch (e: any) {
    console.error("check history write failed:", e?.message ?? e);
    buffer.unshift(...rows.slice(-(MAX_BUFFER - buffer.length)));
    return 0;
  }
}

/** Wait for in-flight checks (they time out on their own), then flush. Meant for after the response. */
export async function settle(): Promise<number> {
  await Promise.allSettled([...inflight]);
  return flush();
}

export async function saveRankings(at: Date, rankings: { market: string; ids: string[] }[]) {
  if (!rankings.length || !keep) return;
  if (!sql) {
    mkdirSync(join(FILE, ".."), { recursive: true });
    appendFileSync(join(FILE, "..", "rankings.jsonl"), rankings.map((r) => JSON.stringify({ at, ...r })).join("\n") + "\n");
    return;
  }
  await ensureSchema();
  await sql`insert into rankings ${sql(rankings.map((r) => ({ at, market: r.market, endpoint_ids: r.ids })))} on conflict do nothing`;
}

/** When the last sample ran, across all instances (null when unknown). Used to rate-limit the open /cron/sample. */
export async function lastSampleAt(): Promise<Date | null> {
  if (!sql) return null;
  await ensureSchema();
  const [r] = await sql`select max(at) as at from rankings`;
  return r?.at ?? null;
}
