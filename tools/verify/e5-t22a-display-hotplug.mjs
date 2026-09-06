#!/usr/bin/env node
// Real built-browser direct/module-worker APIs, visible diagnostic controls and 126-test demo.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = path.join(repo, "web/dist");
const out = path.resolve(process.env.E5_T22A_EVIDENCE_DIR || path.join(repo, "evidence/e5-t22a"));
const sha = (data) => createHash("sha256").update(data).digest("hex");
const server = createServer(async (request, response) => {
  const file = path.resolve(root, "." + decodeURIComponent(new URL(request.url, "http://localhost").pathname));
  if (!file.startsWith(root + "/")) { response.writeHead(404).end(); return; }
  try {
    const data = await readFile(file);
    const type = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
      ".wasm": "application/wasm", ".json": "application/json", ".css": "text/css" }[path.extname(file)];
    response.writeHead(200, { "Content-Type": type || "application/octet-stream",
      "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" });
    response.end(data);
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({
  executablePath: process.env.E5_T22A_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const errors = [], observations = [];
await mkdir(out, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, serviceWorkers: "block" });
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.location().url.endsWith("/favicon.ico")) errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) errors.push(response.status() + " " + response.url());
  });
  await page.goto(base + "/display-hotplug.html");
  await page.locator("#start").click();
  await page.waitForFunction(() => document.getElementById("status").textContent.includes("Real GPU attached"));
  await page.locator("#apply").click();
  await page.waitForFunction(() => document.getElementById("status").textContent.startsWith("Preferred mode requested"));
  const visibleStats = JSON.parse(await page.locator("#stats").innerText());
  assert.equal(visibleStats.advertisedWidth, 1367);
  assert.equal(visibleStats.advertisedHeight, 901);
  assert.equal(visibleStats.scanoutResource, null);
  assert.equal(visibleStats.resourceCount, 0);
  const image = await page.screenshot({ path: path.join(out, "host-hotplug.png") });
  await page.locator("#stop").click();
  await page.waitForFunction(() => !document.getElementById("start").disabled);

  for (const backend of ["direct", "worker"]) {
    observations.push(await page.evaluate(async (backend) => {
      const { fixtureOptions, printableStats } = await import("./display-hotplug.js");
      const { startLinuxBoot } = await import("./loader.js");
      const { startLinuxBootWorker, stopLinuxController } = await import("./linux-worker-host.js");
      const controller = await (backend === "worker" ? startLinuxBootWorker : startLinuxBoot)(await fixtureOptions());
      const ensure = (value, label) => { if (!value) throw new Error(label); };
      const read = async () => printableStats(await controller.displayStats());
      const initial = await read();
      const beforeDigest = await controller.stateDigest();
      let rejected = 0;
      const invalid = [undefined, null, true, false, "640", {}, [], NaN, Infinity, -Infinity,
        -1, 0, .5, 4095.5, 4096, 4294967297];
      for (const value of invalid) {
        for (const args of [[value, 480], [641, value]]) {
          let error = null;
          try { await controller.setDisplay(...args); } catch (failure) { error = String(failure); }
          ensure(error?.includes("display dimension"), "invalid input must reject: " + String(args));
          ensure(JSON.stringify(await read()) === JSON.stringify(initial), "invalid input changed device");
          rejected++;
        }
      }
      const modes = [[1, 1], [4095, 4095], [1367, 901]];
      for (let index = 0; index < 1000; index++) modes.push([640 + index % 127, 480 + index % 79]);
      const samples = [];
      for (const [width, height] of modes) {
        ensure(await controller.setDisplay(width, height) === true, "hotplug failed");
        const stats = await read();
        const edidWidth = stats.edid[56] | ((stats.edid[58] & 240) << 4);
        const edidHeight = stats.edid[59] | ((stats.edid[61] & 240) << 4);
        ensure(stats.advertisedWidth === width && stats.advertisedHeight === height, "mode mismatch");
        ensure(edidWidth === width && edidHeight === height, "EDID dimensions mismatch");
        ensure(stats.edid.length === 128 && stats.edid.reduce((a, b) => a + b, 0) % 256 === 0, "EDID checksum");
        ensure(stats.pendingEvents === 1 && stats.resourceCount === 0 && stats.resourceBytes === 0, "event/accounting");
        ensure(stats.scanoutResource === null && stats.scanoutWidth === null && stats.scanoutHeight === null,
          "host request fabricated guest adoption");
        samples.push({ width, height, edid: stats.edid, pendingEvents: stats.pendingEvents });
      }
      const final = await read();
      const afterDigest = await controller.stateDigest();
      // No guest instruction was allowed to execute; this is host-boundary evidence only.
      ensure(await controller.isPaused(), "fixture unexpectedly ran");
      await stopLinuxController(controller);
      let afterStop;
      if (backend === "direct") {
        ensure(controller.setDisplay(800, 600) === false && controller.displayStats() === null, "direct stopped mutation");
        afterStop = "false/null";
      } else {
        try { await controller.setDisplay(800, 600); throw new Error("unexpected stopped success"); }
        catch (error) {
          ensure(!String(error).includes("unexpected stopped success"), "worker stopped mutation");
          afterStop = String(error);
        }
      }
      return { backend, initial, final, rejected, samples, beforeDigest, afterDigest, afterStop };
    }, backend));
  }
  assert.deepEqual(observations[0].final, observations[1].final);
  await page.goto(base + "/app.html?noAutoBoot=1");
  await page.waitForFunction(() => document.getElementById("suite-run")?.disabled === false, null, { timeout: 60000 });
  assert.deepEqual(await page.evaluate(async () => [await wvmDemo.setDisplay(640, 480), await wvmDemo.displayStats()]), [false, null]);
  await page.locator("#suite-run").evaluate((element) => element.click());
  await page.waitForFunction(() => document.getElementById("metric-done")?.textContent.trim() === "126", null, { timeout: 120000 });
  const metrics = await page.evaluate(() => ["metric-pass", "metric-fail", "metric-done"]
    .map((id) => document.getElementById(id).textContent.trim()));
  assert.deepEqual(metrics, ["126", "0", "126"]);
  await page.locator("#rm-search").fill("E5-T22a");
  await page.locator(".rm-g-label").filter({ hasText: "E5-T22a" }).click();
  const detail = await page.locator("#rm-detail").innerText();
  const demoImage = await page.screenshot({ path: path.join(out, "demo-suite.png") });
  assert.deepEqual(errors, []);
  const bindingPaths = ["crates/core/src/dev/virtio/gpu/mod.rs", "crates/wasm/src/lib.rs",
    "crates/wasm/src/display_tests.rs", "web/loader.js", "web/linux-worker-protocol.js",
    "web/linux-worker-host.js", "web/linux-worker.js", "web/main.js", "web/display-hotplug.js",
    "web/display-hotplug.html", "web/dist/pkg/wasm_vm_wasm_bg.wasm",
    "tools/verify/e5-t22a-display-hotplug.mjs"];
  const digests = Object.fromEntries(await Promise.all(bindingPaths.map(async (file) => [file, sha(await readFile(path.join(repo, file)))])));
  const result = { schemaVersion: 1, head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
    browser: browser.version(), digests, visibleStats, screenshotSha256: sha(image),
    observations, metrics, detail, demoScreenshotSha256: sha(demoImage), errors };
  await writeFile(path.join(out, "browser-proof.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ backends: observations.map(({backend, rejected, samples, final}) => ({
    backend, rejected, updates: samples.length, final: [final.advertisedWidth, final.advertisedHeight] })),
    metrics, errors }));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
