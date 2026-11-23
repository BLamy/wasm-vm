import fs from "node:fs";
import { pathToFileURL } from "node:url";
const repo = "/Users/blamy/Documents/Codex/wasm-vm";
const whole = JSON.parse(fs.readFileSync(repo + "/releases/chunked-alpine/alpine-rootfs.img.gz.json", "utf8"));
const { chromium } = await import(pathToFileURL(repo + "/web/node_modules/playwright/index.mjs"));
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const TEXT = () => { const b = window.__term.term.buffer.active; let t = ""; for (let i = 0; i < b.length; i++) { const l = b.getLine(i); if (l) t += (i && !l.isWrapped ? "\n" : "") + l.translateToString(true); } return t; };
const out = {};
for (const name of ["zz-verifier-trunc", "zz-verifier-lastflip"]) {
  const page = await browser.newPage({ serviceWorkers: "block" });
  const reqs = [], errs = [];
  page.on("request", (r) => reqs.push({ url: r.url(), range: r.headers().range ?? null }));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto("http://127.0.0.1:8123/?testHooks=1&noAutoBoot=1");
  await page.waitForFunction(() => window.__wasmReady?.() === true, null, { timeout: 300000 });
  await page.evaluate((x) => { void window.__bootAlpineChunkedCold(x); }, { wholeImageUrl: `./releases/chunked-alpine/${name}.img.gz`, wholeImageSha256: whole.sha256, wholeImageSize: whole.size });
  await page.waitForFunction(`!!(${TEXT})().match(/cannot boot|boot error|login:/)`, null, { timeout: 900000, polling: 1000 });
  await page.waitForTimeout(5000);
  const screen = (await page.evaluate(`(${TEXT})()`)).split("\n").filter((l) => /whole image|cannot boot|boot error|login:|LocalImage|rror/.test(l));
  out[name] = { screen, wholeReqs: reqs.filter((r) => /\.img\.gz$/.test(new URL(r.url).pathname)).length,
    chunkOrRange: reqs.filter((r) => r.url.includes("/chunked-alpine/chunks/") || r.range !== null).length, total: reqs.length, errs };
  await page.close();
}
await browser.close();
console.log(JSON.stringify(out, null, 2));
