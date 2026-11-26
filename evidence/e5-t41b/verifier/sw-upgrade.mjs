// Returning visitor across the gen1 -> gen2 deploy, with the real service worker (not blocked).
import path from "node:path"; import { pathToFileURL } from "node:url";
const [repo, base, profile, label] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
const ctx = await chromium.launchPersistentContext(profile, { headless: true, serviceWorkers: "allow", executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const page = ctx.pages()[0] || await ctx.newPage();
const seen = [];
page.on("request", (r) => { const u = r.url(); if (/snap\.gz|artifacts-replay-desktop\.json|chunks\.json/.test(u)) seen.push(u.replace(/^https?:\/\/[^/]+/, "")); });
const fromSW = [];
page.on("response", (r) => { if (/artifacts-replay-desktop\.json/.test(r.url())) fromSW.push(r.fromServiceWorker()); });
await page.goto(`${base}/app.html?guest=replay-desktop&desktop=1#ide`);
const t0 = Date.now();
while (Date.now() - t0 < 25000 && !seen.some((u) => /snap\.gz/.test(u))) await page.waitForTimeout(500);
await page.waitForTimeout(2000);
const manifest = await page.evaluate(async () => (await (await fetch("./artifacts-replay-desktop.json")).json()).artifacts.bootSnapshot.url);
const sw = await page.evaluate(async () => { const k = await caches.keys(); return { controller: !!navigator.serviceWorker.controller, caches: k }; });
console.log(JSON.stringify({ label, requested: seen, manifestFromSW: fromSW, pageFetchManifestSnapshot: manifest, sw }));
await ctx.close();
