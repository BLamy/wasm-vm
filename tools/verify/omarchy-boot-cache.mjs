#!/usr/bin/env node
// Actual built Omarchy + actual CacheStorage. No mocked VM, lifecycle, cache or pixels.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { chromium } from "../../web/node_modules/playwright/index.mjs";

const [destination = "local", directory] = process.argv.slice(2);
assert.ok(directory, "usage: omarchy-boot-cache.mjs local|URL NEW_OUTPUT_DIRECTORY");
const repo = process.cwd();
const out = path.resolve(directory);
await fs.mkdir(out, { recursive: false });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const report = { status: "running", claim: "immutable asset caching and restore status only",
  interactive: false, phases: [], requests: [], errors: [], screenshots: [], sourceHashes: {} };
let phase = "initial", browser, server, page;
const manifest = JSON.parse(await fs.readFile("web/artifacts-omarchy.json", "utf8"));
const assetPaths = new Set(Object.values(manifest.artifacts).map(a => `/${a.url}`));
assetPaths.add(`/${manifest.chunkedImage.key}`);
for (const name of ["loader.js", "ide.js", "boot-asset-cache.js", "omarchy-startup-state.js", "sw.js", "pkg/wasm_vm_wasm_bg.wasm"]) {
  report.sourceHashes[name] = hash(await fs.readFile(path.join("web/dist", name)));
}
try {
  let url = destination;
  if (destination === "local") {
    server = createServer(async (request, response) => {
      try {
        const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
        report.requests.push({ phase, method: request.method, pathname, time: Date.now() });
        const isManifest = pathname === `/${manifest.chunkedImage.key}`;
        const root = pathname.startsWith("/releases/") || isManifest ? repo : path.join(repo, "web/dist");
        const relative = isManifest ? "releases/chunked-omarchy/manifest.json"
          : pathname === "/app" ? "app.html" : pathname.slice(1);
        const file = path.resolve(root, relative);
        assert.ok(file.startsWith(`${root}/`), "path outside served root");
        const info = await fs.stat(file);
        assert.ok(info.isFile(), "not a file");
        const type = { ".js": "text/javascript", ".html": "text/html", ".json": "application/json",
          ".wasm": "application/wasm", ".css": "text/css" }[path.extname(file)] || "application/octet-stream";
        response.writeHead(200, { "Content-Type": type, "Content-Length": info.size,
          "Cache-Control": "no-store", "Cross-Origin-Opener-Policy": "same-origin",
          "Cross-Origin-Embedder-Policy": "require-corp" });
        createReadStream(file).pipe(response);
      } catch { response.writeHead(404).end("not found"); }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    url = `${origin}/app?guest=omarchy&desktop=1&omarchyAssetBase=${encodeURIComponent(origin)}#ide`;
  }
  report.url = url;
  browser = await chromium.launch({ headless: true,
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "allow" });
  await context.addInitScript(() => {
    window.__cacheProof = [];
    for (const type of ["wvm:guest-progress", "wvm:guest-state", "wvm:desktop-ready", "wvm:guest-error"]) {
      window.addEventListener(type, event => window.__cacheProof.push({ type, detail: event.detail, time: Date.now() }));
    }
  });
  page = await context.newPage();
  page.on("pageerror", error => report.errors.push(String(error)));
  page.on("console", message => {
    if (message.type() === "error" && !/favicon\.ico/.test(message.location().url || "")) report.errors.push(message.text());
  });
  context.on("request", request => {
    if (destination !== "local") report.requests.push({ phase, method: request.method(), url: request.url(), time: Date.now() });
  });
  for (phase of ["initial", "reload"]) {
    const startedAt = Date.now();
    if (phase === "initial") await page.goto(url);
    else await page.reload();
    await page.waitForFunction(() => window.__cacheProof?.some(e => e.type === "wvm:guest-error"
      || (e.type === "wvm:guest-state" && e.detail?.state === "restored")), null, { timeout: 240_000 });
    assert.deepEqual(await page.evaluate(() => window.__cacheProof.filter(e => e.type === "wvm:guest-error")), [], "guest restore failed");
    const restoredMs = Date.now() - startedAt;
    await page.screenshot({ path: path.join(out, `${phase}-restored.png`) });
    await page.waitForFunction(() => window.__cacheProof?.some(e => e.type === "wvm:desktop-ready"
      || e.type === "wvm:guest-error"), null, { timeout: 300_000 });
    assert.deepEqual(await page.evaluate(() => window.__cacheProof.filter(e => e.type === "wvm:guest-error")), [], "guest desktop failed");
    const data = await page.evaluate(async () => ({ events: window.__cacheProof,
      progressHidden: document.querySelector("#omarchy-boot-progress")?.hidden,
      status: document.querySelector("#omarchy-desktop-status")?.textContent,
      overlayHidden: document.querySelector("#omarchy-boot-overlay")?.hidden,
      display: window.__presentation?.state(), caches: await caches.keys(),
      entries: await Promise.all((await caches.keys()).filter(k => k === "wasm-vm-boot-assets-v1")
        .map(async k => ({ name: k, keys: (await (await caches.open(k)).keys()).map(r => r.url) }))),
    }));
    assert.equal(data.overlayHidden, true);
    assert.equal(data.progressHidden, true, "completed download bar must be cleared");
    assert.ok(data.display?.successfulPresents > 0, "real guest frame missing");
    assert.deepEqual(data.display.errors, []);
    const phases = data.events.filter(e => e.type === "wvm:guest-progress").map(e => e.detail?.phase);
    for (const role of ["kernel", "chunkManifest", "overlayDelta", "bootSnapshot"]) {
      assert.ok(phases.includes(`${role}: ${phase === "initial" ? "downloading" : "reading cache"}`), `${phase}: ${role} cache provenance missing`);
    }
    assert.ok(data.entries[0]?.keys.length >= 4, "persistent boot entries missing");
    if (destination === "local") {
      for (const pathname of assetPaths) {
        const n = report.requests.filter(r => r.phase === phase && r.pathname === pathname).length;
        assert.equal(n, phase === "initial" ? 1 : 0, `${phase}: network requests for ${pathname}`);
      }
    } else if (phase === "reload") {
      // Warm cache must not request any immutable release artifact, independently
      // of whether the browser HTTP cache would have fulfilled such a request.
      const loads = report.requests.filter(r => r.phase === phase &&
        (/\/sha256\//.test(r.url) || /omarchy-(ready\.snap|overlay-delta\.bin)\.gz/.test(r.url)
          || /\/chunked-omarchy\/manifest-/.test(r.url)));
      assert.deepEqual(loads, [], "reload attempted immutable artifact fetches");
    }
    const name = `${phase}-desktop.png`;
    await page.screenshot({ path: path.join(out, name) });
    report.screenshots.push({ name, sha256: hash(await fs.readFile(path.join(out, name))) });
    report.phases.push({ phase, restoredMs, readyMs: Date.now() - startedAt, ...data });
    console.log(JSON.stringify({ phase, restoredMs, readyMs: Date.now() - startedAt, entries: data.entries }));
  }
  assert.deepEqual(report.errors, []);
  report.status = "passed";
} catch (error) {
  report.status = "failed"; report.errors.push(error.stack || String(error)); process.exitCode = 1;
  if (page) await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
} finally {
  await fs.writeFile(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await browser?.close();
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
