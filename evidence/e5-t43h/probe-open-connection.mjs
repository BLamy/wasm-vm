// E5-T43h probe: worker time in run slices and guest seconds per real second on the online desktop,
// 30 s with no connection, then 30 s while a background `https.get` holds a socket open and the
// guest is otherwise idle (argv: base url, out file).
import fs from "node:fs";
const [base, outFile] = process.argv.slice(2);
const { chromium } = await import(new URL("../../web/node_modules/playwright/index.mjs", import.meta.url));
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
await p.addInitScript(() => window.addEventListener("wvm:desktop-ready", () => { window.__ready = 1; }));
await p.goto(`${base}/app.html?guest=replay-desktop&desktop=1#ide`);
await p.waitForFunction(() => window.__ready && document.getElementById("omarchy-boot-overlay")?.hidden === true, null, { timeout: 600000 });
await p.waitForTimeout(5000);
const snap = () => p.evaluate(async () => {
  const s = await window.__schedulerStats?.(); const c = await window.__linuxCtl?.guestClockState?.();
  return { at: performance.now(), sliceMs: s?.totalSliceMs, guestS: Number(BigInt(c.mtime) / 1000n) / (c.timebaseHz / 1000) };
});
const window30 = async () => { const a = await snap(); await p.waitForTimeout(30000); const z = await snap();
  return { inSlicePct: +(100 * (z.sliceMs - a.sliceMs) / (z.at - a.at)).toFixed(1), guestSecondsPerSecond: +((z.guestS - a.guestS) / ((z.at - a.at) / 1000)).toFixed(2) }; };
const out = { base, noConnection: await window30() };
await p.evaluate(() => window.wvmDemo.exec("(node -e \"require('https').get('https://example.com',()=>{})\" >/dev/null 2>&1 &) ; sleep 1", 60000, { quiet: true }));
// Wait (up to 3 min) until the connection is established.
for (let i = 0; i < 36; i++) {
  await p.waitForTimeout(5000);
  out.tcp = (await p.evaluate(() => window.wvmDemo.exec("awk 'FNR>1 && $4==\"01\"' /proc/net/tcp | wc -l", 60000, { quiet: true })))?.stdout?.trim();
  if (out.tcp === "1") break;
}
out.openConnection = await window30();
console.log(JSON.stringify(out));
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
await b.close();
