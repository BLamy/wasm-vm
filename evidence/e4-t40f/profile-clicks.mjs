// Profile the whole-machine worker (named wasm build) while clicking Chrome's "Run again" on the
// Replay desktop: CDP Profiler on the worker target, self time aggregated by function.
// argv: base url, out dir, clicks (default 8), query (default "&net=0")
import fs from "node:fs";
const [base, out, clicksArg, query = "&net=0"] = process.argv.slice(2);
const CLICKS = Number(clicksArg ?? 8);
fs.mkdirSync(out, { recursive: true });
const { chromium } = await import(new URL("../../web/node_modules/playwright/index.mjs", import.meta.url));
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const page = await b.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
const cdp = await page.context().newCDPSession(page);
const workers = new Map(); let seq = 0; const pending = new Map();
cdp.on("Target.attachedToTarget", (e) => { workers.set(e.sessionId, e.targetInfo); });
cdp.on("Target.receivedMessageFromTarget", (e) => {
  const m = JSON.parse(e.message); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (sessionId, method, params = {}) => new Promise((res) => {
  const id = ++seq; pending.set(id, res);
  cdp.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method, params }) });
});
await cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: false });
await page.addInitScript(() => window.addEventListener("wvm:desktop-ready", () => { window.__ready = 1; }));
await page.goto(`${base}/app.html?guest=replay-desktop&desktop=1${query}#ide`);
await page.waitForFunction(() => window.__ready && document.getElementById("omarchy-boot-overlay")?.hidden === true, null, { timeout: 600000 });
await page.waitForTimeout(5000);
const list = [...workers.entries()].map(([s, t]) => ({ s, type: t.type, url: t.url }));
console.log(JSON.stringify(list));
const target = list.find((w) => /linux-worker/.test(w.url)) ?? list[0];
await send(target.s, "Profiler.enable");
await send(target.s, "Profiler.setSamplingInterval", { interval: 100 });
const box = await page.locator("#ide-display-canvas").boundingBox();
const at = (x, y) => [box.x + box.width * (x / 1280), box.y + box.height * (y / 800)];
await send(target.s, "Profiler.start");
const t0 = Date.now();
for (let i = 0; i < CLICKS; i++) { await page.mouse.click(...at(93, 516)); await page.waitForTimeout(1500); }
const wall = Date.now() - t0;
const { result } = await send(target.s, "Profiler.stop");
fs.writeFileSync(`${out}/clicks.cpuprofile`, JSON.stringify(result.profile));
const p = result.profile; const byId = new Map(p.nodes.map((n) => [n.id, n]));
const self = new Map(); const dt = p.timeDeltas; let total = 0;
for (let i = 0; i < p.samples.length; i++) {
  const n = byId.get(p.samples[i]); const name = n.callFrame.functionName || `(${n.callFrame.url.split("/").pop()})`;
  const d = dt[i] ?? 0; total += d; self.set(name, (self.get(name) ?? 0) + d);
}
const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 45).map(([n, us]) => `${(100 * us / total).toFixed(1).padStart(5)}%  ${(us / 1000).toFixed(0).padStart(6)} ms  ${n.slice(0, 140)}`);
fs.writeFileSync(`${out}/top.txt`, `wall ${wall} ms, sampled ${(total / 1000).toFixed(0)} ms\n` + top.join("\n") + "\n");
console.log(`wall ${wall} ms, sampled ${(total / 1000).toFixed(0)} ms`); console.log(top.join("\n"));
await b.close();
