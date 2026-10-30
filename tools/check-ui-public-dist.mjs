// E0-T30: check the built, root-swapped public site in web/dist as it is deployed.
//
//   node tools/check-ui-public-dist.mjs [web/dist]
//
// Serves the directory exactly as built (with the _headers isolation headers), then:
//   - static: every `?rev=` stamp in a page matches the bytes it names; no shipped ui.js or reader
//     chunk still names the source pages (./index.html, ./landing.html);
//   - browser: `/` is the homepage and `/app.html` the machine; every public page loads with no
//     console errors or failed requests (favicon aside), the shared nav mounts, and every same-origin
//     link and asset it references answers 200.
// The large boot artifacts are staged only at deploy time, so no guest boots here; the source-tree
// spec (web/tests/ui-public.spec.js) proves the primary action reaches the real guest.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.resolve(process.argv[2] ?? path.join(repo, "web/dist"));
const { chromium } = createRequire(path.join(repo, "web/package.json"))("playwright");
const failures = [];
const fail = (message) => failures.push(message);
const PAGES = ["/", "/docs.html", "/docs.html?page=quickstart", "/roadmap.html", "/products.html", "/work-market.html", "/security.html", "/404.html",
  "/case-studies.html", "/case-study-riscv-os.html", "/case-study-ai-sandboxing.html", "/case-study-deterministic-simulation.html"];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".md": "text/markdown" };

