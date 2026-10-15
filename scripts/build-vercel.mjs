// Builds .vercel/output (Vercel Build Output API v3): one Node function serving every path.
// Run after `npm run inventory` so data/inventory.json is fresh.
import { build } from "esbuild";
import { mkdirSync, rmSync, writeFileSync, copyFileSync, existsSync } from "node:fs";

const out = ".vercel/output", fn = `${out}/functions/index.func`;
if (!existsSync("data/inventory.json")) throw new Error("data/inventory.json missing: run npm run inventory first");
rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });

await build({
  entryPoints: ["src/vercel.ts"], outfile: `${fn}/index.mjs`, bundle: true, platform: "node", target: "node22", format: "esm",
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  minify: true, legalComments: "none",
});
copyFileSync("data/inventory.json", `${fn}/inventory.json`);
writeFileSync(`${fn}/.vc-config.json`, JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false, maxDuration: 120, memory: 1024 }));
writeFileSync(`${fn}/package.json`, JSON.stringify({ type: "module" }));
writeFileSync(`${out}/config.json`, JSON.stringify({ version: 3, routes: [{ src: "/(.*)", dest: "/index" }], crons: [{ path: "/cron/daily", schedule: "17 5 * * *" }] }));
console.log("built", out);
