// Local / long-running server: npm start. Keeps top sellers warm and rebuilds the inventory every few hours.
import { createServer } from "node:http";
import { getRouter, handle, init, rebuild } from "./app.ts";

const PORT = Number(process.env.PORT ?? 8402);
const REBUILD_MS = Number(process.env.SB_REBUILD_MS ?? 6 * 3600_000);

await init();
const warm = () => getRouter().warm().catch((e) => console.error("warm failed", e));
warm();
setInterval(warm, 60_000).unref();
setInterval(() => rebuild().catch((e) => console.error("rebuild failed", e)), REBUILD_MS).unref();

createServer(handle).listen(PORT, () => console.log(`SwitchBord on http://localhost:${PORT}`));
