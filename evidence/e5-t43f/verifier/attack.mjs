#!/usr/bin/env node
// E5-T43f verifier's own attacks (not the worker's script).
//   node evidence/e5-t43f/verifier/attack.mjs OUTDIR mode...
// modes: saved-config garbage-json not-json http-503 net0-all sw-tokens
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const base = "http://127.0.0.1:8125";
const out = path.resolve(process.argv[2]);
const modes = process.argv.slice(3);
fs.mkdirSync(out, { recursive: true });
const RELAY = "wasm-vm-relay.brett-lamy.workers.dev";
const log = (...a) => console.log(`[verifier ${new Date().toISOString()}]`, ...a);
const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });

async function load(query, { context = null, init = null, route = null, serviceWorkers = "block" } = {}) {
  const page = context ? await context.newPage() : await browser.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers });
  if (route) await page.route(`https://${RELAY}/token`, route);
  if (init) await page.addInitScript(init);
  const t0 = Date.now();
  const s = { page, requests: [], sockets: [], consoleErrors: [], tokenBodies: [] };
  page.on("request", (r) => s.requests.push({ t: Date.now() - t0, url: r.url() }));
  page.on("response", async (r) => {
    const u = new URL(r.url());
    if (u.host === RELAY && u.pathname === "/token") {
      let body = null; try { body = await r.text(); } catch {}
      s.tokenBodies.push({ status: r.status(), fromServiceWorker: r.fromServiceWorker(), body });
    }
  });
  page.on("websocket", (ws) => s.sockets.push({ t: Date.now() - t0, url: ws.url() }));
  page.on("console", (m) => { if (m.type() === "error" && !(m.location().url ?? "").endsWith("/favicon.ico") && !m.text().includes("favicon")) s.consoleErrors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => s.consoleErrors.push(String(e)));
  await page.addInitScript(() => window.addEventListener("wvm:desktop-ready", () => { window.__vReady = performance.now(); }));
  await page.goto(`${base}/app.html?guest=replay-desktop&desktop=1${query}#ide`);
  await page.waitForFunction(() => window.__vReady !== undefined && document.getElementById("omarchy-boot-overlay")?.hidden === true, null, { timeout: 20 * 60_000, polling: 250 });
  s.readyMs = Date.now() - t0;
  return s;
}
const net = (page) => page.evaluate(() => ({ state: window.__replayDesktopNetwork?.state ?? null, reason: window.__replayDesktopNetwork?.reason ?? null,
  dataset: document.documentElement.dataset.replayNetwork ?? null, banner: document.getElementById("replay-network-off")?.textContent ?? null }));
const hosts = (s) => [...new Set(s.requests.map((r) => new URL(r.url).host))];
const results = {};

