// E4-T40c1: which process and file map the hottest code pages? (the warm snapshot resumes with the same
// mappings every load). argv: base url, page numbers (hex, without the low 12 bits)...
const [base, ...pages] = process.argv.slice(2);
const { chromium } = await import(new URL("../../web/node_modules/playwright/index.mjs", import.meta.url));
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const p = await b.newPage({ serviceWorkers: "block" });
await p.addInitScript(() => window.addEventListener("wvm:desktop-ready", () => { window.__ready = 1; }));
await p.goto(`${base}/app.html?guest=replay-desktop&desktop=1&net=0#ide`);
await p.waitForFunction(() => window.__ready && document.getElementById("omarchy-boot-overlay")?.hidden === true, null, { timeout: 600000 });
await p.waitForTimeout(3000);
const dump = (await p.evaluate((c) => window.wvmDemo.exec(c, 300000, { quiet: true }),
  'for d in /proc/[0-9]*; do echo "== ${d#/proc/} $(cat $d/comm 2>/dev/null)"; cat $d/maps 2>/dev/null; done'))?.stdout ?? "";
let who = "";
const maps = [];
for (const line of dump.split("\n")) {
  if (line.startsWith("== ")) { who = line.slice(3); continue; }
  const m = /^([0-9a-f]+)-([0-9a-f]+) (\S+) (\S+) \S+ \S+\s*(.*)$/.exec(line);
  if (m) maps.push({ who, s: BigInt(`0x${m[1]}`), e: BigInt(`0x${m[2]}`), perm: m[3], off: m[4], file: m[5] });
}
for (const pg of pages) {
  const a = BigInt(`0x${pg}`) << 12n;
  const hits = maps.filter((x) => a >= x.s && a < x.e && x.perm.includes("x")).map((x) => `${x.who} ${x.perm} ${x.file} +0x${(a - x.s + BigInt(`0x${x.off}`)).toString(16)}`);
  console.log(pg, "->", [...new Set(hits)].join(" | ") || "(kernel or unmapped)");
}
await b.close();
