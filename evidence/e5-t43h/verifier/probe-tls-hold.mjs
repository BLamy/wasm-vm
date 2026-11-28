// E5-T43h verifier probe (independent input): a raw TLS socket held open by `tls.connect` (no HTTP),
// 30 s idle windows without/with it, then a guest `sleep 20` measured against the host clock while
// the connection is open (slow-relay timeout attack: a guest timer must not fire before real time).
// argv: base url, out file.
import fs from "node:fs";
const [base, outFile] = process.argv.slice(2);
const { chromium } = await import(new URL("../../../web/node_modules/playwright/index.mjs", import.meta.url));
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.addInitScript(() => window.addEventListener("wvm:desktop-ready", () => { window.__ready = 1; }));
await p.goto(`${base}/app.html?guest=replay-desktop&desktop=1#ide`);
await p.waitForFunction(() => window.__ready && document.getElementById("omarchy-boot-overlay")?.hidden === true, null, { timeout: 600000 });
await p.waitForTimeout(5000);
const exec = (cmd) => p.evaluate((c) => window.wvmDemo.exec(c, 120000, { quiet: true }), cmd);
const snap = () => p.evaluate(async () => {
  const s = await window.__schedulerStats?.(); const c = await window.__linuxCtl?.guestClockState?.();
  return { at: performance.now(), sliceMs: s?.totalSliceMs, idleSleeps: s?.idleSleeps, idleSleepMs: s?.idleSleepMs,
    guestS: Number(BigInt(c.mtime) / 1000n) / (c.timebaseHz / 1000) };
});
const window30 = async () => { const a = await snap(); await p.waitForTimeout(30000); const z = await snap();
  return { inSlicePct: +(100 * (z.sliceMs - a.sliceMs) / (z.at - a.at)).toFixed(1),
    guestSecondsPerSecond: +((z.guestS - a.guestS) / ((z.at - a.at) / 1000)).toFixed(3),
    idleSleeps: (z.idleSleeps ?? 0) - (a.idleSleeps ?? 0),
    meanSleepMs: z.idleSleeps - a.idleSleeps ? +((z.idleSleepMs - a.idleSleepMs) / (z.idleSleeps - a.idleSleeps)).toFixed(2) : null }; };
const established = async () => (await exec("cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | awk '$4==\"01\"' | wc -l"))?.stdout?.trim();
const out = { base, noConnection: await window30() };
const HOLD = process.env.HOLD_CMD || "(node -e \"require('tls').connect(443,'example.com',{servername:'example.com'},()=>{}).on('error',()=>{}); setInterval(()=>{},1e9)\" >/dev/null 2>&1 &) ; sleep 1";
out.hold = HOLD;
await exec(HOLD);
for (let i = 0; i < 36; i++) {
  await p.waitForTimeout(5000);
  out.tcpBefore = await established();
  if (out.tcpBefore !== "0" && out.tcpBefore) break;
}
const t0 = Date.now();
const r = await exec("a=$(cat /proc/uptime); sleep 20; b=$(cat /proc/uptime); echo \"$a|$b\"");
out.sleep20HostMs = Date.now() - t0;
out.sleep20GuestUptime = r?.stdout?.trim();
out.tcpAfterSleep = await established();
out.openConnection = await window30();
out.tcpAfterWindow = await established();
out.pageErrors = errors;
console.log(JSON.stringify(out));
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
await b.close();