// 1. Static checks on the shipped bytes.
const sha12 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 12);
const htmlPages = fs.readdirSync(dist).filter((f) => f.endsWith(".html"));
let stamps = 0;
for (const page of htmlPages) {
  const html = fs.readFileSync(path.join(dist, page), "utf8");
  for (const [, ref, rev] of html.matchAll(/["'](\.\/[\w./-]+)\?rev=([0-9a-f]{12})["']/g)) {
    const file = path.join(dist, ref);
    if (!fs.existsSync(file)) fail(`${page}: ${ref} is missing`);
    else if (sha12(file) !== rev) fail(`${page}: ${ref}?rev=${rev} does not match the shipped bytes (${sha12(file)})`);
    stamps += 1;
  }
}
const shippedJs = [path.join(dist, "ui.js"), ...fs.readdirSync(path.join(dist, "docs-bundle"), { recursive: true }).filter((f) => f.endsWith(".js")).map((f) => path.join(dist, "docs-bundle", f))];
for (const file of shippedJs) {
  if (/["']\.\/(?:index|landing)\.html/.test(fs.readFileSync(file, "utf8"))) fail(`${path.relative(dist, file)} still links a source page name`);
}
console.log(`dist: ${stamps} rev stamps across ${htmlPages.length} pages, ${shippedJs.length} shipped scripts scanned`);

// 2. Serve the directory with the deployed headers.
const headers = {};
for (const line of fs.readFileSync(path.join(dist, "_headers"), "utf8").split("\n")) {
  const match = line.match(/^\s+([\w-]+):\s*(.+)$/);
  if (match) headers[match[1]] = match[2].trim();
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let file = path.join(dist, decodeURIComponent(url.pathname));
  if (!file.startsWith(dist)) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) {
    res.writeHead(404, { "content-type": "text/html", ...headers });
    return res.end(fs.readFileSync(path.join(dist, "404.html")));
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", ...headers });
  res.end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// 3. Browser checks.
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const checked = new Set();
async function expectOk(url, from) {
  const key = url.split("#")[0];
  if (checked.has(key)) return;
  checked.add(key);
  const response = await context.request.get(key);
  if (response.status() !== 200) fail(`${from}: ${key.replace(origin, "")} answered ${response.status()}`);
}
for (const route of PAGES) {
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico") && !(route === "/404.html" && r.url().endsWith("/404.html"))) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(origin + route);
  try {
    await page.locator('nav[aria-label="Primary navigation"]').first().waitFor({ timeout: 15_000 });
  } catch {
    fail(`${route}: shared nav did not mount`);
  }
  await page.waitForLoadState("networkidle");
  if (route === "/") {
    const h1 = await page.locator("h1").first().textContent();
    if (h1 !== "Linux in a browser tab.") fail(`/ is not the homepage (h1: ${h1})`);
    const start = await page.getByRole("link", { name: "Start Linux" }).getAttribute("href");
    if (start !== "./app.html?guest=busybox#ide") fail(`/ primary action points at ${start}`);
  }
  const refs = await page.evaluate(() => [
    ...[...document.querySelectorAll("a[href]")].map((a) => a.href),
    ...[...document.querySelectorAll("link[href], script[src], img[src]")].map((el) => el.href || el.src),
  ]);
  for (const ref of refs) if (ref.startsWith(origin)) await expectOk(ref, route);
  for (const e of errors) fail(`${route}: ${e}`);
  await page.close();
}
// The machine sits at /app.html; its launcher mounts without a guest being chosen.
const app = await context.newPage();
await app.goto(`${origin}/app.html#ide`);
try {
  await app.locator('[data-wv-ui="launcher"][data-wv-mounted="true"]').waitFor({ timeout: 20_000 });
} catch {
  fail("/app.html: launcher did not mount");
}
await app.close();

// Pages answers any missing path with 404.html. From a nested path the page must still load its
// root assets, mount its recovery actions, and send every link to the site root.
const NESTED = "/old/docs/missing-topic";
{
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => { if (r.status() >= 400 && r.url() !== origin + NESTED) errors.push(`${r.status()} ${r.url()}`); });
  const response = await page.goto(origin + NESTED);
  if (response.status() !== 404) fail(`${NESTED}: answered ${response.status()}, not the 404 page`);
  try {
    await page.locator('[data-wv-ui="not-found"][data-wv-mounted="true"]').waitFor({ timeout: 15_000 });
    await page.locator('[data-wv-ui="site-nav"][data-wv-mounted="true"] nav[aria-label="Primary navigation"]').waitFor({ timeout: 5_000 });
  } catch {
    fail(`${NESTED}: recovery actions or shared nav did not mount`);
  }
  await page.waitForLoadState("networkidle");
  if ((await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) !== "rgb(21, 20, 16)") fail(`${NESTED}: site styles not applied`);
  const links = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => ({ name: (a.getAttribute("aria-label") || a.textContent).trim(), href: a.href })));
  for (const link of links) {
    if (!link.href.startsWith(origin)) continue;
    if (new URL(link.href).pathname.startsWith("/old/")) fail(`${NESTED}: "${link.name}" resolves under the missing path (${link.href})`);
    await expectOk(link.href, NESTED);
  }
  for (const [name, target] of [["Go to the homepage", "/"], ["Search the docs", "/docs.html"], ["Start Linux", "/app.html?guest=busybox#ide"]]) {
    const href = links.find((l) => l.name === name)?.href;
    if (href !== origin + target) fail(`${NESTED}: "${name}" resolves to ${href}, expected ${target}`);
  }
  // The skip link stays on this page despite the root base.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  if (page.url() !== origin + NESTED || !(await page.evaluate(() => document.activeElement?.id === "main"))) fail(`${NESTED}: skip link left the page or did not focus main`);
  try {
    await page.getByRole("link", { name: "Go to the homepage" }).click({ timeout: 5_000 });
    await page.waitForURL(origin + "/", { timeout: 10_000 });
    if ((await page.locator("h1").first().textContent()) !== "Linux in a browser tab.") throw new Error("wrong page");
  } catch (error) {
    fail(`${NESTED}: homepage action did not reach the homepage (${error.message.split("\n")[0]})`);
  }
  for (const e of errors) fail(`${NESTED}: ${e}`);
  await page.close();
  console.log(`dist: ${NESTED} served the recovery page with ${links.length} root-resolved links`);
}
await browser.close();
server.close();

console.log(`dist: ${PAGES.length} public pages loaded, ${checked.size} same-origin links and assets answered`);
if (failures.length) {
  for (const f of failures) console.error(`dist: FAIL: ${f}`);
  process.exit(1);
}
console.log("dist: PASS");
