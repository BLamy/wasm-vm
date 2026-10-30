// E0-T32: docs reader screenshots on the source tree (dev server 8198) at desktop and phone widths.
//   node evidence/ui-redesign/docs-626/capture.mjs
import fs from "node:fs";
import { chromium } from "../../../web/node_modules/@playwright/test/index.mjs";
const B = "http://127.0.0.1:8198", O = "evidence/ui-redesign/docs-626/";
const b = await chromium.launch(); const report = {};
const errorsOf = (p) => { const e = []; p.on("pageerror", (x) => e.push(x.message)); p.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && e.push(m.text())); p.on("response", (r) => r.status() >= 400 && !r.url().endsWith("favicon.ico") && e.push(`${r.status()} ${r.url()}`)); return e; };
const strict = (p, w) => p.evaluate((w) => Math.max(document.documentElement.scrollWidth, innerWidth) - w, w);
for (const [w, h, phone] of [[1440, 900, false], [1280, 860, false], [390, 844, true], [360, 740, true]]) {
  const c = await b.newContext({ viewport: { width: w, height: h }, isMobile: phone, hasTouch: phone });
  const p = await c.newPage(); const e = errorsOf(p); const r = {};
  await p.goto(`${B}/docs.html?page=quickstart`); await p.waitForTimeout(1800);
  await p.screenshot({ path: `${O}quickstart-${w}.png` }); r.quickstartOverflow = await strict(p, w);
  if (phone) await p.locator('[data-wv="docs-menu"]').tap();
  await p.getByRole("searchbox", { name: "Search documentation" }).fill("seek transition"); await p.waitForTimeout(1500);
  await p.screenshot({ path: `${O}search-${w}.png` });
  const first = p.locator('[data-wv="docs-result"]').first(); r.firstResult = await first.getAttribute("href");
  if (phone) await first.tap(); else await first.click();
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${O}landed-${w}.png` });
  r.landed = await p.evaluate(() => [location.search + location.hash, document.activeElement?.id, Math.round(document.activeElement?.getBoundingClientRect().top ?? -1)]);
  r.landedOverflow = await strict(p, w);
  if (w === 1440 || w === 390) {
    await p.goto(`${B}/docs.html?page=time-travel`); await p.waitForTimeout(2500);
    await p.locator(".docs-mermaid-preview").scrollIntoViewIfNeeded(); await p.waitForTimeout(400);
    await p.screenshot({ path: `${O}time-travel-diagram-${w}.png` });
    await p.goto(`${B}/docs.html?page=current-docs-design-session-format`); await p.waitForTimeout(1500);
    await p.screenshot({ path: `${O}current-reference-${w}.png` });
    r.currentProvenance = (await p.locator(".reader-provenance").textContent()).trim();
  }
  r.errors = e; report[w] = r; await c.close();
}
await b.close();
fs.writeFileSync(O + "capture.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
