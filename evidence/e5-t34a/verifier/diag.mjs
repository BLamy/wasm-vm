import fs from "node:fs";
import { pathToFileURL } from "node:url";
const repo = "/Users/blamy/Documents/Codex/wasm-vm", OUT = process.argv[2];
const whole = JSON.parse(fs.readFileSync(repo + "/releases/chunked-alpine/alpine-rootfs.img.gz.json", "utf8"));
const { chromium } = await import(pathToFileURL(repo + "/web/node_modules/playwright/index.mjs"));
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const TEXT = () => { const b = window.__term.term.buffer.active; let t = ""; for (let i = 0; i < b.length; i++) { const l = b.getLine(i); if (l) t += (i && !l.isWrapped ? "\n" : "") + l.translateToString(true); } return t; };
for (const mode of process.argv.slice(3)) {
  const page = await browser.newPage({ serviceWorkers: "block" });
  const reqs = [], errs = [];
  page.on("request", (r) => reqs.push({ url: r.url(), range: r.headers().range ?? null }));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("favicon")) errs.push(m.text()); });
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto("http://127.0.0.1:8123/?testHooks=1&noAutoBoot=1");
  await page.waitForFunction(() => window.__wasmReady?.() === true, null, { timeout: 600000 });
  const extra = mode === "prefill" ? { wholeImageUrl: "./releases/chunked-alpine/alpine-rootfs.img.gz", wholeImageSha256: whole.sha256, wholeImageSize: whole.size } : {};
  const t0 = Date.now(); const progress = []; let ok = false;
  await page.evaluate((x) => { void window.__bootAlpineChunkedCold(x); }, extra);
  while (Date.now() - t0 < 45 * 60000) {
    await page.waitForTimeout(60000);
    const txt = await page.evaluate(`(${TEXT})()`);
    const lines = txt.split("\n").filter((l) => l.trim());
    let st = null; try { st = await page.evaluate(() => window.__chunkedStats?.()); } catch {}
    progress.push({ s: Math.round((Date.now() - t0) / 1000), last: lines.at(-1)?.slice(0, 100), fetches: st?.fetches, localHits: st?.localHits });
    fs.writeFileSync(`${OUT}/${mode}-progress.json`, JSON.stringify(progress, null, 1));
    if (/login:/.test(txt) || /cannot boot|boot error/.test(txt)) { ok = /login:/.test(txt); break; }
  }
  const loginS = Math.round((Date.now() - t0) / 1000);
  let marker = null;
  if (ok) {
    const type = (s) => page.evaluate((x) => window.__term.typeBytes(new TextEncoder().encode(x)), s);
    await type("root\r"); await page.waitForTimeout(3000); await type("\r"); await page.waitForTimeout(2000);
    await type("echo PREFILL_$((6*7))_OK\r");
    try { await page.waitForFunction(`(${TEXT})().includes("PREFILL_42_OK")`, null, { timeout: 600000, polling: 1000 }); marker = "PREFILL_42_OK"; } catch {}
  }
  const st = await page.evaluate(() => window.__chunkedStats?.()).catch(() => null);
  const txt = await page.evaluate(`(${TEXT})()`);
  fs.writeFileSync(`${OUT}/${mode}-serial.log`, txt);
  const res = { mode, loginS, ok, marker, whole: reqs.filter((r) => /\.img\.gz$/.test(new URL(r.url).pathname)).length,
    chunkOrRange: reqs.filter((r) => r.url.includes("/chunked-alpine/chunks/") || r.range !== null).length, total: reqs.length,
    stats: st && { localImage: st.localImage, localHits: st.localHits, localBytes: st.localBytes, fetches: st.fetches, bytes: st.bytes, error: st.error }, errs };
  fs.writeFileSync(`${OUT}/${mode}-result.json`, JSON.stringify(res, null, 1));
  console.log(JSON.stringify(res));
  await page.close();
}
await browser.close();
