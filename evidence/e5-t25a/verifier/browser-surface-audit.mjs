import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const roots = [
  { name: "source", root: path.join(repo, "web"), page: "index.html" },
  { name: "dist", root: path.join(repo, "web/dist"), page: "app.html" },
];
const attackResults = JSON.parse(await readFile(new URL("attack-results.json", import.meta.url), "utf8"));
const requests = [];
let activeRoot = roots[0].root;
const server = createServer(async (request, response) => {
  requests.push(request.url);
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const file = path.resolve(activeRoot, `.${pathname}`);
  if (!file.startsWith(`${activeRoot}/`)) { response.writeHead(404).end(); return; }
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

const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const results = [];
try {
  for (const target of roots) {
    activeRoot = target.root;
    for (const query of [
      "noAutoBoot=1",
      "noAutoBoot=1&testHooks=1",
      "noAutoBoot=1&perfHooks=1",
      "noAutoBoot=1&testHooks=1&perfHooks=1",
    ]) {
      const requestStart = requests.length;
      const page = await browser.newPage({ serviceWorkers: "block" });
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      page.on("console", (message) => {
        if (message.type() === "error" && !message.location().url.endsWith("/favicon.ico")) {
          errors.push({ text: message.text(), url: message.location().url });
        }
      });
      const base = `http://127.0.0.1:${server.address().port}`;
      await page.goto(`${base}/${target.page}?${query}`);
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
      const automaticPageRequests = requests.slice(requestStart);
      assert.equal(automaticPageRequests.some((url) => url.includes("desktop-perf-hooks")), false);
      const both = query.includes("testHooks") && query.includes("perfHooks");
      const observed = await page.evaluate(async ({ shouldPresent, runFixture }) => {
        const hasPerf = Object.hasOwn(window, "__desktopPerf");
        if (!hasPerf || !shouldPresent) return { hasPerf };
        const before = window.__desktopPerf.presents();
        const state = window.__desktopPerf.state();
        const width = state.width;
        const height = state.height;
        const accepted = window.__presentation.controller().present({
          scanout: 0,
          format: 1,
          rect: { x: 0, y: 0, width, height },
          resourceWidth: width,
          resourceHeight: height,
          pixels: new Uint32Array(width * height).fill(0xff112233),
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        const after = window.__desktopPerf.presents();
        window.__desktopPerf.clearPresents();
        let fixtureBytes = null;
        if (runFixture) {
          const [{ createDesktopPerfInput }, { PresentationController }] = await Promise.all([
            import(new URL("./bench/desktop-perf-hooks.js", location.href)),
            import(new URL("./src/sink/presentation.js", location.href)),
          ]);
          const calls = [];
          const injected = {};
          for (const name of ["sendTabletEvent", "syncTablet", "sendKeyboardEvent", "syncKeyboard"]) {
            injected[name] = (...args) => calls.push([name, ...args]);
          }
          class FixtureCanvas {
            constructor() { this.width = 2; this.height = 2; }
            getContext() { return null; }
            addEventListener() {}
            removeEventListener() {}
          }
          class FixtureBackend {
            resize() {}
            present() {}
            drawsPixels() { return true; }
          }
          const input = createDesktopPerfInput(injected, { enabled: true });
          const telemetry = [];
          const fixtureBackend = new FixtureBackend();
          const fixtureController = new PresentationController(new FixtureCanvas(), {
            backendFactories: { canvas2d: () => fixtureBackend, webgl2: () => fixtureBackend },
            onPresent: (record) => telemetry.push(record),
            now: () => 15,
          });
          const events = [
            await input.moveAbsolute(100, 200),
            await input.leftButton(true),
            await input.leftButton(false),
            await input.key(30, true),
            await input.key(30, false),
          ];
          fixtureController.present({ format: 1,
            rect: { x: 0, y: 0, width: 2, height: 2 }, resourceWidth: 2, resourceHeight: 2,
            pixels: new Uint32Array(4).fill(0xff112233) });
          fixtureBytes = JSON.stringify({ events, calls, telemetry, gpu: fixtureController.snapshot().gpu });
        }
        return {
          hasPerf,
          version: window.__desktopPerf.version,
          keys: Object.keys(window.__desktopPerf).sort(),
          before,
          accepted,
          after,
          cleared: window.__desktopPerf.presents(),
          controllerPresent: window.__desktopPerf.controller() !== null,
          fixtureBytes,
        };
      }, { shouldPresent: both, runFixture: both && target.name === "source" });
      assert.equal(observed.hasPerf, both);
      if (both) {
        assert.equal(observed.version, "e5-t25a-v1");
        assert.deepEqual(observed.before, []);
        assert.equal(observed.accepted, true);
        assert.equal(observed.after.length, 1);
        assert.equal(observed.after[0].drawn, true);
        assert.deepEqual(observed.cleared, []);
        if (target.name === "source") {
          assert.equal(observed.fixtureBytes, attackResults.fiveRepetitions.bytes);
        }
      }
      const scopedErrors = errors.filter((error) =>
        !(target.name === "dist" && typeof error === "object" && error.url.endsWith("/artifacts-alpine.json")));
      assert.deepEqual(scopedErrors, []);
      results.push({ target: target.name, query, observed, helperRequested: false,
        scopedErrors, excludedPreexistingErrors: errors.filter((error) => !scopedErrors.includes(error)) });
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}

await mkdir(path.dirname(new URL("surface-results.json", import.meta.url).pathname), { recursive: true });
await writeFile(new URL("surface-results.json", import.meta.url), `${JSON.stringify({
  schema: "e5-t25a-verifier-surfaces-v1",
  chromium: "152.0.7977.76",
  results,
}, null, 2)}\n`);
console.log(JSON.stringify({ surfaces: results.length, status: "held" }));
