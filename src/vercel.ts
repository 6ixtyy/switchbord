// Vercel function entry (bundled by scripts/build-vercel.mjs). The inventory is built at deploy time and shipped
// next to this file; each warm instance keeps its own health cache. Reports land in /tmp (ephemeral) for now.
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handle, init } from "./app.ts";

const ready = init({ inventoryPath: join(import.meta.dirname, "inventory.json"), reportsPath: "/tmp/reports.jsonl" });

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await ready;
  return handle(req, res);
}
