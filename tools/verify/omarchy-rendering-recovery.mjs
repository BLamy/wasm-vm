#!/usr/bin/env node
/*
 * Rendering-recovery-only evidence harness.
 *
 * This intentionally does not simulate a boot, inject lifecycle events, use testHooks,
 * or claim guest interactivity.  The supplied URL must be a production/built page
 * whose real Omarchy guest is already configured to restore.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../web/node_modules/playwright/index.mjs";

const USAGE = "usage: node tools/verify/omarchy-rendering-recovery.mjs URL NEW_OUTPUT_DIR";
const VIEWPORTS = [
  { width: 960, height: 600, name: "960x600" },
  { width: 600, height: 900, name: "600x900" },
  { width: 1920, height: 1080, name: "1920x1080" },
];
const SOURCE_NAMES = new Set([
  "main.js", "ide.js", "roadmap.js", "loader.js", "guest-rpc.js",
  "linux-worker.js", "linux-worker-protocol.js", "viewport.js", "sw.js", "app", "app.html",
]);

function usageError(message) {
  throw new Error(`${message}\n${USAGE.replace("URL", "URL|local")}`);
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function sourceKind(url) {
  const parsed = new URL(url);
  const pathname = parsed.pathname.toLowerCase();
  const name = path.posix.basename(pathname);
  if (pathname.endsWith(".wasm")) return "wasm";
  if (SOURCE_NAMES.has(name) || pathname === "/app") return "source";
  if (name === "artifacts-omarchy.json") return "artifact";
  if (/manifest(?:-[0-9a-f]+)?\.json$/.test(name)) return "candidate-manifest";
  return null;
}

function urlKey(value) {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
}

function collectManifestAssets(manifest, manifestUrl, imageBaseUrl = null, assets = new Map()) {
  const artifacts = manifest?.artifacts || {};
  for (const [name, descriptor] of Object.entries(artifacts)) {
    if (!descriptor || typeof descriptor.url !== "string") continue;
    const role = name === "kernel" ? "kernel" : name === "bootSnapshot" ? "ram"
      : name === "overlayDelta" ? "delta" : null;
    if (role) assets.set(urlKey(new URL(descriptor.url, manifestUrl).href), { role, descriptor, url: new URL(descriptor.url, manifestUrl).href });
  }
  const base = manifest?.chunkedImage;
  if (base?.key) {
    const baseRoot = imageBaseUrl ? `${imageBaseUrl.replace(/\/+$/, "")}/` : manifestUrl;
    const url = new URL(base.key, baseRoot).href;
    assets.set(urlKey(url), { role: "baseManifest", descriptor: base, url });
  }
  return assets;
}

function essentialResponseIdentity(records, phase) {
  const identity = new Map();
  for (const record of records.filter((item) => item.phase === phase
    && ["source", "wasm", "artifact"].includes(item.kind) && item.sha256)) {
    identity.set(`${urlKey(record.url)}:${record.kind}`, record.sha256);
  }
  return Object.fromEntries([...identity.entries()].sort());
}

function requestProvenance(response) {
  const request = response.request();
  const headers = request.headers();
  let frameUrl = null;
  try { frameUrl = request.frame()?.url() || null; } catch { /* dedicated workers have no frame */ }
  return {
    method: request.method(), resourceType: request.resourceType(), frameUrl,
    range: headers.range || null, cacheControl: headers["cache-control"] || null,
    accept: headers.accept || null,
  };
}

function isNonFullProbe(provenance) {
  return provenance.method === "HEAD" || Boolean(provenance.range);
}

function assertPhaseAssets(records, assets, phase) {
  for (const role of ["kernel", "ram", "delta", "baseManifest"]) {
    const asset = [...assets.values()].find((item) => item.role === role);
    assert.ok(asset, `${phase}: missing ${role} descriptor`);
    const matches = records.filter((record) => record.phase === phase && record.assetRole === role);
    assert.ok(matches.some((record) => record.status === 200 && record.url === asset.url
      && record.sha256 === asset.descriptor.sha256 && record.bytes === asset.descriptor.size),
    `${phase}: ${role} provenance did not match boot-manifest digest and size`);
  }
}

