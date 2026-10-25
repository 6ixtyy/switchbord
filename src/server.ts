// Local / long-running server: npm start. Keeps top sellers warm and rebuilds the inventory every few hours.
import { createServer } from "node:http";
import { getRouter, handle, init, rebuild } from "./app.ts";

const PORT = Number(process.env.PORT ?? 8402);
const REBUILD_MS = Number(process.env.SB_REBUILD_MS ?? 6 * 3600_000);
// Small hosts (512 MB) can't hold the old and the new inventory at once: set SB_REBUILD_MS=0 and SB_RESTART_MS instead,
// and start with `npm run inventory && npm start`, so the platform restarts the process and it boots on a fresh inventory.
const RESTART_MS = Number(process.env.SB_RESTART_MS ?? 0);

await init();
const warm = () => getRouter().warm().catch((e) => console.error("warm failed", e));
warm();
setInterval(warm, 60_000).unref();
if (REBUILD_MS > 0) setInterval(() => rebuild().catch((e) => console.error("rebuild failed", e)), REBUILD_MS).unref();
if (RESTART_MS > 0) setTimeout(() => { console.log("scheduled restart"); process.exit(0); }, RESTART_MS).unref();

createServer(handle).listen(PORT, () => console.log(`SwitchBord on http://localhost:${PORT}`));
