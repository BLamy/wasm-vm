// E5-T41b round-3 verifier: which guest process takes major page faults (file reads) in the first
// 30 s after a warm resume, untouched. /proc/<pid>/io is not available in this kernel (round 2's
// who-reads.json has no read_bytes), so this dumps majflt (field 12 of /proc/<pid>/stat, counted
// after the last ')') for every process at desktop-ready and every 10 s for 30 s.
//   node browser-who-faults.mjs <base-url> <app> <out.json>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const [base, app, out] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
await page.addInitScript(() => { window.addEventListener("wvm:desktop-ready", () => { window.__ready = performance.now(); }); });
await page.goto(`${base.replace(/\/+$/u, "")}${app}?guest=replay-desktop&desktop=1#ide`);
await page.waitForFunction(() => window.__ready !== undefined && document.getElementById("omarchy-boot-overlay")?.hidden === true, null, { timeout: 30 * 60_000, polling: 250 });
const dump = async () => (await page.evaluate(() => window.wvmDemo.exec(
  "head -c 40 /sys/block/vda/stat; echo; for p in /proc/[0-9]*; do s=$(cat $p/stat 2>/dev/null) || continue; r=${s##*) }; set -- $r; echo \"${p#/proc/} $(cat $p/comm 2>/dev/null | tr ' ' _) ${10}\"; done; cut -d' ' -f1 /proc/uptime",
  600000, { quiet: true })))?.stdout ?? "";
const snaps = [];
for (let i = 0; i <= 3; i++) { if (i) await page.waitForTimeout(10000); snaps.push({ at: i * 10, text: await dump() }); }
const parse = (t) => Object.fromEntries(t.split("\n").map((l) => l.trim().split(/\s+/u)).filter((f) => f.length === 3 && /^\d+$/u.test(f[0]) && /^\d+$/u.test(f[2])).map(([pid, comm, mf]) => [pid, { comm, majflt: Number(mf) }]));
const all = snaps.map((s) => parse(s.text));
const changed = Object.entries(all.at(-1)).filter(([pid, v]) => (all[0][pid]?.majflt ?? 0) !== v.majflt).map(([pid, v]) => ({ pid, comm: v.comm, majfltDelta: v.majflt - (all[0][pid]?.majflt ?? 0), perStep: all.map((a) => a[pid]?.majflt ?? null), new: !all[0][pid] }));
fs.writeFileSync(out, JSON.stringify({ parsedProcesses: Object.keys(all[0]).length, snaps, changed }, null, 2) + "\n");
console.log("parsed processes:", Object.keys(all[0]).length);
console.log("vda stat:", snaps.map((s) => s.text.split("\n")[0].trim()).join(" | "));
console.log("uptime:", snaps.map((s) => s.text.trim().split("\n").at(-1)).join(" | "));
console.log("CHANGED", JSON.stringify(changed));
await browser.close();
