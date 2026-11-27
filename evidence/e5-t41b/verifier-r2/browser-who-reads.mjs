// E5-T41b round-2 verifier: which guest process reads the root disk in the first 30 s after a
// warm resume. Dumps every process's /proc/<pid>/io read_bytes (storage reads) at desktop-ready
// and every 10 s for 30 s, over the serial shell; prints the processes whose count changed.
//   node browser-who-reads.mjs <base-url> <app> <out.json>
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
  "head -c 40 /sys/block/vda/stat; echo; for p in /proc/[0-9]*; do r=$(grep '^read_bytes' $p/io 2>/dev/null); echo \"${p#/proc/} $(cat $p/comm 2>/dev/null) ${r#read_bytes: }\"; done; cut -d' ' -f1 /proc/uptime",
  600000, { quiet: true })))?.stdout ?? "";
const snaps = [];
for (let i = 0; i <= 3; i++) { if (i) await page.waitForTimeout(10000); snaps.push({ at: i * 10, text: await dump() }); }
const parse = (t) => Object.fromEntries(t.split("\n").map((l) => l.trim().split(/\s+/u)).filter((f) => f.length === 3 && /^\d+$/u.test(f[0])).map(([pid, comm, rb]) => [pid, { comm, rb: Number(rb) }]));
const first = parse(snaps[0].text), last = parse(snaps.at(-1).text);
const changed = Object.entries(last).filter(([pid, v]) => (first[pid]?.rb ?? 0) !== v.rb).map(([pid, v]) => ({ pid, comm: v.comm, readKiB: (v.rb - (first[pid]?.rb ?? 0)) / 1024, new: !first[pid] }));
fs.writeFileSync(out, JSON.stringify({ snaps, changed }, null, 2) + "\n");
console.log("vda stat:", snaps.map((s) => s.text.split("\n")[0].trim()).join(" | "));
console.log("uptime:", snaps.map((s) => s.text.trim().split("\n").at(-1)).join(" | "));
console.log("CHANGED", JSON.stringify(changed));
await browser.close();