function assertActiveBuild(identity, expectedVersion) {
  assert.equal(identity.activeExecution?.version, expectedVersion, "active SW executes a stale build");
  assert.equal(identity.activeExecution?.cache, `wasm-vm-shell-${expectedVersion}`);
  assert.equal(identity.activeExecution?.scriptURL, identity.controllerScriptURL);
  assert.equal(identity.registrationActiveURL, identity.controllerScriptURL);
  assert.deepEqual(identity.buildVersions, [expectedVersion], "active SW cache build mismatch");
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_ASSET_BASE = "https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev";
const DIST_ROOT = path.join(REPO_ROOT, "web", "dist");
const RELEASE_ROOT = path.join(REPO_ROOT, "releases");
const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"], [".wasm", "application/wasm"],
]);
const inside = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);

function resolveLocalPath(requestPath) {
  let decoded;
  try { decoded = decodeURIComponent(requestPath); } catch { return { status: 400, body: "bad URL encoding" }; }
  if (decoded.includes("\0")) return { status: 400, body: "invalid path" };
  const isRelease = decoded.startsWith("/releases/");
  const root = isRelease ? RELEASE_ROOT : DIST_ROOT;
  const relative = isRelease
    ? decoded.slice("/releases/".length)
    : decoded === "/" ? "app.html" : decoded.replace(/^\/+/, "");
  const file = path.resolve(root, relative);
  if (!inside(root, file)) return { status: 403, body: "path outside served tree" };
  return { path: file, root };
}

async function serveLocal(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }); response.end(); return;
  }
  const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
  const resolved = resolveLocalPath(pathname);
  if (resolved.status) { response.writeHead(resolved.status); response.end(resolved.body); return; }
  let stat;
  try { stat = await fs.stat(resolved.path); } catch {
    response.writeHead(404); response.end("not found"); return;
  }
  if (!stat.isFile()) { response.writeHead(404); response.end("not found"); return; }
  const [realRoot, realFile] = await Promise.all([
    fs.realpath(resolved.root).catch(() => null), fs.realpath(resolved.path).catch(() => null),
  ]);
  if (!realRoot || !realFile || !inside(realRoot, realFile)) {
    response.writeHead(403); response.end("path outside served tree"); return;
  }
  response.writeHead(200, {
    "Content-Length": stat.size,
    "Content-Type": MIME_TYPES.get(path.extname(resolved.path).toLowerCase()) || "application/octet-stream",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "no-store",
  });
  if (request.method === "HEAD") response.end();
  else response.end(await fs.readFile(resolved.path));
}

