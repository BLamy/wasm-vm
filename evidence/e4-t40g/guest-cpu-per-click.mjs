// Which guest processes spend a click's instructions? Per-process utime+stime (clock ticks, USER_HZ
// 100) and the kernel's softirq/system totals, before and after N clicks on Chrome's "Run again".
import fs from "node:fs";
const [base, outFile, n = "8"] = process.argv.slice(2);
const { chromium } = await import(new URL("../../web/node_modules/playwright/index.mjs", import.meta.url));
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
await p.addInitScript(() => window.addEventListener("wvm:desktop-ready", () => { window.__ready = 1; }));
await p.goto(`${base}/app.html?guest=replay-desktop&desktop=1&net=0#ide`);
await p.waitForFunction(() => window.__ready && document.getElementById("omarchy-boot-overlay")?.hidden === true, null, { timeout: 600000 });
await p.waitForTimeout(4000);
const snap = async () => (await p.evaluate(() => window.wvmDemo.exec("for d in /proc/[0-9]*; do s=$(cat $d/stat 2>/dev/null) || continue; echo \"$s\"; done; head -1 /proc/stat", 120000, { quiet: true })))?.stdout ?? "";
const parse = (t) => { const m = new Map(); let cpu = null;
  for (const line of t.split("\n")) {
    if (line.startsWith("cpu ")) { cpu = line.split(/\s+/).slice(1).map(Number); continue; }
    const r = /^(\d+) \((.*)\) \S+ (.*)$/.exec(line); if (!r) continue;
    const f = r[3].split(" "); // fields from ppid (index 0 = field 4)
    m.set(r[1], { comm: r[2], ticks: Number(f[10]) + Number(f[11]) }); }
  return { m, cpu }; };
const a = parse(await snap());
const box = await p.locator("#ide-display-canvas").boundingBox();
for (let i = 0; i < Number(n); i++) { await p.mouse.click(box.x + box.width * 93 / 1280, box.y + box.height * 516 / 800); await p.waitForTimeout(2000); }
const z = parse(await snap());
const rows = [];
for (const [pid, v] of z.m) { const d = v.ticks - (a.m.get(pid)?.ticks ?? 0); if (d > 0) rows.push({ pid, comm: v.comm, ticks: d }); }
rows.sort((x, y) => y.ticks - x.ticks);
const cpuNames = ["user", "nice", "system", "idle", "iowait", "irq", "softirq"];
const cpu = Object.fromEntries(cpuNames.map((k, i) => [k, z.cpu[i] - a.cpu[i]]));
const out = { clicks: Number(n), cpu, rows };
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(JSON.stringify(cpu)); for (const r of rows.slice(0, 15)) console.log(r.ticks, r.pid, r.comm);
await b.close();
