// E0-T30 r2: standalone public actions at 390/360 on the source tree (dev server 8198) and the
// built root-swapped web/dist: owned box, ±21.5 px hit band, a real tap at the band's bottom edge.
//   node evidence/ui-redesign/public-626-r2/standalone-targets.mjs
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "../../../web/node_modules/@playwright/test/index.mjs";
const O = "evidence/ui-redesign/public-626-r2/";
const dist = path.resolve("web/dist"); const headers = {};
for (const line of fs.readFileSync(path.join(dist, "_headers"), "utf8").split("\n")) { const m = line.match(/^\s+([\w-]+):\s*(.+)$/); if (m) headers[m[1]] = m[2].trim(); }
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  let f = path.join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname)); if (f.endsWith("/")) f += "index.html";
  if (!f.startsWith(dist) || !fs.existsSync(f)) { res.writeHead(404, headers); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] ?? "application/octet-stream", ...headers }); res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const D = `http://127.0.0.1:${server.address().port}`;
const sets = {
  source: [["http://127.0.0.1:8198/case-study-riscv-os.html", "See the current status →", "case-rv-phone"], ["http://127.0.0.1:8198/landing.html", "All case studies →", "home"], ["http://127.0.0.1:8198/case-studies.html", "Open the live machine →", "cases"]],
  dist: [[`${D}/case-study-riscv-os.html`, "See the current status →", "case-rv-phone"], [`${D}/`, "All case studies →", "home"], [`${D}/case-studies.html`, "Open the live machine →", "cases"]],
};
const b = await chromium.launch(); const report = {};
for (const [where, list] of Object.entries(sets)) for (const width of [390, 360]) {
  const c = await b.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
  await c.tracing.start({ screenshots: true, snapshots: true });
  const p = await c.newPage();
  for (const [url, name, tag] of list) {
    await p.goto(url); const a = p.getByRole("link", { name, exact: true }); await a.scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
    const box = await a.boundingBox();
    const band = await a.evaluate((el) => { const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2; const hit = (dx, dy) => document.elementFromPoint(x + dx, y + dy)?.closest("a") === el; return { top: hit(0, -21.5), bottom: hit(0, 21.5), left: hit(-21.5, 0), right: hit(21.5, 0), display: getComputedStyle(el).display }; });
    if (width === 390) await p.screenshot({ path: `${O}${where}-${tag}-390.png` });
    await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2 + 21.5); await p.waitForTimeout(500);
    report[`${where}-${width}-${tag}`] = { box: { w: Math.round(box.width * 100) / 100, h: Math.round(box.height * 100) / 100 }, band, after: p.url().replace(/^http:\/\/127\.0\.0\.1:\d+/, "") };
  }
  await c.tracing.stop({ path: `target/e0t30-626/r2/standalone-${where}-${width}.zip` }); await c.close();
}
await b.close(); server.close();
fs.writeFileSync(O + "standalone-targets.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
