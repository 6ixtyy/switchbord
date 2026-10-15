// Durable state on Vercel Blob (private store). Off when BLOB_READ_WRITE_TOKEN is unset (local runs use files).
//   inventory/latest.json.gz   the inventory, rebuilt daily by /cron/daily
//   reports/raw/<time>-<id>.json  one object per real-call report (no read-modify-write races between instances)
//   reports/summary.json       per-endpoint {ok, bad} counts; raw reports are folded in daily, then deleted
import { put, get, list, del } from "@vercel/blob";
import { gzipSync, gunzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import type { Endpoint } from "./types.ts";

export const enabled = !!process.env.BLOB_READ_WRITE_TOKEN;
const INVENTORY = "inventory/latest.json.gz";
const SUMMARY = "reports/summary.json";
const RAW = "reports/raw/";

export type Counts = Record<string, { ok: number; bad: number }>;
export interface StoredReport { at: string; endpointId: string; outcome: string; ms?: number; tx?: string; network?: string }

async function read(pathname: string, etag?: string): Promise<{ etag: string; body: Buffer } | "unchanged" | null> {
  const r = await get(pathname, { access: "private", useCache: false, ifNoneMatch: etag }).catch((e) => (e?.name === "BlobNotFoundError" ? null : Promise.reject(e)));
  if (!r) return null;
  if (r.statusCode === 304) return "unchanged";
  return { etag: r.blob.etag, body: Buffer.from(await new Response(r.stream).arrayBuffer()) };
}

const write = (pathname: string, body: Buffer | string, contentType: string) =>
  put(pathname, body, { access: "private", allowOverwrite: true, addRandomSuffix: false, contentType, multipart: Buffer.byteLength(body) > 8e6 });

export async function loadInventory(etag?: string): Promise<{ etag: string; builtAt: string; endpoints: Endpoint[] } | "unchanged" | null> {
  const r = await read(INVENTORY, etag);
  if (!r || r === "unchanged") return r;
  return { etag: r.etag, ...JSON.parse(gunzipSync(r.body).toString()) };
}

export async function saveInventory(builtAt: string, endpoints: Endpoint[]) {
  await write(INVENTORY, gzipSync(JSON.stringify({ builtAt, endpoints })), "application/gzip");
}

export async function loadCounts(): Promise<Counts> {
  const r = await read(SUMMARY);
  return r && r !== "unchanged" ? JSON.parse(r.body.toString()).counts ?? {} : {};
}

export async function saveReport(r: StoredReport) {
  await write(`${RAW}${r.at.replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}.json`, JSON.stringify(r), "application/json");
}

/** Fold raw reports into the summary, then delete them. Returns how many were folded. */
export async function compactReports(isOk: (outcome: string) => boolean | null, max = 5000): Promise<number> {
  const counts = await loadCounts();
  const done: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: RAW, cursor, limit: 1000 });
    for (let i = 0; i < page.blobs.length && done.length < max; i += 20) {
      await Promise.all(page.blobs.slice(i, i + 20).map(async (b) => {
        const r = await read(b.pathname);
        if (r && r !== "unchanged") {
          const rep: StoredReport = JSON.parse(r.body.toString());
          const ok = isOk(rep.outcome);
          if (ok !== null) {
            const c = (counts[rep.endpointId] ??= { ok: 0, bad: 0 });
            ok ? c.ok++ : c.bad++;
          }
        }
        done.push(b.url);
      }));
    }
    cursor = page.hasMore && done.length < max ? page.cursor : undefined;
  } while (cursor);
  if (done.length) {
    await write(SUMMARY, JSON.stringify({ updatedAt: new Date().toISOString(), counts }), "application/json");
    for (let i = 0; i < done.length; i += 500) await del(done.slice(i, i + 500));
  }
  return done.length;
}

/** Raw reports not yet folded into the summary (read at cold start so recent reports count right away). */
export async function loadRecentReports(max = 1000): Promise<StoredReport[]> {
  const page = await list({ prefix: RAW, limit: max });
  const out: StoredReport[] = [];
  for (let i = 0; i < page.blobs.length; i += 20) {
    const rs = await Promise.all(page.blobs.slice(i, i + 20).map((b) => read(b.pathname)));
    for (const r of rs) if (r && r !== "unchanged") out.push(JSON.parse(r.body.toString()));
  }
  return out;
}
