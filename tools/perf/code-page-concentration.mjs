#!/usr/bin/env node
// E4-T40c1: how concentrated is the Replay desktop's interactive work in guest code pages?
//
//   node tools/perf/code-page-concentration.mjs --url http://127.0.0.1:8125 --app /app.html [--out F]
//
// Opens the desktop with the hot-PC profiler armed (`?profile=1`: 1-in-~1024 retirements sampled, 64-byte
// regions keyed by the guest VIRTUAL pc; the turbo loop stands aside while it is armed, so every retirement
// can be sampled and the desktop runs slower), runs three scenarios — 8 clicks on Chrome's "Run again",
// 5 short lines typed into the terminal, 3 `node -e` commands — and for each reports the share of samples
// covered by the hottest 1, 10, 100, 1000 pages (4 KiB) and the number of distinct pages sampled.
// Virtual pages: a library page shared by two processes counts twice, so page counts are an upper bound
// for physical-page units.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { values: opt } = parseArgs({ options: {
  url: { type: "string", default: "http://127.0.0.1:8125" }, app: { type: "string", default: "/app.html" },
  out: { type: "string", default: path.join(repo, "evidence/e4-t40c1/concentration.json") },
  chrome: { type: "string", default: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
} });
const log = (...a) => console.log(`[concentration ${new Date().toISOString().slice(11, 19)}]`, ...a);
const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: opt.chrome });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
await page.addInitScript(() => window.addEventListener("wvm:desktop-ready", () => { window.__ready = 1; }));
await page.goto(`${opt.url}${opt.app}?guest=replay-desktop&desktop=1&net=0&profile=1#ide`);
await page.waitForFunction(() => window.__ready && document.getElementById("omarchy-boot-overlay")?.hidden === true,
  null, { timeout: 20 * 60_000 });
await page.waitForTimeout(5000);
const profile = async () => {
  const p = await page.evaluate(() => window.__linuxCtl.profileStats(1_000_000));
  const m = new Map();
  for (const r of p?.regions ?? []) m.set(r.pc, r.samples);
  return { m, sampleCount: p?.sampleCount ?? 0 };
};
const box = await page.locator("#ide-display-canvas").boundingBox();
const at = (x, y) => [box.x + box.width * (x / 1280), box.y + box.height * (y / 800)];
const KEY = { " ": "Space", "-": "Minus", "'": "Quote", ".": "Period", "(": ["Shift", "Digit9"], ")": ["Shift", "Digit0"], "*": ["Shift", "Digit8"] };
async function typeText(text) {
  for (const ch of text) {
    const k = /[a-z]/u.test(ch) ? `Key${ch.toUpperCase()}` : /[0-9]/u.test(ch) ? `Digit${ch}` : KEY[ch];
    if (Array.isArray(k)) { await page.keyboard.down(k[0]); await page.keyboard.press(k[1], { delay: 30 }); await page.keyboard.up(k[0]); }
    else await page.keyboard.press(k, { delay: 30 });
    await page.waitForTimeout(150);
  }
}
const scenarios = {
  click: async () => { for (let i = 0; i < 8; i++) { await page.mouse.click(...at(93, 516)); await page.waitForTimeout(2500); } },
  type: async () => {
    await page.mouse.click(...at(1050, 400)); await page.waitForTimeout(1500);
    for (let i = 0; i < 5; i++) { await typeText("echo hello"); await page.keyboard.press("Enter"); await page.waitForTimeout(1500); }
  },
  node: async () => {
    await page.mouse.click(...at(1050, 400)); await page.waitForTimeout(1500);
    for (let i = 0; i < 3; i++) { await typeText("node -e 'console.log(6*7)'"); await page.keyboard.press("Enter"); await page.waitForTimeout(12000); }
  },
};
const result = { url: page.url(), scenarios: {} };
for (const [name, run] of Object.entries(scenarios)) {
  const a = await profile();
  await run();
  const z = await profile();
  const pages = new Map();
  let total = 0;
  for (const [pc, s] of z.m) {
    const d = s - (a.m.get(pc) ?? 0);
    if (d <= 0) continue;
    total += d;
    const pg = (BigInt(pc) >> 12n).toString(16);
    pages.set(pg, (pages.get(pg) ?? 0) + d);
  }
  const sorted = [...pages.values()].sort((x, y) => y - x);
  const cover = (n) => +(100 * sorted.slice(0, n).reduce((x, y) => x + y, 0) / Math.max(1, total)).toFixed(1);
  const kernel = [...pages.entries()].filter(([pg]) => BigInt(`0x${pg}`) >= 0xffffffc000000n).reduce((x, [, v]) => x + v, 0);
  result.scenarios[name] = { samples: total, pages: sorted.length, coverPct: { 1: cover(1), 10: cover(10), 100: cover(100), 1000: cover(1000) },
    kernelPct: +(100 * kernel / Math.max(1, total)).toFixed(1), topPages: [...pages.entries()].sort((x, y) => y[1] - x[1]).slice(0, 20) };
  log(name, JSON.stringify({ samples: total, pages: sorted.length, cover: result.scenarios[name].coverPct, kernelPct: result.scenarios[name].kernelPct }));
}
fs.mkdirSync(path.dirname(opt.out), { recursive: true });
fs.writeFileSync(opt.out, JSON.stringify(result, null, 2) + "\n");
await browser.close();
