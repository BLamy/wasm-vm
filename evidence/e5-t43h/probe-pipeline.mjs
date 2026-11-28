// E5-T43h probe: the typed command's pipeline (node fetch | tee -a events) run over the serial
// shell: host time until the command returns and until its line reaches the console via the monitor.
import fs from "node:fs";
const [base, outFile] = process.argv.slice(2);
const { chromium } = await import(new URL("../../web/node_modules/playwright/index.mjs", import.meta.url));
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
await p.addInitScript(() => {
  window.__s = "";
  const attach = () => { if (!window.wvmDemo?.onConsole) return setTimeout(attach, 20); const d = new TextDecoder(); window.wvmDemo.onConsole((u) => { window.__s += d.decode(u, { stream: true }); }); };
  attach(); window.addEventListener("wvm:desktop-ready", () => { window.__ready = 1; });
});
await p.goto(`${base}/app.html?guest=replay-desktop&desktop=1#ide`);
await p.waitForFunction(() => window.__ready && document.getElementById("omarchy-boot-overlay")?.hidden === true, null, { timeout: 600000 });
await p.waitForTimeout(3000);
const out = [];
for (let i = 0; i < 3; i++) {
  const tag = `PIPE${i}_${Date.now() % 100000}`;
  const t0 = Date.now();
  const r = await p.evaluate((c) => window.wvmDemo.exec(c, 600000, { quiet: true }),
    `node -e "fetch('https://example.com').then(r=>console.log('${tag}', r.status))" | tee -a /run/replay-desktop/events`);
  const returned = Date.now() - t0;
  await p.waitForFunction((t) => window.__s.includes(t + " "), tag, { timeout: 120000, polling: 100 });
  out.push({ tag, returnedMs: returned, onConsoleMs: Date.now() - t0, stdout: r?.stdout?.trim() });
  console.log(JSON.stringify(out.at(-1)));
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
await b.close();
