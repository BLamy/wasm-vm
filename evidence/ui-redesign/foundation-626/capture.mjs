// E0-T28 on the PR 626 stack: screenshots of the source tree (dev server on 8198) and a browser
// check of the built, root-swapped web/dist served with its _headers.
//   node evidence/ui-redesign/foundation-626/capture.mjs
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "../../../web/node_modules/@playwright/test/index.mjs";
const OUT = "evidence/ui-redesign/foundation-626/";
const SRC = "http://127.0.0.1:8198";
const report = { source: {}, dist: {} };
const b = await chromium.launch();
const ctx = (w, h, phone) => b.newContext({ viewport: { width: w, height: h }, isMobile: phone, hasTouch: phone });
const shot = (p, name) => p.screenshot({ path: OUT + name });

for (const [w, h, phone] of [[1440, 900, false], [1280, 860, false], [390, 844, true]]) {
  const c = await ctx(w, h, phone); const p = await c.newPage();
  const errors = []; p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(m.text()));
  await p.goto(`${SRC}/index.html?nosw#ide`); await p.locator('body > header [data-wv-mounted="true"]').waitFor(); await p.waitForTimeout(1200);
  await shot(p, `app-${w}.png`);
  report.source[`app-${w}`] = await p.evaluate(() => ({
    headerBg: getComputedStyle(document.querySelector("body > header")).backgroundColor,
    badgeDisplay: getComputedStyle(document.getElementById("audio-autoplay-badge")).display,
    badgeState: document.getElementById("audio-autoplay-badge").dataset.audioState ?? null,
    navLinks: [...document.querySelectorAll('body > header nav[aria-label="Primary navigation"] a')].filter((a) => a.getClientRects().length).map((a) => [a.textContent.trim(), a.getAttribute("href"), a.target || null]),
    overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  if (phone) {
    await p.getByRole("button", { name: "Open menu" }).tap(); await p.waitForTimeout(700);
    await shot(p, "app-390-menu.png");
    const sheet = p.getByRole("dialog", { name: "Site menu" });
    report.source["app-390-menu"] = await sheet.evaluate((el) => [...el.querySelectorAll("a.wv-row-link")].slice(0, 6).map((a) => [a.textContent.trim(), a.getAttribute("href"), a.target || null]));
    await sheet.getByRole("link", { name: "Open the machine" }).tap(); await p.waitForTimeout(500);
    report.source["app-390-current-machine"] = { url: p.url(), sheetOpen: await sheet.count() };
  }
  report.source[`app-${w}`].errors = errors;
  await c.close();
}
{
  const c = await ctx(1280, 860, false); const p = await c.newPage();
  await p.goto(`${SRC}/ui-kit.html`); await p.locator('html[data-wv-ui="kit"]').waitFor(); await p.waitForTimeout(600);
  await shot(p, "kit-1280.png");
  await p.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Case studies", exact: true }).click();
  await p.waitForURL(/case-studies\.html$/); await p.waitForTimeout(600);
  await shot(p, "case-studies-from-nav-1280.png");
  report.source.caseStudies = { url: p.url(), h1: (await p.locator("h1").first().textContent()).trim() };
  await c.close();
}

// Built dist, served as deployed.
const dist = path.resolve("web/dist");
const headers = {};
for (const line of fs.readFileSync(path.join(dist, "_headers"), "utf8").split("\n")) { const m = line.match(/^\s+([\w-]+):\s*(.+)$/); if (m) headers[m[1]] = m[2].trim(); }
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  let f = path.join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!f.startsWith(dist) || !fs.existsSync(f)) { res.writeHead(404, headers); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] ?? "application/octet-stream", ...headers }); res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const D = `http://127.0.0.1:${server.address().port}`;
for (const [w, h, phone] of [[1280, 860, false], [390, 844, true]]) {
  const c = await ctx(w, h, phone); const p = await c.newPage();
  const errors = []; p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(m.text()));
  p.on("response", (r) => r.status() >= 400 && !r.url().endsWith("favicon.ico") && !r.url().includes("/releases/") && errors.push(`${r.status()} ${r.url()}`));
  await p.goto(`${D}/app.html#ide`); await p.locator('body > header [data-wv-mounted="true"]').waitFor(); await p.waitForTimeout(1500);
  let links;
  if (phone) { await p.getByRole("button", { name: "Open menu" }).tap(); await p.waitForTimeout(600); links = await p.getByRole("dialog", { name: "Site menu" }).evaluate((el) => [...el.querySelectorAll("a.wv-row-link")].slice(0, 6).map((a) => [a.textContent.trim(), a.getAttribute("href"), a.target || null])); await shot(p, "dist-app-390-menu.png"); }
  else { links = await p.evaluate(() => [...document.querySelectorAll('body > header nav[aria-label="Primary navigation"] a')].filter((a) => a.getClientRects().length).map((a) => [a.textContent.trim(), a.getAttribute("href"), a.target || null])); await shot(p, "dist-app-1280.png"); }
  const answers = {};
  for (const href of ["/", "/docs.html", "/roadmap.html", "/case-studies.html", "/case-study-ai-sandboxing.html", "/case-study-deterministic-simulation.html", "/case-study-riscv-os.html", "/ui-kit.html"]) answers[href] = (await p.request.get(D + href)).status();
  report.dist[`app-${w}`] = { links, answers, headerBg: await p.evaluate(() => getComputedStyle(document.querySelector("body > header")).backgroundColor), badgeDisplay: await p.evaluate(() => getComputedStyle(document.getElementById("audio-autoplay-badge")).display), errors };
  await c.close();
}
server.close();
await b.close();
fs.writeFileSync(OUT + "capture.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