async function failClosed(name, route) {
  const s = await load("", { route });
  await s.page.waitForTimeout(5000);
  const r = { network: await net(s.page), sockets: s.sockets, tokenBodies: s.tokenBodies, hosts: hosts(s), consoleErrors: s.consoleErrors, readyMs: s.readyMs };
  r.chromeTitle = (await s.page.evaluate(() => window.wvmDemo.exec("SWAYSOCK=$(ls /run/user/1000/sway-ipc.*.sock) swaymsg -t get_tree | grep -o '\"name\": \"[^\"]*Chromium\"' | head -n 3", 60000, { quiet: true })))?.stdout?.trim();
  await s.page.screenshot({ path: path.join(out, `${name}.png`) });
  r.pass = r.network.state === "off" && /^Network off: /u.test(r.network.banner ?? "") && r.sockets.length === 0;
  await s.page.click("#replay-network-off").catch((e) => { r.clickError = String(e); });
  r.bannerAfterClick = await s.page.evaluate(() => Boolean(document.getElementById("replay-network-off")));
  results[name] = r; await s.page.close();
}
const cors = { "access-control-allow-origin": "*" };
const run = {
  "garbage-json": () => failClosed("garbage-json", (rt) => rt.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ token: "v1.bogus", ws: "ws://127.0.0.1:9/ws" }) })),
  "not-json": () => failClosed("not-json", (rt) => rt.fulfill({ status: 200, headers: { ...cors, "content-type": "text/html" }, body: "<html>hello</html>" })),
  "http-503": () => failClosed("http-503", (rt) => rt.fulfill({ status: 503, headers: cors, body: "down" })),
  "token-timeout": () => failClosed("token-timeout", () => { /* never answer: the page's 8 s AbortSignal must fire */ }),
  async "net0-all"() {
    const s = await load("&net=0");
    await s.page.waitForTimeout(20000);
    const h = hosts(s);
    results["net0-all"] = { network: await net(s.page), hosts: h, sockets: s.sockets, consoleErrors: s.consoleErrors,
      pass: !h.includes(RELAY) && !h.includes("cloudflare-dns.com") && s.sockets.length === 0 };
    await s.page.close();
  },
  async "saved-config"() {
    // A user who saved a different network setup on this origin (the IDE's network panel).
    const s = await load("", { init: () => {
      if (!sessionStorage.getItem("__vSeeded")) {
        localStorage.setItem("wasm-vm.network-config.v1", JSON.stringify({ provider: "relay", websocketUrl: "wss://evil-ws.invalid/ws",
          relayUrl: "wss://evil-relay.invalid/ws", controlUrl: "https://evil-control.invalid", hostname: "x", exitNodeId: "", acceptDns: false }));
        sessionStorage.setItem("__vSeeded", "1");
      }
    } });
    await s.page.waitForTimeout(10000);
    const token = (() => { try { return JSON.parse(s.tokenBodies[0]?.body ?? "{}").token ?? null; } catch { return null; } })();
    const stores = await s.page.evaluate(async () => {
      const dump = (st) => Object.fromEntries(Object.keys(st).map((k) => [k, st.getItem(k)]));
      const cacheUrls = [];
      try { for (const k of await caches.keys()) for (const req of await (await caches.open(k)).keys()) cacheUrls.push(req.url); } catch {}
      let idb = []; try { idb = (await indexedDB.databases()).map((d) => d.name); } catch {}
      const inputs = [...document.querySelectorAll("input,select,textarea")].map((e) => [e.id, e.value]);
      return { local: dump(localStorage), session: dump(sessionStorage), cacheUrls, idb, inputs, html: document.documentElement.outerHTML.length };
    });
    const haystack = JSON.stringify(stores);
    const guestNet = (await s.page.evaluate(() => window.wvmDemo.exec("wget -q -T 120 -O - http://example.com 2>&1 | grep -o 'Example Domain' | head -n 1", 300000, { quiet: true })))?.stdout?.trim();
    results["saved-config"] = { network: await net(s.page), sockets: s.sockets, hosts: hosts(s), tokenSeen: Boolean(token),
      tokenInStores: token ? haystack.includes(token) : null, tokenIdInStores: token ? haystack.includes(token.split(".").slice(0, 3).join(".")) : null,
      localStorageKeys: Object.keys(stores.local), networkConfig: stores.local["wasm-vm.network-config.v1"] ?? null,
      inputsWithValues: stores.inputs.filter(([, v]) => v), idb: stores.idb, cacheUrlCount: stores.cacheUrls.length, guestWget: guestNet, consoleErrors: s.consoleErrors };
    const r = results["saved-config"];
    r.pass = r.network.state === "online" && r.sockets.length === 1 && r.sockets[0].url === `wss://${RELAY}/ws`
      && !r.hosts.some((h) => h.includes("evil")) && r.tokenInStores === false && r.guestWget === "Example Domain";
    await s.page.screenshot({ path: path.join(out, "saved-config.png") });
    await s.page.close();
  },
  async "sw-tokens"() {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "allow" });
    const loads = [];
    for (let i = 0; i < 2; i++) {
      const s = await load("", { context });
      await s.page.waitForTimeout(3000);
      loads.push({ controlled: await s.page.evaluate(() => Boolean(navigator.serviceWorker?.controller)),
        tokens: s.tokenBodies.map((b) => ({ status: b.status, fromServiceWorker: b.fromServiceWorker, token: (() => { try { return JSON.parse(b.body).token; } catch { return null; } })() })) });
      await s.page.close();
    }
    await context.close();
    const toks = loads.flatMap((l) => l.tokens.map((t) => t.token));
    results["sw-tokens"] = { loads: loads.map((l) => ({ controlled: l.controlled, tokens: l.tokens.map((t) => ({ ...t, token: t.token ? `${t.token.slice(0, 12)}…(${t.token.length})` : null })) })),
      distinct: new Set(toks).size === toks.length && toks.length === 2,
      pass: loads[1].controlled && toks.length === 2 && new Set(toks).size === 2 && loads.every((l) => l.tokens.every((t) => t.status === 200 && !t.fromServiceWorker)) };
  },
};
for (const m of modes) {
  try { await run[m](); log(m, results[m]?.pass ? "PASS" : "FAIL", JSON.stringify(results[m]).slice(0, 600)); }
  catch (e) { results[m] = { error: String(e?.stack ?? e) }; log(m, "ERROR", e?.stack ?? e); }
  fs.writeFileSync(path.join(out, "attack.json"), JSON.stringify(results, null, 2) + "\n");
}
await browser.close();
