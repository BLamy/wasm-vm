// E5-T43i probe: the guest Node's build configuration (code cache, snapshot) over the serial shell.
const [base] = process.argv.slice(2);
const { chromium } = await import(new URL("../../web/node_modules/playwright/index.mjs", import.meta.url));
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const p = await b.newPage({ serviceWorkers: "block" });
await p.addInitScript(() => window.addEventListener("wvm:desktop-ready", () => { window.__ready = 1; }));
await p.goto(`${base}/app.html?guest=replay-desktop&desktop=1&net=0#ide`);
await p.waitForFunction(() => window.__ready && document.getElementById("omarchy-boot-overlay")?.hidden === true, null, { timeout: 600000 });
await p.waitForTimeout(3000);
const r = await p.evaluate(() => window.wvmDemo.exec(`/opt/replay-node-26/bin/node -p 'const v=process.config.variables; JSON.stringify({code_cache:v.node_use_node_code_cache, snapshot:v.node_use_node_snapshot, v8_lite:v.v8_enable_lite_mode, jitless: process.execArgv, pointer_compression:v.v8_enable_pointer_compression, sparkplug:v.v8_enable_sparkplug, maglev:v.v8_enable_maglev, turbofan:v.v8_enable_turbofan})'; /opt/replay-node-26/bin/node --v8-options | grep -iE "^  --(sparkplug|maglev|turbofan|jitless|lazy) " | head`, 120000, { quiet: true }));
console.log(r?.stdout);
await b.close();
