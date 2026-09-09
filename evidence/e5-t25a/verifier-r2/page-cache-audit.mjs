import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const root = path.join(repo, "web");
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(`${root}/`)) { response.writeHead(404).end(); return; }
  try {
    const data = await readFile(file);
    const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
      ".wasm": "application/wasm", ".css": "text/css", ".gz": "application/gzip" };
    response.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    });
    response.end(data);
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({
  executablePath: process.env.E5_T18E_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const results = [];
try {
  for (const query of ["testHooks=1", "testHooks=1&perfHooks=1"]) {
    const page = await browser.newPage({ serviceWorkers: "block" });
    await page.addInitScript(() => {
      const realSetInterval = window.setInterval.bind(window);
      const realClearInterval = window.clearInterval.bind(window);
      window.__verifierIntervals = [];
      window.setInterval = (callback, delay, ...args) => {
        const entry = { delay: Number(delay), stack: String(new Error().stack || ""), cleared: false };
        const id = realSetInterval(callback, delay, ...args);
        entry.id = Number(id);
        window.__verifierIntervals.push(entry);
        return id;
      };
      window.clearInterval = (id) => {
        const entry = window.__verifierIntervals.find((candidate) => candidate.id === Number(id));
        if (entry) entry.cleared = true;
        return realClearInterval(id);
      };
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push({ type: "pageerror", text: String(error), url: "" }));
    page.on("console", (message) => {
      const url = message.location().url || "";
      if (message.type() === "error" && !url.endsWith("/favicon.ico")) {
        errors.push({ type: "console", text: message.text(), url });
      }
    });
    await page.goto(`${base}/index.html?noAutoBoot=1&${query}`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
    const boot = await page.evaluate(() => window.wvmDemo.runBusybox());
    assert.equal(boot.ok, true);
    const observed = await page.evaluate(async () => {
      const linuxController = window.__linuxCtl;
      await linuxController.pause();
      const scheduler = await window.__schedulerStats();
      await new Promise((resolve) => setTimeout(resolve, 75));
      const mainFiftyMsIntervals = window.__verifierIntervals.filter((entry) =>
        entry.delay === 50 && entry.stack.includes("/main.js"));
      const result = {
        hasPerf: Object.hasOwn(window, "__desktopPerf"),
        retiredInstructions: scheduler.retiredInstructions,
        mainFiftyMsIntervals: mainFiftyMsIntervals.map((entry) => ({
          delay: entry.delay,
          cleared: entry.cleared,
          stackHasMain: entry.stack.includes("/main.js"),
        })),
        presentationAttributionCallback: typeof window.__presentation.controller()._guestInstructions === "function",
      };
      if (!result.hasPerf) return result;
      window.__desktopPerf.clearPresents();
      const state = window.__desktopPerf.state();
      const width = state.width;
      const height = state.height;
      window.__presentation.controller().present({
        scanout: 0,
        format: 1,
        rect: { x: 0, y: 0, width, height },
        resourceWidth: width,
        resourceHeight: height,
        pixels: new Uint32Array(width * height).fill(0xff112233),
      });
      await new Promise((resolve) => setTimeout(resolve, 75));
      return { ...result, records: window.__desktopPerf.presents() };
    });
    const both = query.includes("perfHooks=1");
    assert.equal(observed.hasPerf, both);
    assert.equal(observed.presentationAttributionCallback, both);
    assert.equal(observed.retiredInstructions > 0, true);
    assert.equal(observed.mainFiftyMsIntervals.length, both ? 1 : 0);
    if (both) {
      assert.equal(observed.records.length, 1);
      assert.equal(observed.records[0].drawn, true);
      assert.equal(observed.records[0].guestInstructionsTotal, observed.retiredInstructions);
      assert.equal(Number.isSafeInteger(observed.records[0].guestInstructions), true);
      assert.equal(observed.records[0].guestInstructions >= 0, true);
    }
    assert.deepEqual(errors, []);
    await page.evaluate(() => window.__linuxCtl.stop());
    await page.waitForFunction(() => window.__linuxCtl === null, null, { timeout: 30_000 });
    const cleanup = await page.evaluate(() => ({
      mainFiftyMsIntervals: window.__verifierIntervals.filter((entry) =>
        entry.delay === 50 && entry.stack.includes("/main.js")).map((entry) => ({
          delay: entry.delay,
          cleared: entry.cleared,
          stackHasMain: entry.stack.includes("/main.js"),
        })),
      perfControllerAfterStop: window.__desktopPerf?.controller?.() ?? null,
    }));
    assert.equal(cleanup.mainFiftyMsIntervals.length, both ? 1 : 0);
    if (both) {
      assert.equal(cleanup.mainFiftyMsIntervals[0].cleared, true);
      assert.equal(cleanup.perfControllerAfterStop, null);
    }
    results.push({ query, boot, observed, cleanup, errors });
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

const output = {
  schema: "e5-t25a-page-cache-v1",
  exactHead: "0da96f6a5c7f323b986fe41b6f6bfb2508eec834",
  browser: "chromium",
  browserVersion: "152.0.7977.76",
  results,
};
await mkdir(path.dirname(fileURLToPath(new URL("page-cache-results.json", import.meta.url))), { recursive: true });
await writeFile(new URL("page-cache-results.json", import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ normalSamplerCount: results[0].observed.mainFiftyMsIntervals.length,
  gatedSamplerCount: results[1].observed.mainFiftyMsIntervals.length,
  gatedRecord: results[1].observed.records[0] }));
