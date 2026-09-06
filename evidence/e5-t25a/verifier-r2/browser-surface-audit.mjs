import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const roots = [
  { name: "source", root: path.join(repo, "web"), page: "index.html" },
  { name: "dist", root: path.join(repo, "web/dist"), page: "app.html" },
];
const queries = [
  "noAutoBoot=1",
  "noAutoBoot=1&testHooks=1",
  "noAutoBoot=1&perfHooks=1",
  "noAutoBoot=1&testHooks=1&perfHooks=1",
];

const [sourceMain, distMain] = await Promise.all([
  readFile(path.join(repo, "web/main.js"), "utf8"),
  readFile(path.join(repo, "web/dist/main.js"), "utf8"),
]);
assert.equal(sourceMain, distMain);
assert.equal(sourceMain.includes("desktop-perf-hooks.js"), false);
assert.match(sourceMain, /const _desktopPerfHooksRequested =[^;]+has\("testHooks"\)[^;]+has\("perfHooks"\)/);
assert.match(sourceMain, /guestInstructions: _desktopPerfHooksRequested \? \(\) => _desktopPerfGuestInstructions : undefined/);
assert.match(sourceMain, /if \(_desktopPerfHooksRequested\) \{[\s\S]*?_desktopPerfStatsTimer = setInterval\(sampleGuestInstructions, 50\);/);
assert.equal((sourceMain.match(/_desktopPerfStatsTimer = setInterval/g) ?? []).length, 1);

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
const base = `http://127.0.0.1:${server.address().port}`;

const { chromium, firefox } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
const browserSpecs = [
  ["chromium", () => chromium.launch({
    executablePath: process.env.E5_T18E_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  })],
  ["firefox", () => firefox.launch({ headless: true })],
];
const results = [];

try {
  for (const [browserName, launch] of browserSpecs) {
    const browser = await launch();
    try {
      for (const target of roots) {
        activeRoot = target.root;
        for (const query of queries) {
          const requestStart = requests.length;
          const page = await browser.newPage({ serviceWorkers: "block" });
          await page.addInitScript(() => {
            const realSetInterval = window.setInterval.bind(window);
            window.__verifierIntervals = [];
            window.setInterval = (callback, delay, ...args) => {
              window.__verifierIntervals.push({ delay: Number(delay), stack: String(new Error().stack || "") });
              return realSetInterval(callback, delay, ...args);
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
          await page.goto(`${base}/${target.page}?${query}`);
          await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
          const automaticRequests = requests.slice(requestStart);
          const helperAutomaticallyRequested = automaticRequests.some((url) => url.includes("desktop-perf-hooks"));
          assert.equal(helperAutomaticallyRequested, false);
          const both = query.includes("testHooks") && query.includes("perfHooks");
          const observed = await page.evaluate(async ({ targetName, bothGates }) => {
            const controller = window.__presentation?.controller?.() ?? null;
            const baseResult = {
              hasPerf: Object.hasOwn(window, "__desktopPerf"),
              presentationHasRecordSink: typeof controller?._onPresent === "function",
              attributionCallbackInstalled: typeof controller?._guestInstructions === "function",
              startupFiftyMsMainIntervals: (window.__verifierIntervals ?? []).filter((entry) =>
                entry.delay === 50 && entry.stack.includes("/main.js")),
            };
            if (!bothGates) return baseResult;
            const before = window.__desktopPerf.presents();
            const state = window.__desktopPerf.state();
            const width = state.width;
            const height = state.height;
            const accepted = controller.present({
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

            const { PresentationController } = await import(new URL("./src/sink/presentation.js", location.href));
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
            const fixtureRecords = [];
            let guestInstructions = 100;
            const fixtureBackend = new FixtureBackend();
            const fixturePresentation = new PresentationController(new FixtureCanvas(), {
              backendFactories: { canvas2d: () => fixtureBackend, webgl2: () => fixtureBackend },
              onPresent: (record) => fixtureRecords.push(record),
              now: () => 15,
              guestInstructions: () => guestInstructions,
            });
            const fixtureFrame = { format: 1, rect: { x: 0, y: 0, width: 2, height: 2 },
              resourceWidth: 2, resourceHeight: 2,
              pixels: new Uint32Array(4).fill(0xff112233) };
            fixturePresentation.present(fixtureFrame);
            guestInstructions = 175;
            fixturePresentation.present(fixtureFrame);

            let inputBytes = null;
            if (targetName === "source") {
              const { createDesktopPerfInput } = await import(new URL("./bench/desktop-perf-hooks.js", location.href));
              const calls = [];
              const inputController = {};
              for (const name of ["sendTabletEvent", "syncTablet", "sendKeyboardEvent", "syncKeyboard"]) {
                inputController[name] = (...args) => calls.push([name, ...args]);
              }
              const input = createDesktopPerfInput(inputController, { enabled: true });
              const records = [
                await input.moveAbsolute(100, 200),
                await input.leftButton(true),
                await input.leftButton(false),
                await input.key(30, true),
                await input.key(30, false),
              ];
              inputBytes = JSON.stringify({ records, calls });
            }
            return {
              ...baseResult,
              version: window.__desktopPerf.version,
              before,
              accepted,
              after,
              cleared: window.__desktopPerf.presents(),
              fixtureTelemetryBytes: JSON.stringify(fixtureRecords),
              inputBytes,
            };
          }, { targetName: target.name, bothGates: both });

          assert.equal(observed.hasPerf, both);
          assert.equal(observed.presentationHasRecordSink, both);
          assert.equal(observed.attributionCallbackInstalled, both);
          assert.deepEqual(observed.startupFiftyMsMainIntervals, []);
          if (both) {
            assert.equal(observed.version, "e5-t25a-v1");
            assert.deepEqual(observed.before, []);
            assert.equal(observed.accepted, true);
            assert.equal(observed.after.length, 1);
            assert.equal(observed.after[0].drawn, true);
            assert.deepEqual(observed.cleared, []);
            const telemetry = JSON.parse(observed.fixtureTelemetryBytes);
            assert.deepEqual(telemetry.map((record) => [record.guestInstructions, record.guestInstructionsTotal]), [
              [100, 100], [75, 175],
            ]);
          }
          const scopedErrors = errors.filter((error) =>
            !(target.name === "dist" && error.url.endsWith("/artifacts-alpine.json")));
          assert.deepEqual(scopedErrors, []);
          results.push({
            browser: browserName,
            browserVersion: browser.version(),
            target: target.name,
            query,
            automaticRequestCount: automaticRequests.length,
            automaticHelperRequests: automaticRequests.filter((url) => url.includes("desktop-perf-hooks")),
            helperAutomaticallyRequested,
            observed,
            scopedErrors,
            excludedPreexistingErrors: errors.filter((error) => !scopedErrors.includes(error)),
          });
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
}

const gated = results.filter((entry) => entry.query.includes("testHooks=1&perfHooks=1"));
assert.equal(gated.length, 4);
assert.equal(new Set(gated.map((entry) => entry.observed.fixtureTelemetryBytes)).size, 1);
const sourceInput = gated.filter((entry) => entry.target === "source").map((entry) => entry.observed.inputBytes);
assert.equal(new Set(sourceInput).size, 1);

const output = {
  schema: "e5-t25a-verifier-r2-surfaces-v1",
  exactHead: "0da96f6a5c7f323b986fe41b6f6bfb2508eec834",
  staticRouting: {
    sourceDistMainByteEqual: sourceMain === distMain,
    productionHelperImport: false,
    conjunctionGate: true,
    callbackConjunctionGated: true,
    pollingConjunctionGated: true,
    pollingInstallSites: 1,
  },
  gatedFixtureTelemetryByteEqualAcrossBrowsersAndTargets: true,
  sourceInputByteEqualAcrossBrowsers: true,
  results,
};
await mkdir(path.dirname(fileURLToPath(new URL("surface-results.json", import.meta.url))), { recursive: true });
await writeFile(new URL("surface-results.json", import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ surfaces: results.length, gatedTelemetryParity: "held", releaseIsolation: "held" }));
