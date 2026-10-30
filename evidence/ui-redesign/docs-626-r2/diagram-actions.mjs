// E0-T32 r2: Docstream diagram actions on phones, source tree (dev server 8198) and built web/dist:
// owned 44 px band, a real touch at the band's edge for Copy (clipboard holds the Mermaid source)
// and Open in Playground (a new tab to pele.run; that request is blocked, only its URL recorded),
// keyboard Enter on Copy, and the corrected quickstart terminal sentence.
//   node evidence/ui-redesign/docs-626-r2/diagram-actions.mjs
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "../../../web/node_modules/@playwright/test/index.mjs";
const O = "evidence/ui-redesign/docs-626-r2/";
const dist = path.resolve("web/dist"); const headers = {};
for (const line of fs.readFileSync(path.join(dist, "_headers"), "utf8").split("\n")) { const m = line.match(/^\s+([\w-]+):\s*(.+)$/); if (m) headers[m[1]] = m[2].trim(); }
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".md": "text/markdown", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff" };
const server = http.createServer((req, res) => {
  let f = path.join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname)); if (f.endsWith("/")) f += "index.html";
  if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, headers); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] ?? "application/octet-stream", ...headers }); res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const bases = { source: "http://127.0.0.1:8198", dist: `http://127.0.0.1:${server.address().port}` };
const b = await chromium.launch(); const report = {};
for (const [where, base] of Object.entries(bases)) for (const width of [390, 360]) {
  const c = await b.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, permissions: ["clipboard-read", "clipboard-write"] });
  const pele = [];
  await c.route("https://pele.run/**", (route) => { pele.push(route.request().url()); return route.abort(); });
  await c.tracing.start({ screenshots: true, snapshots: true });
  const p = await c.newPage(); const errors = [];
  p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(m.text()));
  await p.goto(`${base}/docs.html?page=time-travel`);
  const diagram = p.locator(".docs-mermaid-preview"); await diagram.locator(".docs-mermaid svg").waitFor({ timeout: 15000 });
  const copy = diagram.getByRole("button", { name: "Copy Mermaid source" }); const play = diagram.getByRole("link", { name: "Open in Playground" });
  const r = { errors };
  for (const [name, el] of [["copy", copy], ["playground", play]]) {
    await el.scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
    const box = await el.boundingBox();
    r[name] = { box: { w: Math.round(box.width * 100) / 100, h: Math.round(box.height * 100) / 100 } };
    r[name].band = await el.evaluate((node) => { const q = node.getBoundingClientRect(), x = q.x + q.width / 2, y = q.y + q.height / 2; const hit = (dx, dy) => { const t = document.elementFromPoint(x + dx, y + dy); return Boolean(t && (t === node || node.contains(t))); }; return { top: hit(0, -21.5), bottom: hit(0, 21.5), left: hit(-21.5, 0), right: hit(21.5, 0) }; });
  }
  if (where === "source" && width === 390) await diagram.screenshot({ path: `${O}diagram-actions-390.png` });
  // Copy: a real touch at the band's right edge (a fresh context's clipboard is empty).
  const cb = await copy.boundingBox(); await p.touchscreen.tap(cb.x + cb.width / 2 + 21.5, cb.y + cb.height / 2); await p.waitForTimeout(400);
  const clip = await p.evaluate(() => navigator.clipboard.readText()); r.copy.touchClipboard = clip.startsWith("flowchart LR") && clip.includes("Open replay");
  // Copy by keyboard: clear the clipboard (the page has focus after the touch), Tab to it, Enter.
  await p.evaluate(() => navigator.clipboard.writeText(""));
  r.copy.clearedBeforeKeyboard = (await p.evaluate(() => navigator.clipboard.readText())) === "";
  for (let i = 0; i < 60 && !(await copy.evaluate((el) => el === document.activeElement)); i++) await p.keyboard.press("Tab");
  r.copy.keyboardFocused = await copy.evaluate((el) => el === document.activeElement);
  await p.keyboard.press("Enter"); await p.waitForTimeout(300);
  r.copy.keyboardClipboard = (await p.evaluate(() => navigator.clipboard.readText())).startsWith("flowchart LR");
  // Playground: a real touch at the band's bottom edge opens the link in a new tab.
  const pb = await play.boundingBox();
  const [popup] = await Promise.all([c.waitForEvent("page", { timeout: 10000 }), p.touchscreen.tap(pb.x + pb.width / 2, pb.y + pb.height / 2 + 21.5)]);
  await p.waitForTimeout(300);
  const requested = pele.at(-1) ?? "";
  r.playground.requested = requested.split("#")[0];
  // A request never carries the URL fragment; the link's own href holds the diagram source.
  const href = await play.getAttribute("href");
  r.playground.hrefCarriesSource = href.startsWith("https://pele.run/playground#") && new URLSearchParams(href.split("#")[1]).get("source").startsWith("flowchart LR");
  r.playground.target = await play.getAttribute("target");
  r.playground.newTab = popup !== p;
  await popup.close();
  // Quickstart: the corrected sentence.
  await p.goto(`${base}/docs.html?page=quickstart`); await p.locator(".reader-document h1").waitFor();
  const text = await p.locator(".reader-document").textContent();
  r.quickstart = { hostStatusLine: text.includes("The host can also print its own status or error lines"), oldClaim: text.includes("everything after them comes from the guest") };
  if (width === 390) { await p.getByText("The host can also print its own status").scrollIntoViewIfNeeded(); await p.screenshot({ path: `${O}${where}-quickstart-terminal-390.png` }); }
  r.overflow = await p.evaluate((w) => Math.max(document.documentElement.scrollWidth, innerWidth) - w, width);
  await c.tracing.stop({ path: `target/e0t32-626-r2/diagram-actions-${where}-${width}.zip` });
  report[`${where}-${width}`] = r; await c.close();
}
await b.close(); server.close();
fs.writeFileSync(O + "diagram-actions.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
