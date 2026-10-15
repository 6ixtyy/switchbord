// Usage log: one row per API or MCP call, so we can see who uses SwitchBord, when and how fast it grows.
// Postgres when DATABASE_URL is set (same database as the check history); else data/usage.jsonl locally.
// Privacy: no raw IP (a salted hash that changes every day, so it counts distinct callers per day but can't follow
// anyone across days), no request bodies except the task text (cut to 200 chars), no headers other than a trimmed user-agent.
import postgres from "postgres";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";

export interface UsageEvent {
  at: Date; kind: "route" | "mcp" | "markets" | "endpoint" | "report"; via: "http" | "mcp"; tool: string | null;
  task: string | null; market: string | null; mode: string | null; results: number | null; ms: number; status: number;
  client: string; ua: string | null; visitor: string; country: string | null;
}

const raw = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const URL_ = raw ? (() => { const u = new URL(raw); u.searchParams.delete("channel_binding"); return u.toString(); })() : undefined;
export const enabled = !!URL_;
const keep = enabled || !process.env.VERCEL;
const FILE = join(process.cwd(), "data", "usage.jsonl");
const MAX_BUFFER = 2000;
const sql = URL_ ? postgres(URL_, { max: 1, idle_timeout: 20, connect_timeout: 10, prepare: false, onnotice: () => {} }) : null;

let schema: Promise<unknown> | null = null;
const ensureSchema = () => (schema ??= sql!.begin(async (tx) => {
  await tx`create table if not exists usage_events (
    id bigserial primary key, at timestamptz not null, kind text not null, via text not null, tool text, task text, market text,
    mode text, results integer, ms integer not null, status smallint not null, client text not null, ua text, visitor text not null, country text)`;
  await tx`create index if not exists usage_events_at on usage_events (at)`;
}).catch((e) => { schema = null; throw e; }));

const buffer: UsageEvent[] = [];

/** Short client label from the user-agent: MCP clients announce themselves, browsers and scripts are grouped. */
export function clientName(ua: string | undefined, mcpClient?: string): string {
  if (mcpClient) return mcpClient.slice(0, 60);
  if (!ua) return "unknown";
  if (/claude-code|claude-ai|claude/i.test(ua)) return "claude";
  if (/cursor/i.test(ua)) return "cursor";
  if (/smithery/i.test(ua)) return "smithery";
  if (/glama/i.test(ua)) return "glama";
  if (/bot|crawl|spider|monitor|uptime|vercel-/i.test(ua)) return "bot";
  if (/mozilla/i.test(ua)) return "browser";
  if (/node|undici|axios|python|curl|go-http|okhttp|java|ruby|php|fetch/i.test(ua)) return "script:" + (ua.split(/[\/ ]/)[0] || "?").toLowerCase().slice(0, 20);
  return ua.split(/[\/ ]/)[0].toLowerCase().slice(0, 30);
}

function visitor(req: IncomingMessage): string {
  const ip = String(req.headers["x-forwarded-for"] ?? req.socket?.remoteAddress ?? "").split(",")[0].trim();
  const day = new Date().toISOString().slice(0, 10);
  const salt = process.env.CRON_SECRET ?? raw ?? "switchbord";
  return createHash("sha256").update(`${salt}|${day}|${ip}`).digest("hex").slice(0, 16);
}

export function record(req: IncomingMessage, e: Omit<UsageEvent, "at" | "ua" | "visitor" | "country" | "client"> & { mcpClient?: string }) {
  if (!keep) return;
  const ua = req.headers["user-agent"] ? String(req.headers["user-agent"]).slice(0, 120) : null;
  const { mcpClient, ...rest } = e;
  buffer.push({ ...rest, task: rest.task ? rest.task.slice(0, 200) : null, at: new Date(), ua, client: clientName(ua ?? undefined, mcpClient), visitor: visitor(req), country: (req.headers["x-vercel-ip-country"] as string) ?? null });
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
}

export async function flush() {
  if (!buffer.length) return 0;
  const rows = buffer.splice(0);
  try {
    if (sql) { await ensureSchema(); await sql`insert into usage_events ${sql(rows as any)}`; }
    else { mkdirSync(join(FILE, ".."), { recursive: true }); appendFileSync(FILE, rows.map((r) => JSON.stringify(r)).join("\n") + "\n"); }
    return rows.length;
  } catch (e: any) {
    console.error("usage write failed:", e?.message ?? e);
    buffer.unshift(...rows.slice(-(MAX_BUFFER - buffer.length)));
    return 0;
  }
}

/** Summary for GET /stats?days=N (default 14). Only totals and top lists: no row-level data leaves the database. */
export async function summary(days = 14) {
  if (!sql) return { enabled: false, note: "usage log needs DATABASE_URL (rows go to data/usage.jsonl locally)" };
  await ensureSchema();
  const d = Math.min(Math.max(Math.floor(days) || 14, 1), 90);
  const since = sql`now() - make_interval(days => ${d})`;
  const [daily, hourly, tasks, clients, modes, tools, totals, countries] = await Promise.all([
    sql`select to_char(date_trunc('day', at), 'YYYY-MM-DD') as day, count(*)::int as calls, count(distinct visitor)::int as visitors,
        count(*) filter (where via = 'mcp')::int as mcp, count(*) filter (where kind = 'route')::int as routes
        from usage_events where at > ${since} group by 1 order by 1`,
    sql`select to_char(date_trunc('hour', at), 'YYYY-MM-DD"T"HH24":00Z"') as hour, count(*)::int as calls from usage_events where at > now() - interval '24 hours' group by 1 order by 1`,
    sql`select task, count(*)::int as calls from usage_events where at > ${since} and task is not null group by 1 order by 2 desc limit 20`,
    sql`select client, count(*)::int as calls, count(distinct visitor)::int as visitor_days from usage_events where at > ${since} group by 1 order by 2 desc limit 15`,
    sql`select coalesce(mode, '-') as mode, count(*)::int as calls from usage_events where at > ${since} and kind in ('route') group by 1 order by 2 desc`,
    sql`select coalesce(tool, kind) as tool, via, count(*)::int as calls from usage_events where at > ${since} group by 1, 2 order by 3 desc`,
    sql`select count(*)::int as calls, count(distinct visitor)::int as visitor_days, min(at) as first_call, max(at) as last_call,
        percentile_cont(0.5) within group (order by ms)::int as p50_ms from usage_events where at > ${since}`,
    sql`select coalesce(country, '?') as country, count(*)::int as calls from usage_events where at > ${since} group by 1 order by 2 desc limit 10`,
  ]);
  return { enabled: true, days: d, note: "visitors = distinct hashed callers per day, summed over days (no cross-day tracking)", totals: totals[0], daily, last24hByHour: hourly, topTasks: tasks, clients, routeModes: modes, tools, countries };
}
