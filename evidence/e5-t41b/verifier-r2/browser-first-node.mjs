// E5-T41b round-2 verifier: what the browser session's FIRST `node` reads from the root disk.
// Loads the desktop (fresh profile, service workers blocked like desktop-latency.mjs), clicks the
// foot terminal, types `clear` and then `node -e 'console.log(6*7)'` with the same DOM key events
// desktop-latency.mjs uses, and reads the guest's /sys/block/vda/stat over the serial shell
// (wvmDemo.exec) before typing, after typing (before Enter) and after node has answered. The
// page's __chunkedStats (host side: chunks served from the whole-image prefill) is read at the
// same points. IDLE_S=<n> waits n seconds after the desktop is ready (stat read every 10 s)
// before the terminal is touched.  [IDLE_S=n] node browser-first-node.mjs <base-url> <app> <out-prefix>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const [base, app, out] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
const errors = [];
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("favicon")) errors.push(m.text().slice(0, 300)); });
await page.addInitScript(() => { window.addEventListener("wvm:desktop-ready", () => { window.__ready = performance.now(); }); });
const url = `${base.replace(/\/+$/u, "")}${app}?guest=replay-desktop&desktop=1#ide`;
const requests = [];
page.on("requestfinished", (r) => requests.push(r.url()));
await page.goto(url);
await page.waitForFunction(() => window.__ready !== undefined && document.getElementById("omarchy-boot-overlay")?.hidden === true, null, { timeout: 30 * 60_000, polling: 250 });
const sleep = (ms) => page.waitForTimeout(ms);
const box = await page.locator("#ide-display-canvas").boundingBox();
const toPage = (p) => ({ x: box.x + (p.x / 1280) * box.width, y: box.y + (p.y / 800) * box.height });
const vda = async () => (await page.evaluate(() => window.wvmDemo.exec("cat /sys/block/vda/stat", 600000, { quiet: true })))?.stdout?.trim().split(/\s+/u).map(Number);
const chunks = () => page.evaluate(async () => { const f = await window.__chunkedStats?.(); return { localHits: f?.localHits ?? null, localBytes: f?.localBytes ?? null, fetches: f?.fetches ?? null }; });
const KEY = { " ": "Space", "-": "Minus", "'": "Quote", ".": "Period", "(": ["Shift", "Digit9"], ")": ["Shift", "Digit0"], "*": ["Shift", "Digit8"] };
async function typeText(text) {
  for (const ch of text) {
    const k = /[a-z]/u.test(ch) ? `Key${ch.toUpperCase()}` : /[0-9]/u.test(ch) ? `Digit${ch}` : KEY[ch];
    if (Array.isArray(k)) { await page.keyboard.down(k[0]); await page.keyboard.press(k[1], { delay: 30 }); await page.keyboard.up(k[0]); }
    else await page.keyboard.press(k, { delay: 30 });
    await sleep(150);
  }
}
const pts = [];
const mark = async (label) => { const v = await vda(); const c = await chunks(); pts.push({ label, readRequests: v?.[0], readSectors: v?.[2], ...c }); console.log(label, JSON.stringify(pts.at(-1))); };
await sleep(3000);
await mark("ready-1");
for (let i = 10; i <= Number(process.env.IDLE_S ?? 0); i += 10) { await sleep(10000); await mark(`idle ${i} s`); }
await mark("ready-2");
const t = toPage({ x: 1036, y: 420 });
await page.mouse.move(t.x, t.y); await page.mouse.down(); await sleep(60); await page.mouse.up(); await sleep(2500);
await typeText("clear"); await page.keyboard.press("Enter", { delay: 30 }); await sleep(3000);
await typeText("node -e 'console.log(6*7)'"); await sleep(3000);
await mark("typed, before Enter");
const t0 = Date.now();
await page.keyboard.down("Enter"); await sleep(40); await page.keyboard.up("Enter");
await sleep(15000);
await mark("15 s after Enter");
await page.screenshot({ path: `${out}.png` });
const d = (a, b) => ({ readRequests: b.readRequests - a.readRequests, readKiB: (b.readSectors - a.readSectors) / 2, localHits: b.localHits - a.localHits });
const n = pts.length;
const res = { url, idleS: Number(process.env.IDLE_S ?? 0), points: pts, firstNodeDelta: d(pts[n - 2], pts[n - 1]), typingDelta: d(pts[n - 3], pts[n - 2]), beforeTypingDelta: d(pts[0], pts[n - 3]),
  snapshotRequests: requests.filter((u) => /boot-snapshot/u.test(u)), staleGen1: requests.filter((u) => /2d4d38924d83|dfcf85c2c260|2af6100e9b37/u.test(u)), consoleErrors: errors };
fs.writeFileSync(`${out}.json`, JSON.stringify(res, null, 2) + "\n");
console.log("RESULT", JSON.stringify({ firstNodeDelta: res.firstNodeDelta, typingDelta: res.typingDelta, beforeTypingDelta: res.beforeTypingDelta, staleGen1: res.staleGen1.length, consoleErrors: errors.length }));
await browser.close();