async function startLocalServer() {
  const server = createServer((request, response) => {
    void serveLocal(request, response).catch((error) => {
      if (!response.headersSent) response.writeHead(500);
      response.end(`local verifier server error: ${error.message}`);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object", "local verifier server did not bind");
  return { server, url: `http://127.0.0.1:${address.port}/app.html?guest=omarchy&desktop=1#ide` };
}

async function main() {
  const [urlArg, outputArg, ...extra] = process.argv.slice(2);
  if (!urlArg || !outputArg || extra.length) usageError("expected exactly URL and NEW_OUTPUT_DIR");
  let ownedServer = null;
  let targetUrl;
  if (urlArg === "local") {
    const local = await startLocalServer();
    ownedServer = local.server;
    targetUrl = new URL(local.url);
  } else {
    try { targetUrl = new URL(urlArg); } catch { usageError(`invalid URL: ${urlArg}`); }
    if (!/^https?:$/.test(targetUrl.protocol)) usageError("URL must use http or https, or local");
  }
  const outputDir = path.resolve(outputArg);
  try { await fs.mkdir(outputDir, { recursive: false }); } catch (error) {
    if (ownedServer) await new Promise((resolve) => ownedServer.close(resolve));
    throw error;
  }

  const report = {
    schema: "wasm-vm.omarchy-rendering-recovery.v1",
    result: "rendering-recovery-only",
    guestInteractivityVerified: false,
    url: targetUrl.href,
    startedAt: new Date().toISOString(),
    screenshots: [],
    viewports: [],
    responseHashes: [],
    sourceAndArtifactResponses: [],
    observations: [],
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    errors: [],
    provenanceFetches: [],
    observerLimitations: [],
    workerCompletions: [],
  };
  let browser;
  let page;
  let responseChain = Promise.resolve();
  let responsePhase = "initial";
  let explicitProvenanceUrl = null;
  const manifestAssets = new Map();
  const expectedSw = await fs.readFile(path.join(DIST_ROOT, "sw.js"), "utf8");
  const expectedVersion = expectedSw.match(/const VERSION = "([a-f0-9]{12})"/)?.[1];
  assert.ok(expectedVersion, "frozen built SW version missing");
  report.expectedBuild = { version: expectedVersion, serviceWorkerSha256: sha256(Buffer.from(expectedSw)) };

  const saveReport = async () => {
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  };
  const saveScreenshot = async (name) => {
    if (!page) return;
    try {
      const file = path.join(outputDir, name);
      await page.screenshot({ path: file, fullPage: false });
      report.screenshots.push({ name, path: file, sha256: sha256(await fs.readFile(file)) });
    } catch (error) {
      report.errors.push(`screenshot ${name}: ${error.message}`);
    }
  };

  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      serviceWorkers: "allow",
    });
    await context.addInitScript(() => {
      window.__omarchyRenderingRecovery = { events: [] };
      for (const type of ["wvm:desktop-ready", "wvm:guest-error", "wvm:guest-ready"]) {
        window.addEventListener(type, (event) => {
          window.__omarchyRenderingRecovery.events.push({ type, at: Date.now(), detail: event.detail ?? null });
        });
      }
    });
    const recordResponse = (response) => {
      const source = sourceKind(response.url());
      const existingAsset = manifestAssets.get(urlKey(response.url()));
      const candidateAsset = /\/releases\/|\/chunked-[^/]+\/manifest(?:-[0-9a-f]+)?\.json(?:\?|$)/i.test(response.url());
      if (!source && !existingAsset && !candidateAsset) return;
      const eventPhase = responsePhase;
      // Start the CDP body read at response-event time. Delaying response.body() until the
      // serialized drain lets Chrome evict large kernel/RAM bodies from its inspector cache.
      const explicitProvenance = response.url() === explicitProvenanceUrl;
      // Catch immediately, even while earlier responses are draining.
      const bodyPromise = explicitProvenance ? null : response.body().then(
        (body) => ({ body }), (error) => ({ error }),
      );
      const provenance = requestProvenance(response);
      responseChain = responseChain.then(async () => {
        const record = {
          url: response.url(), status: response.status(), kind: source || existingAsset?.role || "asset-pending",
          phase: eventPhase, fromServiceWorker: response.fromServiceWorker?.() ?? null, request: provenance,
        };
        if (explicitProvenance) {
          record.explicitProvenance = true;
          report.responseHashes.push(record);
          return;
        }
        try {
          const captured = await bodyPromise;
          if (captured.error) throw captured.error;
          const body = captured.body;
          record.bytes = body.byteLength;
          record.sha256 = sha256(body);
          if (source === "artifact") {
            try {
              const manifest = JSON.parse(body.toString("utf8"));
              const imageBase = targetUrl.searchParams.get("omarchyAssetBase") || DEFAULT_ASSET_BASE;
              collectManifestAssets(manifest, response.url(), imageBase, manifestAssets);
              report.bootManifestDescriptor = {
                responseUrl: response.url(), responseSha256: record.sha256, responseSize: record.bytes,
                artifacts: manifest.artifacts || null,
                immutableBaseManifest: manifest.chunkedImage || null,
              };
            } catch (error) {
              record.manifestError = String(error?.message || error);
            }
          }
          const asset = manifestAssets.get(urlKey(response.url()));
          if (asset) {
            record.assetRole = asset.role;
            record.expected = { sha256: asset.descriptor.sha256, size: asset.descriptor.size, url: asset.url };
          }
          report.responseHashes.push(record);
          report.sourceAndArtifactResponses.push(record);
        } catch (error) {
          record.bodyError = String(error?.message || error);
          report.responseHashes.push(record);
          if (isNonFullProbe(provenance)) {
            record.probeBodyError = true;
            report.probeErrors = report.probeErrors || [];
            report.probeErrors.push(`non-full response body ${response.url()}: ${record.bodyError}`);
          } else if (/Network\.getResponseBody.*(?:No resource with given identifier|evicted from inspector cache)/s.test(record.bodyError)) {
            record.observerLimitation = "inspector body unavailable; not a captured worker-byte hash";
            report.observerLimitations.push(record);
          } else {
            report.errors.push(`response body ${response.url()}: ${record.bodyError}`);
          }
        }
      });
    };
    context.on("response", recordResponse);
    page = await context.newPage();
    page.on("console", (message) => {
      const location = message.location?.().url || "";
      if (message.type() === "error" && !/favicon\.ico(?:\?|$)/i.test(location)
        && !/favicon\.ico(?:\?|$)/i.test(message.text())) report.consoleErrors.push({ text: message.text(), location });
    });
    page.on("pageerror", (error) => report.pageErrors.push(String(error?.stack || error)));
    context.on("requestfailed", (request) => {
      if (!/favicon\.ico(?:\?|$)/i.test(request.url())) report.requestFailures.push({
        url: request.url(), phase: responsePhase, request: requestProvenance({ request: () => request }),
        failure: request.failure()?.errorText || "unknown",
      });
    });

    if (urlArg !== "local") {
      const invalid = ["testHooks", "noSnapshot", "persist", "noAutoBoot"].filter((key) => targetUrl.searchParams.has(key));
      assert.deepEqual(invalid, [], `production URL has forbidden test-only boot selectors: ${invalid.join(", ")}`);
    }
    const progress = (stage, extra = {}) => {
      const entry = { stage, at: new Date().toISOString(), ...extra };
      report.observations.push({ progress: entry });
      console.log(`OMARCHY_RENDERING_PROGRESS ${JSON.stringify(entry)}`);
    };

    progress("goto", { url: targetUrl.href });
    await page.goto(targetUrl.href, { waitUntil: "domcontentloaded", timeout: 60_000 });
    progress("domcontentloaded");
    await page.waitForFunction(() => window.__linux && window.__presentation && window.__pointer, null, { timeout: 300_000 });
    progress("runtime-hooks-ready");
    await page.waitForFunction(() => window.__omarchyRenderingRecovery?.events?.some((event) => event.type === "wvm:desktop-ready"), null, { timeout: 300_000 });
    progress("desktop-ready");

    async function serviceWorkerIdentity() {
      const identity = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker?.getRegistration();
        const cacheKeys = "caches" in window ? await caches.keys() : [];
        return {
          controllerScriptURL: navigator.serviceWorker?.controller?.scriptURL || null,
          registrationActiveURL: registration?.active?.scriptURL || null,
          cacheKeys,
          buildVersions: cacheKeys.filter((key) => key.startsWith("wasm-vm-shell-")).map((key) => key.slice("wasm-vm-shell-".length)),
        };
      });
      const workers = context.serviceWorkers().filter((worker) => worker.url() === identity.controllerScriptURL);
      assert.equal(workers.length, 1, "exactly one active service-worker execution required");
      identity.activeExecution = await workers[0].evaluate(() => ({
        version: typeof VERSION === "string" ? VERSION : null,
        cache: typeof CACHE === "string" ? CACHE : null,
        scriptURL: self.location.href,
      }));
      assertActiveBuild(identity, expectedVersion);
      return identity;
    }
    async function fetchServiceWorkerScript(phase) {
      const fetched = await page.evaluate(async () => {
        const response = await fetch(new URL("sw.js", location.href), { cache: "no-store" });
        return { url: response.url, status: response.status, text: await response.text() };
      });
      assert.equal(fetched.status, 200, `${phase}: explicit sw.js provenance fetch failed`);
      const record = {
        url: fetched.url, status: fetched.status, kind: "source", phase,
        explicitFetch: true, bytes: Buffer.byteLength(fetched.text), sha256: sha256(Buffer.from(fetched.text)),
      };
      report.responseHashes.push(record);
      report.sourceAndArtifactResponses.push(record);
      assert.equal(record.sha256, report.expectedBuild.serviceWorkerSha256, `${phase}: served SW differs from frozen build`);
      return record;
    }
    async function recordPhaseProvenance(phase) {
      const workers = page.workers().filter((worker) => /\/linux-worker\.js(?:[?#]|$)/.test(worker.url()));
      assert.equal(workers.length, 1, `${phase}: actual Linux worker missing`);
      const resources = await workers[0].evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.toJSON()));
      report.workerCompletions.push({ phase, workerURL: workers[0].url(), resources,
        evidenceKind: "actual-worker resource timings plus fail-closed restore; not captured response bodies" });
      for (const asset of manifestAssets.values()) {
        const resource = resources.find((entry) => urlKey(entry.name) === urlKey(asset.url));
        assert.ok(resource && resource.duration > 0, `${phase}: ${asset.role} lacks an actual-worker completion timing`);
      }
      const assets = [...manifestAssets.values(), {
        role: "workerScript", url: workers[0].url(),
        descriptor: { size: (await fs.stat(path.join(DIST_ROOT, "linux-worker.js"))).size },
      }];
      for (const asset of assets) {
        explicitProvenanceUrl = asset.url;
        try {
          const result = await page.evaluate(async ({ url, size }) => {
            const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(90_000) });
            if (!response.ok || !response.body) throw Error(`provenance HTTP ${response.status}: ${url}`);
            const bytes = new Uint8Array(size);
            let count = 0;
            const reader = response.body.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              if (count + value.length > size) { await reader.cancel(); throw Error(`provenance exceeds expected size: ${url}`); }
              bytes.set(value, count); count += value.length;
            }
            if (count !== size) throw Error(`provenance short body: ${url}`);
            const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
            return { url: response.url, status: response.status, bytes: count,
              sha256: [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
              at: new Date().toISOString(), origin: location.origin };
          }, { url: asset.url, size: asset.descriptor.size });
          const record = { ...result, phase, assetRole: asset.role, provenanceFetch: true,
            evidenceKind: "independent contemporaneous full-byte fetch; not the worker transfer" };
          report.provenanceFetches.push(record);
          if (asset.role === "workerScript") {
            assert.equal(record.sha256, sha256(await fs.readFile(path.join(DIST_ROOT, "linux-worker.js"))));
          }
        } finally {
          await responseChain;
          explicitProvenanceUrl = null;
        }
      }
      assertPhaseAssets(report.provenanceFetches, manifestAssets, phase);
      const inputDevice = await page.evaluate(() => window.__linuxCtl?.inputDeviceStats?.());
      report.observations.push({ phase, inputDevice, evidenceKind: "read-only actual input-device counters; not interaction proof" });
    }
    async function desktopObservation(label) {
      const observation = await page.evaluate((observationLabel) => {
        const canvas = document.querySelector("#ide-display-canvas");
        const rect = canvas?.getBoundingClientRect();
        const state = window.__presentation?.state?.() || null;
        const pixels = window.__presentation?.readPixels?.();
        const colors = new Set();
        let visible = 0;
        if (pixels?.length) {
          const stride = Math.max(4, Math.floor(pixels.length / 32768 / 4) * 4);
          for (let i = 0; i + 3 < pixels.length; i += stride) {
            const rgb = `${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`;
            colors.add(rgb);
            if (pixels[i + 3] > 0 && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 12) visible++;
          }
        }
        return {
          label: observationLabel,
          url: location.href,
          e2eShowall: document.documentElement.classList.contains("e2e-showall"),
          visiblePanels: [...document.querySelectorAll(".panel")].filter((el) => getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden").map((el) => el.id),
          restoredFromBootSnapshot: window.__linux?.restoredFromBootSnapshot?.() === true,
          desktopReadyEvents: window.__omarchyRenderingRecovery?.events?.filter((event) => event.type === "wvm:desktop-ready").length || 0,
          presentation: state,
          pointerFrames: window.__pointer?.frames?.()?.length ?? null,
          canvas: canvas && rect ? { width: rect.width, height: rect.height, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, backingWidth: canvas.width, backingHeight: canvas.height } : null,
          pixelVariety: { colors: colors.size, visible },
        };
      }, label);
      assert.equal(observation.e2eShowall, false, `${label}: e2e-showall must be absent`);
      assert.deepEqual(observation.visiblePanels, ["panel-ide"], `${label}: unexpected visible editor panels`);
      assert.equal(observation.restoredFromBootSnapshot, true, `${label}: real snapshot restore flag missing`);
      assert.ok(observation.desktopReadyEvents > 0, `${label}: no real desktop-ready event`);
      assert.ok(observation.canvas, `${label}: display canvas missing`);
      assert.equal(observation.canvas.backingWidth, 1280, `${label}: backing width changed`);
      assert.equal(observation.canvas.backingHeight, 800, `${label}: backing height changed`);
      assert.ok(observation.pixelVariety.colors >= 8 && observation.pixelVariety.visible > 16, `${label}: insufficient real pixel variety`);
      observation.serviceWorker = await serviceWorkerIdentity();
      report.observations.push(observation);
      return observation;
    }
    async function pointerProof(label) {
      const canvas = page.locator("#ide-display-canvas");
      const rect = await canvas.boundingBox();
      assert.ok(rect && rect.width > 0 && rect.height > 0, `${label}: canvas has no CSS box`);
      const points = [];
      for (const normalized of [0.25, 0.5, 0.75]) {
        const before = await page.evaluate(() => window.__pointer.frames().length);
        const x = rect.x + rect.width * normalized;
        const y = rect.y + rect.height * normalized;
        await page.mouse.move(x, y);
        await page.waitForFunction((count) => window.__pointer.frames().length > count, before, { timeout: 5_000 });
        const frame = await page.evaluate(() => window.__pointer.frames().at(-1));
        const expected = Math.round(normalized * 32767);
        const coordinates = Object.fromEntries((frame?.events || [])
          .filter((event) => event.code === 0 || event.code === 1)
          .map((event) => [event.code === 0 ? "x" : "y", event.value]));
        assert.equal(coordinates.x, expected, `${label}: pointer X did not reach normalized tablet coordinate`);
        assert.equal(coordinates.y, expected, `${label}: pointer Y did not reach normalized tablet coordinate`);
        const after = await page.evaluate(() => window.__pointer.frames().length);
        points.push({ normalized, x, y, expected, before, after, frame });
      }
      report.observations.push({ label, pointerProof: "physical Playwright mouse movement only; guest processing not asserted", points });
    }
    async function captureViewport(viewport) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(100);
      const observation = await desktopObservation(`viewport-${viewport.name}`);
      const canvas = observation.canvas;
      assert.ok(canvas.width / canvas.height > 1.59 && canvas.width / canvas.height < 1.61, `${viewport.name}: canvas is not 16:10`);
      assert.ok(canvas.left >= -1 && canvas.top >= -1 && canvas.right <= viewport.width + 1 && canvas.bottom <= viewport.height + 1, `${viewport.name}: canvas is not wholly inside viewport`);
      await pointerProof(`viewport-${viewport.name}`);
      const name = `desktop-${viewport.name}.png`;
      await page.screenshot({ path: path.join(outputDir, name), fullPage: false });
      report.screenshots.push({ name, sha256: sha256(await fs.readFile(path.join(outputDir, name))), viewport });
      report.viewports.push({ viewport, observation });
      progress("viewport-captured", { viewport: viewport.name });
    }

    await responseChain;
    await fetchServiceWorkerScript("initial");
    const initial = await desktopObservation("initial");
    await recordPhaseProvenance("initial");
    const initialSW = initial.serviceWorker;
    report.identity = { initialServiceWorker: initialSW, initialEssentialResponses: essentialResponseIdentity(report.responseHashes, "initial") };
    report.observations.push({ serviceWorkerContentSha256: report.responseHashes.find((record) => record.phase === "initial" && /\/sw\.js(?:\?|$)/.test(record.url))?.sha256 || null });
    await page.screenshot({ path: path.join(outputDir, "desktop-initial.png"), fullPage: false });
    report.screenshots.push({ name: "desktop-initial.png", sha256: sha256(await fs.readFile(path.join(outputDir, "desktop-initial.png"))) });
    for (const viewport of VIEWPORTS) await captureViewport(viewport);
    await page.setViewportSize({ width: 1280, height: 800 });
    responsePhase = "reload";
    progress("reload-start");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    progress("reload-domcontentloaded");
    await page.waitForFunction(() => window.__linux && window.__presentation && window.__pointer, null, { timeout: 300_000 });
    progress("reload-runtime-hooks-ready");
    await page.waitForFunction(() => window.__omarchyRenderingRecovery?.events?.some((event) => event.type === "wvm:desktop-ready"), null, { timeout: 300_000 });
    progress("reload-desktop-ready");
    await responseChain;
    await fetchServiceWorkerScript("reload");
    const reloaded = await desktopObservation("reload");
    await recordPhaseProvenance("reload");
    assert.deepEqual(reloaded.serviceWorker, initialSW, "reload changed service-worker cache/controller identity");
    report.identity.reloadServiceWorker = reloaded.serviceWorker;
    report.identity.reloadEssentialResponses = essentialResponseIdentity(report.responseHashes, "reload");
    const swHashes = Object.fromEntries(["initial", "reload"].map((phase) => [phase,
      report.responseHashes.find((record) => record.phase === phase && /\/sw\.js(?:\?|$)/.test(record.url))?.sha256 || null]));
    assert.ok(swHashes.initial && swHashes.reload, "missing hashed service-worker response");
    assert.equal(swHashes.reload, swHashes.initial, "reload changed service-worker content hash");
    report.identity.serviceWorkerContentSha256 = swHashes;
    assert.deepEqual(report.identity.reloadEssentialResponses, report.identity.initialEssentialResponses,
      "reload changed an essential served source/WASM/metadata response hash");
    await page.screenshot({ path: path.join(outputDir, "desktop-reloaded.png"), fullPage: false });
    report.screenshots.push({ name: "desktop-reloaded.png", sha256: sha256(await fs.readFile(path.join(outputDir, "desktop-reloaded.png"))) });
    await responseChain;
    report.assetResponseKinds = [...new Set(report.responseHashes.map((record) => record.assetRole).filter(Boolean))];
    for (const phase of ["initial", "reload"]) assertPhaseAssets(report.provenanceFetches, manifestAssets, phase);
    report.assetMatches = report.responseHashes.filter((record) => record.assetRole).map((record) => ({
      role: record.assetRole, url: record.url, sha256: record.sha256, bytes: record.bytes, expected: record.expected,
    }));
    assert.ok(report.bootManifestDescriptor?.immutableBaseManifest?.key,
      "boot manifest lacked immutable base-manifest descriptor");
    assert.equal(report.errors.length, 0, `response/hash errors: ${report.errors.join(" | ")}`);
    assert.ok(report.responseHashes.some((record) => record.kind === "wasm" && record.sha256), "no hashed WASM response captured");
    assert.ok(report.responseHashes.some((record) => record.kind === "artifact" && record.sha256), "no hashed artifact response captured");
    assert.equal(report.consoleErrors.length, 0, `console errors: ${report.consoleErrors.join(" | ")}`);
    assert.equal(report.pageErrors.length, 0, `page errors: ${report.pageErrors.join(" | ")}`);
    for (const failure of report.requestFailures) {
      // Keep the failed-transfer observation. This is a three-leg inference, not a fake
      // captured body: actual worker completion + integrity-passed restore + full-byte fetch.
      const unavailable = report.observerLimitations.some((record) => record.url === failure.url && record.phase === failure.phase);
      const provenance = report.provenanceFetches.some((record) => record.url === failure.url && record.phase === failure.phase);
      const completion = report.workerCompletions.some((record) => record.phase === failure.phase
        && record.resources.some((entry) => entry.name === failure.url && entry.duration > 0));
      assert.ok(failure.failure === "net::ERR_ABORTED" && unavailable && provenance && completion,
        `unclassified request failure: ${JSON.stringify(failure)}`);
      failure.resolution = "observer transfer unavailable; separate worker completion + integrity-passed restore + full-byte provenance recorded";
    }
    progress("complete", { screenshots: report.screenshots.length });
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.errors.push(String(error?.stack || error));
    await saveScreenshot("failure.png");
    throw error;
  } finally {
    try { await responseChain; } catch (error) { report.errors.push(`response drain: ${error.message}`); }
    if (browser) await browser.close();
    if (ownedServer) await new Promise((resolve) => ownedServer.close(resolve));
    await saveReport();
  }
}

export { collectManifestAssets, essentialResponseIdentity, isNonFullProbe, requestProvenance, resolveLocalPath, sourceKind, assertPhaseAssets, assertActiveBuild };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}
