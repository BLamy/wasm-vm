#!/usr/bin/env node
// E5-T43f: the Replay desktop page with networking on through the public relay.
//
//   E5_T43F_URL=http://127.0.0.1:8125 E5_T43F_APP=/app.html E5_T43F_OUT=DIR \
//     node tools/verify/e5-t43f-replay-desktop-online.mjs online off relay-down sw
//
// online      the page gets a relay token and opens the relay WebSocket; in the guest's Chrome a
//             typed https://example.com loads (sway's window title becomes "Example Domain"), and in
//             the Node terminal a typed `node -e` fetch of https://example.com prints 200. Both go
//             through the DOM keyboard/pointer only; the serial root shell (window.wvmDemo.exec) is
//             used only to READ the window title and the guest's address.
// off         `?net=0`: no request to the relay at all, no WebSocket; the desktop still runs.
// relay-down  the relay's /token is refused (aborted by the test): the desktop runs offline and the
//             page shows that the network is off.
// sw          with the service worker allowed, two loads each fetch /token from the network (never a
//             service-worker response) and get different tokens.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const base = (process.env.E5_T43F_URL || "http://127.0.0.1:8125").replace(/\/+$/u, "");
const app = process.env.E5_T43F_APP ?? "/app.html";
const out = path.resolve(process.env.E5_T43F_OUT || path.join(repo, "evidence/e5-t43f/local"));
const RELAY_HOST = "wasm-vm-relay.brett-lamy.workers.dev";
const modes = process.argv.slice(2).length ? process.argv.slice(2) : ["online", "off", "relay-down", "sw"];
fs.mkdirSync(out, { recursive: true });
const save = (name, data) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 2) + "\n");
const log = (...a) => console.log(`[e5-t43f ${new Date().toISOString()}]`, ...a);

const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({
  executablePath: process.env.E5_T43F_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});

const SHIFTED = { '"': "Quote", "(": "Digit9", ")": "Digit0", "_": "Minus", "|": "Backslash", ":": "Semicolon", ">": "Period" };
const PLAIN = { "'": "Quote", "-": "Minus", ".": "Period", "/": "Slash", " ": "Space", ",": "Comma", "=": "Equal", ";": "Semicolon" };
async function typeText(page, text) {
  for (const ch of text) {
    let code, shift = false;
    if (/[a-z]/u.test(ch)) code = `Key${ch.toUpperCase()}`;
    else if (/[A-Z]/u.test(ch)) { code = `Key${ch}`; shift = true; }
    else if (/[0-9]/u.test(ch)) code = `Digit${ch}`;
    else if (PLAIN[ch]) code = PLAIN[ch];
    else if (SHIFTED[ch]) { code = SHIFTED[ch]; shift = true; }
    else throw new Error(`no key mapping for ${JSON.stringify(ch)}`);
    if (shift) await page.keyboard.down("Shift");
    await page.keyboard.press(code, { delay: 40 });
    if (shift) await page.keyboard.up("Shift");
    await page.waitForTimeout(120);
  }
}

