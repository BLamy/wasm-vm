// E0-T30 on PR 626: screenshots of the public pages (dev server 8198), the homepage start reaching
// the real guest, and the architecture model in normal, reduced-motion and no-WebGL modes.
//   node evidence/ui-redesign/public-626/capture.mjs
import fs from "node:fs";
import { chromium } from "../../../web/node_modules/@playwright/test/index.mjs";
const B = "http://127.0.0.1:8198", O = "evidence/ui-redesign/public-626/";
const ROUTES = [["landing.html", "home"], ["case-studies.html", "cases"], ["case-study-riscv-os.html", "case-rv-phone"], ["case-study-ai-sandboxing.html", "case-ai-sandboxing"],
  ["case-study-deterministic-simulation.html", "case-deterministic-simulation"], ["docs.html?page=overview", "docs"], ["roadmap.html", "roadmap"], ["products.html", "products"], ["404.html", "404"]];
const b = await chromium.launch(); const report = { pages: {} };
const errorsOf = (p) => { const e = []; p.on("pageerror", (x) => e.push(x.message)); p.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && e.push(m.text())); p.on("response", (r) => r.status() >= 400 && !r.url().endsWith("favicon.ico") && e.push(`${r.status()} ${r.url()}`)); return e; };
for (const [w, h, phone] of [[1440, 900, false], [1280, 860, false], [390, 844, true], [360, 740, true]]) {
  const c = await b.newContext({ viewport: { width: w, height: h }, isMobile: phone, hasTouch: phone });
  for (const [route, name] of ROUTES) {
    if ((w === 1280 || w === 360) && !["home", "cases", "docs", "roadmap"].includes(name)) continue;
    const p = await c.newPage(); const e = errorsOf(p);
    await p.goto(`${B}/${route}`); await p.waitForTimeout(1300);
    await p.screenshot({ path: `${O}${name}-${w}.png` });
    report.pages[`${name}-${w}`] = { overflow: await p.evaluate(() => document.documentElement.scrollWidth - innerWidth), errors: e };
    await p.close();
  }
  await c.close();
}
{ // homepage start → real BusyBox guest, trusted keys
  const c = await b.newContext({ viewport: { width: 1280, height: 860 } }); await c.tracing.start({ screenshots: true, snapshots: true });
  const p = await c.newPage(); const e = errorsOf(p);
  await p.goto(`${B}/landing.html`); await p.getByRole("link", { name: "Start Linux" }).click();
  await p.waitForFunction(() => window.wvmDemo?.isGuestReady?.(), null, { timeout: 90000 });
  await p.waitForFunction(() => !document.querySelector("#ide-explorer .ide-spin") && document.querySelector("#ide-explorer .ide-node, #ide-explorer .ide-explorer-ph"), null, { timeout: 30000 });
  await p.locator("#term").click(); await p.keyboard.type("printf 'home-%s\\n' 626\n", { delay: 10 });
  let ok = false; for (let i = 0; i < 40 && !ok; i++) { ok = (await p.locator("#term .xterm-rows").evaluate((el) => [...el.children].map((r) => r.textContent.trimEnd()))).includes("home-626"); if (!ok) await p.waitForTimeout(250); }
  await p.screenshot({ path: `${O}home-start-guest-1280.png` }); await c.tracing.stop({ path: "target/e0t30-626/home-start-guest.zip" });
  report.start = { url: p.url(), printed: ok, errors: e }; await c.close();
}
for (const [mode, opts, init] of [["normal", {}, null], ["reduced-motion", { reducedMotion: "reduce" }, null],
  ["no-webgl", {}, () => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...r) { return /webgl/i.test(t) ? null : g.call(this, t, ...r); }; }]]) {
  const c = await b.newContext({ viewport: { width: 1440, height: 900 }, ...opts }); const p = await c.newPage(); const e = errorsOf(p);
  if (init) await p.addInitScript(init);
  await p.goto(`${B}/landing.html`); await p.waitForTimeout(1200);
  await p.getByRole("radiogroup", { name: "Inspect a layer of the machine" }).getByText("Devices", { exact: true }).click(); await p.waitForTimeout(700);
  await p.locator(".home-hero").screenshot({ path: `${O}model-${mode}-1440.png` });
  report[`model-${mode}`] = { motion: await p.locator("#machine-canvas").getAttribute("data-motion"), layer: await p.locator("#machine-canvas").getAttribute("data-selected-layer"), fallback: await p.locator(".model-fallback").isVisible(), caption: (await p.locator("#model-caption").textContent()).trim().slice(0, 60), errors: e };
  await c.close();
}
await b.close();
fs.writeFileSync(O + "capture.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
