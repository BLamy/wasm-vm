#!/usr/bin/env node
// E5-T43a round-5 verifier, LIVE: what a real browser WebSocket sees at the 30-minute idle limit.
// Headless Chromium (web/node_modules/playwright) on a page at an allowed dev origin (http://127.0.0.1:8125, a 404 path so
// nothing boots). The page fetches /token itself (CORS), opens wss://…/ws, sends HELLO + OPEN example.com:80, gets
// OPEN_OK, then sends nothing. Two sessions: B1 with an open stream (like round-4 idle4 "A"), B2 HELLO only (like "D").
// Logs every message and the close event (code, wasClean, time since last frame sent). Runs ~33 min. 2 WebSockets.
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../../web/package.json", import.meta.url));
const { chromium } = require("playwright");
const BASE = "https://wasm-vm-relay.brett-lamy.workers.dev";
const ORIGIN = process.env.PAGE_ORIGIN || "http://127.0.0.1:8125";
const out = { startedAt: new Date().toISOString(), base: BASE, pageOrigin: ORIGIN };
const save = () => writeFileSync(new URL("./browser-idle.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-mac-arm64/chrome-headless-shell` });
const page = await browser.newPage();
const consoleErrors = []; page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
await page.goto(`${ORIGIN}/__e5_t43a_verifier_blank`, { waitUntil: "domcontentloaded" }).catch((e) => (out.gotoErr = String(e)));
out.browserVersion = browser.version();
out.setup = await page.evaluate(async (BASE) => {
  const t0 = Date.now(); const at = () => Math.round((Date.now() - t0) / 100) / 10;
  const frame = (id, op, payload = new Uint8Array()) => { const b = new Uint8Array(5 + payload.length); new DataView(b.buffer).setUint32(0, id); b[4] = op; b.set(payload, 5); return b; };
  const hostPort = (h, port) => { const e = new TextEncoder().encode(h); const p = new Uint8Array(1 + e.length + 2); p[0] = e.length; p.set(e, 1); new DataView(p.buffer).setUint16(1 + e.length, port); return p; };
  window.__log = { t0, sessions: {} };
  async function open(name, withStream) {
    const r = await fetch(`${BASE}/token`); const j = await r.json();
    const s = { name, tokenStatus: r.status, events: [], lastSentAtS: null, close: null };
    window.__log.sessions[name] = s;
    const ws = new WebSocket(j.ws); ws.binaryType = "arraybuffer";
    await new Promise((res) => {
      ws.onopen = () => { s.events.push({ ev: "open", atS: at() }); ws.send(frame(0, 0, new Uint8Array([1, ...new TextEncoder().encode(j.token)]))); s.lastSentAtS = at();
        if (withStream) { ws.send(frame(1, 1, hostPort("example.com", 80))); s.lastSentAtS = at(); } setTimeout(res, 3000); };
      ws.onmessage = (m) => { const b = new Uint8Array(m.data); s.events.push({ ev: "msg", id: new DataView(b.buffer).getUint32(0), op: b[4], atS: at() }); };
      ws.onclose = (e) => { s.close = { code: e.code, reason: e.reason, wasClean: e.wasClean, atS: at(), idleS: Math.round((at() - s.lastSentAtS) * 10) / 10 }; res(); };
      ws.onerror = () => s.events.push({ ev: "error", atS: at() });
    });
    return { name, tokenStatus: r.status, events: s.events.slice() };
  }
  return [await open("B1_with_stream", true), await open("B2_hello_only", false)];
}, BASE);
save();
const T = Date.now();
while (Date.now() - T < 33 * 60 * 1000) {
  await new Promise((r) => setTimeout(r, 60000));
  out.progress = await page.evaluate(() => window.__log); out.progressAtMin = Math.round((Date.now() - T) / 6000) / 10; save();
  if (Object.values(out.progress.sessions).every((s) => s.close)) break;
}
out.final = await page.evaluate(() => window.__log);
out.consoleErrors = consoleErrors; out.finishedAt = new Date().toISOString(); save();
await page.screenshot({ path: new URL("./browser-idle.png", import.meta.url).pathname }).catch(() => {});
await browser.close();
console.log(JSON.stringify(Object.values(out.final.sessions).map((s) => ({ name: s.name, close: s.close }))));
