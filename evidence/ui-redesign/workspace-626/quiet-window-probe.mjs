// E0-T29 explanation probe (no product change): PR 626's ide.js runs a quiet fenced `ls -la /root`
// (loadTree → bgExec → guestExec {quiet:true}) on the first wvm:guest-ready. While it is in flight
// main.js sets quietGuestExec and does not write guest output to xterm. Keys typed in that window
// still reach the shell; only their echo/output is not shown. This probe types during the window
// (checked by the explorer's .ide-spin placeholder), shows the visible line never appears, then
// after the listing completes reads back the file the hidden command wrote, with trusted keys.
//   node evidence/ui-redesign/workspace-626/quiet-window-probe.mjs <base-url> <out-dir>
import fs from "node:fs";
import { chromium } from "../../../web/node_modules/@playwright/test/index.mjs";
const [, , base, out] = process.argv;
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await c.tracing.start({ screenshots: true, snapshots: true });
const p = await c.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(m.text()));
const rows = () => p.locator("#term .xterm-rows").evaluate((el) => [...el.children].map((r) => r.textContent.trimEnd()));
await p.goto(`${base}/index.html?nosw&testHooks&noAutoBoot#ide`);
await p.waitForFunction(() => document.documentElement.dataset.launcherReady === "true");
await p.locator('.os-option[data-os="busybox"]').tap();
await p.waitForFunction(() => window.wvmDemo?.isGuestReady?.(), null, { timeout: 90000 });
const listingAtReady = await p.evaluate(() => Boolean(document.querySelector("#ide-explorer .ide-spin")));
await p.locator("#term").tap();
const listingAtType = await p.evaluate(() => Boolean(document.querySelector("#ide-explorer .ide-spin")));
await p.keyboard.type("printf 'q-%s\\n' hidden > /tmp/q.txt; printf 'quiet-%s\\n' 626\n");
const listingAfterType = await p.evaluate(() => Boolean(document.querySelector("#ide-explorer .ide-spin")));
await p.waitForFunction(() => document.querySelector("#ide-explorer .ide-node") && !document.querySelector("#ide-explorer .ide-spin"), null, { timeout: 30000 });
await p.waitForTimeout(1500);
const visibleQuiet = (await rows()).includes("quiet-626");
await p.locator("#term").tap();
await p.keyboard.type("cat /tmp/q.txt\n", { delay: 12 });
let readBack = false;
for (let i = 0; i < 40 && !readBack; i++) { readBack = (await rows()).includes("q-hidden"); if (!readBack) await p.waitForTimeout(250); }
await p.screenshot({ path: `${out}/quiet-window-probe.png` });
await c.tracing.stop({ path: `${out}/quiet-window-probe.zip` });
const report = { listingAtReady, listingAtType, listingAfterType, visibleQuietLine: visibleQuiet, hiddenCommandRanAndReadBack: readBack, errors };
fs.writeFileSync(`${out}/quiet-window-probe.json`, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
await b.close();
