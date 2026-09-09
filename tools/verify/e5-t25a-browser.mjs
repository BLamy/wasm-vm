#!/usr/bin/env node
// E5-T25a: browser-facing opt-in surface smoke. It does not boot Linux or measure performance;
// later T25 slices own those recordings.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = path.join(repo, "web");
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(`${root}/`)) { response.writeHead(404).end(); return; }
  try {
    const data = await readFile(file);
    const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
      ".wasm": "application/wasm", ".css": "text/css" };
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
const out = path.resolve(process.env.E5_T25A_OUT || path.join(repo, "evidence/e5-t25a/browser"));
await mkdir(out, { recursive: true });
const { chromium, firefox } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
const browsers = [
  ["chromium", () => chromium.launch({
    executablePath: process.env.E5_T18E_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  })],
  ["firefox", () => firefox.launch({ headless: true })],
];
try {
  const browsersResult = [];
  for (const [name, launch] of browsers) {
    const browser = await launch();
    try {
      let gatedResult = null;
      for (const query of ["noAutoBoot=1", "noAutoBoot=1&testHooks=1&perfHooks=1"]) {
        const page = await browser.newPage({ serviceWorkers: "block" });
        const errors = [];
        page.on("pageerror", (error) => errors.push(String(error)));
        page.on("console", (message) => {
          if (message.type() === "error" && !message.location().url.endsWith("/favicon.ico")) errors.push(message.text());
        });
        await page.goto(`${base}/index.html?${query}`);
        await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
        const result = await page.evaluate(async () => {
          let hookRecord = null;
          let hookCalls = [];
          if (location.search.includes("perfHooks")) {
            const hooks = await import(new URL("./bench/desktop-perf-hooks.js", location.href));
            const controller = {
              sendTabletEvent: (...args) => hookCalls.push(["sendTabletEvent", ...args]),
              syncTablet: () => hookCalls.push(["syncTablet"]),
              sendKeyboardEvent: (...args) => hookCalls.push(["sendKeyboardEvent", ...args]),
              syncKeyboard: () => hookCalls.push(["syncKeyboard"]),
            };
            hookRecord = await hooks.createDesktopPerfInput(controller, { enabled: true }).moveAbsolute(4, 5);
          }
          return {
            hasPerf: Object.hasOwn(window, "__desktopPerf"),
            version: window.__desktopPerf?.version ?? null,
            state: window.__desktopPerf?.state?.() ?? null,
            presents: window.__desktopPerf?.presents?.() ?? null,
            hookRecord,
            hookCalls,
          };
        });
        if (query.includes("perfHooks")) {
          gatedResult = result;
          assert.equal(result.hasPerf, true);
          assert.equal(result.version, "e5-t25a-v1");
          assert.deepEqual(result.presents, []);
          assert.deepEqual(result.hookRecord, {
            version: "e5-t25a-v1", sequence: 1, device: "tablet", sync: "SYN_REPORT", noop: false,
            events: [{ eventType: 3, code: 0, value: 4 }, { eventType: 3, code: 1, value: 5 }],
          });
          assert.deepEqual(result.hookCalls, [
            ["sendTabletEvent", 3, 0, 4], ["sendTabletEvent", 3, 1, 5], ["syncTablet"],
          ]);
          assert.equal(result.state.gpu.drawnPresents, 0);
        } else {
          assert.deepEqual(result, {
            hasPerf: false, version: null, state: null, presents: null, hookRecord: null, hookCalls: [],
          });
        }
        if (query.includes("perfHooks") && name === "chromium") {
          await page.screenshot({ path: path.join(out, "chromium-gated.png") });
        }
        assert.deepEqual(errors, []);
        await page.close();
      }
      const browserResult = {
        browser: name,
        version: browser.version(),
        normalSurface: false,
        gatedSurface: true,
        hookRecord: gatedResult.hookRecord,
        hookCalls: gatedResult.hookCalls,
      };
      browsersResult.push(browserResult);
      console.log(JSON.stringify(browserResult));
    } finally {
      await browser.close();
    }
  }
  await writeFile(path.join(out, "results.json"), `${JSON.stringify({ schema: "wasm-vm-e5-t25a-browser-v1", browsers: browsersResult }, null, 2)}\n`);
} finally {
  server.close();
}
