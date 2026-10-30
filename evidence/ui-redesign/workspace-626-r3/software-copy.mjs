// E0-T29 r3: Desktop settings → Software copy, on the source tree (dev server 8198) and on the
// built root-swapped web/dist served with its _headers.
//   node evidence/ui-redesign/workspace-626-r3/software-copy.mjs
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "../../../web/node_modules/@playwright/test/index.mjs";
const O = "evidence/ui-redesign/workspace-626-r3/";
const dist = path.resolve("web/dist");
const headers = {};
for (const line of fs.readFileSync(path.join(dist, "_headers"), "utf8").split("\n")) { const m = line.match(/^\s+([\w-]+):\s*(.+)$/); if (m) headers[m[1]] = m[2].trim(); }
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const f = path.join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, headers); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] ?? "application/octet-stream", ...headers }); res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const report = {};
const b = await chromium.launch();
for (const [name, url] of [["source", "http://127.0.0.1:8198/index.html?nosw#ide"], ["dist", `http://127.0.0.1:${server.address().port}/app.html?nosw#ide`]]) {
  const c = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await c.tracing.start({ screenshots: true, snapshots: true });
  const p = await c.newPage(); const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(m.text()));
  await p.goto(url);
  await p.waitForFunction(() => document.documentElement.dataset.launcherReady === "true", null, { timeout: 30000 });
  await p.getByRole("button", { name: "Desktop settings" }).click();
  await p.getByRole("radiogroup", { name: "Desktop graphics" }).getByText("Software", { exact: true }).click();
  await p.waitForTimeout(300);
  const help = (await p.locator(".wv-launcher-setting-help").textContent()).trim();
  const native = await p.evaluate(() => { const s = document.getElementById("desktop-graphics"); return { value: s.value, options: [...s.options].map((o) => [o.value, o.textContent.trim()]) }; });
  await p.getByRole("button", { name: "Desktop settings" }).scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${O}${name}-desktop-settings-software.png` });
  await c.tracing.stop({ path: `target/e0t29-626/r3-${name}-software-copy.zip` });
  report[name] = { help, native, worksEverywhere: (await p.locator("#os-launcher").textContent()).includes("works everywhere"), errors };
  await c.close();
}
await b.close(); server.close();
fs.writeFileSync(O + "software-copy.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