async function openPage(query, { routes = async () => {}, serviceWorkers = "block", context = null } = {}) {
  const page = context ? await context.newPage()
    : await browser.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers });
  await routes(page);
  const t0 = Date.now();
  const requests = [], sockets = [], consoleErrors = [], consoleLog = [];
  page.on("request", (r) => requests.push({ t: Date.now() - t0, method: r.method(), url: r.url() }));
  page.on("response", (r) => {
    const e = requests.find((q) => q.url === r.url() && q.status === undefined);
    if (e) { e.status = r.status(); e.fromServiceWorker = r.fromServiceWorker(); }
  });
  page.on("requestfailed", (r) => {
    const e = requests.find((q) => q.url === r.url() && q.status === undefined);
    if (e) e.failure = r.failure()?.errorText ?? "failed";
  });
  page.on("websocket", (ws) => sockets.push({ t: Date.now() - t0, url: ws.url() }));
  page.on("worker", (worker) => worker.on("console", () => {}));
  page.on("console", (m) => {
    const e = { t: Date.now() - t0, type: m.type(), text: m.text().slice(0, 1000), url: m.location().url ?? "" };
    consoleLog.push(e);
    // The page has no favicon; its 404 is the one expected console error (as in E5-T34e).
    if (e.type === "error" && !e.text.includes("favicon.ico") && !e.url.endsWith("/favicon.ico")) consoleErrors.push(e.text);
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  await page.addInitScript(() => {
    window.__e5t43fSerial = "";
    const attach = () => {
      if (!window.wvmDemo?.onConsole) return setTimeout(attach, 20);
      const dec = new TextDecoder();
      window.wvmDemo.onConsole((u8) => { window.__e5t43fSerial += dec.decode(u8, { stream: true }); });
    };
    attach();
    window.addEventListener("wvm:desktop-ready", () => { window.__e5t43fReadyAt = performance.now(); });
  });
  const url = `${base}${app}?guest=replay-desktop&desktop=1${query}#ide`;
  log("open", url);
  await page.goto(url);
  await page.waitForFunction(() => window.__e5t43fReadyAt !== undefined
    && document.getElementById("omarchy-boot-overlay")?.hidden === true, null, { timeout: 30 * 60_000, polling: 250 });
  log("desktop ready", Date.now() - t0, "ms");
  return { page, t0, requests, sockets, consoleErrors, consoleLog };
}
const exec = (page, cmd, timeout = 600000) => page.evaluate(([c, t]) => window.wvmDemo.exec(c, t, { quiet: true }), [cmd, timeout]);
const relayRequests = (s) => s.requests.filter((r) => new URL(r.url).host === RELAY_HOST);
const network = (page) => page.evaluate(() => ({ state: window.__replayDesktopNetwork?.state ?? null,
  reason: window.__replayDesktopNetwork?.reason ?? null, dataset: document.documentElement.dataset.replayNetwork ?? null,
  banner: document.getElementById("replay-network-off")?.textContent ?? null }));
const swayTitle = async (page) => (await exec(page,
  "SWAYSOCK=$(ls /run/user/1000/sway-ipc.*.sock) swaymsg -t get_tree | grep -o '\"name\": \"[^\"]*Chromium\"' | head -n 3"))?.stdout ?? "";

async function online() {
  const dir = path.join(out, "online"); fs.mkdirSync(dir, { recursive: true });
  const s = await openPage("");
  const { page } = s;
  const result = { network: await network(page) };
  assert.equal(result.network.state, "online", `network state: ${JSON.stringify(result.network)}`);
  const token = relayRequests(s).find((r) => new URL(r.url).pathname === "/token");
  assert.ok(token && token.status === 200 && token.fromServiceWorker === false, `a /token request answered 200 from the network: ${JSON.stringify(token)}`);
  assert.ok(s.sockets.some((w) => w.url === `wss://${RELAY_HOST}/ws`), `the relay WebSocket opened: ${JSON.stringify(s.sockets)}`);
  result.guestAddress = (await exec(page, "ip -4 -o addr show dev eth0 | awk '{print $4}'; ip -4 route | grep default"))?.stdout;
  const box = await page.locator("#ide-display-canvas").boundingBox();
  const at = (x, y) => [box.x + box.width * (x / 1280), box.y + box.height * (y / 800)];
  // Chrome: focus its window, select the address bar, type the URL.
  await page.mouse.click(...at(400, 300));
  await page.waitForTimeout(1500);
  await page.keyboard.down("Control"); await page.keyboard.press("KeyL", { delay: 40 }); await page.keyboard.up("Control");
  await page.waitForTimeout(1500);
  const chromeStart = Date.now();
  await typeText(page, "https://example.com");
  await page.keyboard.press("Enter", { delay: 40 });
  log("typed the URL into the guest's Chrome");
  let title = "";
  for (let i = 0; i < 60 && !/Example Domain/u.test(title); i++) {
    await page.waitForTimeout(5000);
    title = await swayTitle(page);
  }
  result.chromeTitle = title.trim();
  result.chromeLoadMs = Date.now() - chromeStart;
  await page.waitForTimeout(8000); // the title changes before the page is painted
  await page.screenshot({ path: path.join(dir, "chrome-example.png") });
  assert.match(title, /"name": "Example Domain - Chromium"/u, `sway's window title: ${title}`);
  log("Chrome loaded example.com in", result.chromeLoadMs, "ms");
  // Node: focus the terminal, type a fetch.
  await page.mouse.click(...at(1050, 400));
  await page.waitForTimeout(2000);
  const nonce = randomBytes(4).toString("hex").toUpperCase();
  const command = `node -e "fetch('https://example.com').then(r=>console.log('E5T43F_${nonce}', r.status))" | tee -a /run/replay-desktop/events`;
  const nodeStart = Date.now();
  await typeText(page, command);
  await page.keyboard.press("Enter", { delay: 40 });
  await page.waitForFunction((re) => new RegExp(re).test(window.__e5t43fSerial), `E5T43F_${nonce} \\d+`, { timeout: 10 * 60_000, polling: 1000 });
  const serial = await page.evaluate(() => window.__e5t43fSerial);
  result.nodeLine = new RegExp(`E5T43F_${nonce} \\d+`, "u").exec(serial)[0];
  result.nodeAnswerAfterTypingMs = Date.now() - nodeStart;
  await page.screenshot({ path: path.join(dir, "node-fetch.png") });
  assert.equal(result.nodeLine, `E5T43F_${nonce} 200`);
  log("node fetch:", result.nodeLine);
  result.relayRequests = relayRequests(s);
  result.sockets = s.sockets;
  result.consoleErrors = s.consoleErrors;
  assert.deepEqual(s.consoleErrors, [], "no console errors");
  fs.writeFileSync(path.join(dir, "serial.log"), serial);
  save("online.json", result);
  await page.close();
}

async function off() {
  const s = await openPage("&net=0");
  await s.page.waitForTimeout(15000);
  const result = { network: await network(s.page), relayRequests: relayRequests(s), sockets: s.sockets,
    consoleErrors: s.consoleErrors };
  result.eth0 = (await exec(s.page, "ip -4 -o addr show dev eth0 | awk '{print $4}'"))?.stdout;
  save("off.json", result);
  assert.equal(result.network.state, "disabled");
  assert.equal(result.network.banner, null, "no warning for the user's own choice");
  assert.deepEqual(result.relayRequests, [], "no request to the relay");
  assert.deepEqual(result.sockets, [], "no WebSocket");
  assert.deepEqual(s.consoleErrors, []);
  await s.page.close();
}

async function relayDown() {
  const s = await openPage("", { routes: (page) => page.route(`https://${RELAY_HOST}/token`, (r) => r.abort("connectionrefused")) });
  const result = { network: await network(s.page), relayRequests: relayRequests(s), sockets: s.sockets };
  await s.page.screenshot({ path: path.join(out, "relay-down.png") });
  result.chromeTitle = (await swayTitle(s.page)).trim();
  save("relay-down.json", result);
  assert.equal(result.network.state, "off");
  assert.match(result.network.banner ?? "", /^Network off: /u, "the page says the network is off");
  assert.deepEqual(result.sockets, [], "no WebSocket without a token");
  assert.match(result.chromeTitle, /Replay RISC-V PASS/u, "the desktop runs");
  await s.page.close();
}

async function sw() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "allow" });
  const tokens = [];
  const loads = [];
  for (let i = 0; i < 2; i++) {
    const s = await openPage("", { context });
    const t = relayRequests(s).filter((r) => new URL(r.url).pathname === "/token");
    loads.push({ token: t, controlled: await s.page.evaluate(() => Boolean(navigator.serviceWorker?.controller)) });
    tokens.push(...t);
    await s.page.close();
  }
  save("sw.json", { loads });
  assert.ok(loads[1].controlled, "the second load is controlled by the service worker");
  assert.equal(tokens.length, 2, "one /token request per load");
  assert.ok(tokens.every((r) => r.status === 200 && r.fromServiceWorker === false), "every /token answer came from the network");
  await context.close();
}

const run = { online, off, "relay-down": relayDown, sw };
let failed = false;
for (const m of modes) {
  try { await run[m](); log(m, "PASS"); }
  catch (e) { failed = true; log(m, "FAIL", e?.stack ?? e); }
}
await browser.close();
process.exit(failed ? 1 : 0);
