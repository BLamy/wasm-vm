// E4-T40c1: the 64-byte regions sampled inside one hot page during 8 clicks (argv: base url, page hex).
const [base, pg] = process.argv.slice(2);
const { chromium } = await import(new URL("../../web/node_modules/playwright/index.mjs", import.meta.url));
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
await p.addInitScript(() => window.addEventListener("wvm:desktop-ready", () => { window.__ready = 1; }));
await p.goto(`${base}/app.html?guest=replay-desktop&desktop=1&net=0&profile=1#ide`);
await p.waitForFunction(() => window.__ready && document.getElementById("omarchy-boot-overlay")?.hidden === true, null, { timeout: 1200000 });
await p.waitForTimeout(4000);
const prof = async () => new Map(((await p.evaluate(() => window.__linuxCtl.profileStats(1000000)))?.regions ?? []).map((r) => [r.pc, r.samples]));
const a = await prof();
const box = await p.locator("#ide-display-canvas").boundingBox();
for (let i = 0; i < 8; i++) { await p.mouse.click(box.x + box.width * 93 / 1280, box.y + box.height * 516 / 800); await p.waitForTimeout(2500); }
const z = await prof();
const base12 = BigInt(`0x${pg}`) << 12n;
const rows = [];
for (const [pc, s] of z.m ?? z) {
  const d = s - (a.get(pc) ?? 0); const v = BigInt(pc);
  if (d > 0 && v >= base12 && v < base12 + 4096n) rows.push([`+0x${(v - base12).toString(16)}`, d]);
}
rows.sort((x, y) => y[1] - x[1]);
console.log(JSON.stringify(rows.slice(0, 20)));
await b.close();
