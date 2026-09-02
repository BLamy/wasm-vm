#!/usr/bin/env node
// E3.5-T05f1: raw Playwright evidence for the Docker-tab guest boundary. The repository's
// @playwright/test runner deadlocks on this host's Node 24 before discovering tests, so this uses
// the same Chromium browser API as the other tools/verify browser proofs.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const base = (process.env.E3_T05F1_WEB_BASE || "http://127.0.0.1:8123").replace(/\/$/, "");
const evidenceDir = path.join(repo, "evidence/e3-t05f1");
const evidencePath = path.join(evidenceDir, "docker-bootstrap-browser.json");
const screenshotPath = path.join(evidenceDir, "docker-bootstrap-browser.png");
const haveAlpineAssets = await Promise.all([
  fs.access(path.join(repo, "web/artifacts-alpine.json")),
  fs.access(path.join(repo, "releases/chunked-alpine/manifest.json")),
]).then(() => true).catch(() => false);

const { chromium } = await import(
  pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")).href,
);

await fs.mkdir(evidenceDir, { recursive: true });
const launchOptions = {
  headless: process.env.E3_T05F1_HEADED !== "1",
  args: ["--disable-dev-shm-usage", "--js-flags=--max-old-space-size=4096"],
};
const chromePath = process.env.E3_T05F1_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let proofError = null;
try {
  await fs.access(chromePath);
  launchOptions.executablePath = chromePath;
} catch {
  // Fall back to Playwright's bundled Chromium on hosts without the local Chrome app.
}
const browser = await chromium.launch(launchOptions);
const browserInfo = { name: browser.browserType().name(), version: browser.version() };

const scenarios = {};
const contexts = [];
const newScenario = async (name, query, configure = null) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  contexts.push(context);
  const page = await context.newPage();
  const consoleErrors = [];
  const expectedConsoleErrors = [];
  const failedRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.location().url.includes("/favicon.ico")) {
      if (name === "public-busybox-no-alpine" && /status of 404/i.test(message.text())) {
        expectedConsoleErrors.push(message.text());
      } else {
        consoleErrors.push(message.text());
      }
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (!request.url().endsWith("/favicon.ico")) {
      failedRequests.push({ url: request.url(), failure: request.failure()?.errorText || "unknown" });
    }
  });
  await configure?.(page);
  await page.goto(`${base}/?noAutoBoot=1&testHooks=1&nosw=1${query}#ide`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await page.waitForFunction(
    () => window.wvmDemo && typeof window.wvmDemo.runBusybox === "function",
    null,
    { timeout: 120_000 },
  );
  await page.locator("#ide-act-docker").click();
  await page.locator("#ide-dk-runtime").waitFor({ state: "visible", timeout: 30_000 });
  return { name, page, consoleErrors, expectedConsoleErrors, failedRequests };
};

const waitForState = async (page, predicate, timeout = 120_000) => {
  await page.waitForFunction(predicate, undefined, { timeout });
  return page.evaluate(() => window.__dockerStateForTest());
};

try {
  // Busybox is a real guest-ready shell, but it deliberately lacks the container runtime.
  const busybox = await newScenario("busybox-degraded", "&guest=busybox");
  await busybox.page.evaluate(() => { void window.wvmDemo.runBusybox(); });
  const busyboxState = await waitForState(
    busybox.page,
    () => window.wvmDemo.isGuestReady?.() === true && window.__dockerStateForTest?.().runtime === "unavailable",
    360_000,
  );
  assert.equal(busyboxState.ready, true);
  assert.equal(busyboxState.guestUp, true);
  assert.equal(busyboxState.runtime, "unavailable");
  assert.match(
    await busybox.page.locator("#ide-dk-runtime-status").innerText(),
    /Runtime absent/i,
  );
  assert.equal(
    await busybox.page.locator('#ide-dk button[data-action="run-image"]').first().isDisabled(),
    true,
  );
  assert.match(await busybox.page.locator("#ide-dk-clist").innerText(), /stay locked/i);
  await busybox.page.locator("#ide-dk-pull").click();
  assert.match(await busybox.page.locator("#ide-dk-runtime").innerText(), /Live pull is unavailable/i);
  assert.match(await busybox.page.locator("#ide-dk-runtime").innerText(), /baked guest set/i);
  await busybox.page.locator("#ide-sb-net").click();
  await busybox.page.locator("#network-provider").selectOption("relay");
  const relayState = await busybox.page.evaluate(() => window.__dockerStateForTest());
  const relayText = await busybox.page.locator("#ide-dk-runtime").innerText();
  assert.equal(relayState.provider, "relay");
  assert.match(relayText, /provider relay/i);
  await busybox.page.locator("#network-provider").selectOption("offline");
  const offlineState = await busybox.page.evaluate(() => window.__dockerStateForTest());
  assert.equal(offlineState.provider, "offline");
  let busyboxBootConflict = null;
  if (haveAlpineAssets) {
    await busybox.page.locator("#ide-dk-boot-alpine").click();
    busyboxBootConflict = await waitForState(
      busybox.page,
      () => window.__dockerStateForTest?.().runtime === "error",
      30_000,
    );
    assert.match(await busybox.page.locator("#ide-dk-runtime-status").innerText(), /boot|owns|another guest/i);
  }
  scenarios.busyboxDegraded = {
    state: busyboxState,
    bootConflict: busyboxBootConflict,
    providerSwitch: { relayState, relayText, offlineState },
    consoleErrors: busybox.consoleErrors,
    failedRequests: busybox.failedRequests,
  };
  assert.deepEqual(busybox.consoleErrors, []);
  assert.deepEqual(busybox.failedRequests, []);
  await busybox.page.screenshot({ path: screenshotPath, fullPage: true });
  await busybox.page.context().close().catch(() => {});

  // Simulate a public build where the Alpine manifest is absent. The button and lifecycle rows
  // must remain disabled; no optimistic boot or runtime state is allowed.
  const publicBusybox = await newScenario("public-busybox-no-alpine", "&guest=busybox", async (page) => {
    await page.route("**/artifacts-alpine.json", (route) => route.fulfill({
      status: 404,
      contentType: "text/html",
      body: "<!doctype html><h1>404</h1>",
    }));
  });
  await publicBusybox.page.waitForFunction(
    () => {
      const state = window.__dockerStateForTest?.();
      return state?.alpineAssets === false && state?.alpineStatus === "absent";
    },
    undefined,
    { timeout: 30_000 },
  );
  const publicState = await publicBusybox.page.evaluate(() => window.__dockerStateForTest());
  assert.equal(publicState.alpineAssets, false);
  assert.equal(await publicBusybox.page.locator("#ide-dk-boot-alpine").isDisabled(), true);
  assert.match(await publicBusybox.page.locator("#ide-dk-boot-alpine").getAttribute("title"), /not deployed/i);
  assert.match(await publicBusybox.page.locator("#ide-dk-runtime-status").innerText(), /public busybox|catalog-only/i);
  assert.equal(
    await publicBusybox.page.locator('#ide-dk button[data-action="run-image"]').first().isDisabled(),
    true,
  );
  scenarios.publicBusybox = {
    state: publicState,
    consoleErrors: publicBusybox.consoleErrors,
    expectedConsoleErrors: publicBusybox.expectedConsoleErrors,
    failedRequests: publicBusybox.failedRequests,
  };
  assert(publicBusybox.expectedConsoleErrors.length > 0, "the missing Alpine manifest attack did not reach the browser");
  assert.deepEqual(publicBusybox.consoleErrors, []);
  // The deliberate 404 is the simulated public deployment condition, not a browser failure.
  assert.deepEqual(publicBusybox.failedRequests, []);
  await publicBusybox.page.context().close().catch(() => {});

  // With local Alpine artifacts, the Docker tab itself starts the real chunked guest. The default
  // restore path is used so this proof stays bounded while still crossing the actual boot bridge.
  if (!haveAlpineAssets) throw new Error("local Alpine artifacts are required for the in-tab boot proof");
  const alpine = await newScenario("alpine-in-tab", "&guest=alpine");
  await alpine.page.waitForFunction(
    () => window.__dockerStateForTest?.().alpineStatus === "present",
    undefined,
    { timeout: 30_000 },
  );
  assert.equal(await alpine.page.locator("#ide-dk-boot-alpine").isDisabled(), false);
  await alpine.page.locator("#ide-dk-boot-alpine").click();
  const alpineState = await waitForState(
    alpine.page,
    () => window.wvmDemo.isGuestReady?.() === true && window.__dockerStateForTest?.().runtime === "available",
    900_000,
  );
  assert.equal(alpineState.ready, true);
  assert.equal(alpineState.guestUp, true);
  assert.equal(alpineState.runtime, "available");
  assert.match(await alpine.page.locator("#ide-dk-runtime-status").innerText(), /Container runtime ready/i);
  assert.equal(await alpine.page.locator('#ide-dk button[data-action="run-image"]').first().isDisabled(), false);
  scenarios.alpineInTab = {
    state: alpineState,
    consoleErrors: alpine.consoleErrors,
    failedRequests: alpine.failedRequests,
  };
  assert.deepEqual(alpine.consoleErrors, []);
  assert.deepEqual(alpine.failedRequests, []);
  await alpine.page.screenshot({ path: screenshotPath, fullPage: true });
} catch (error) {
  proofError = error;
} finally {
  await Promise.all(contexts.map((context) => context.close().catch(() => {})));
  await browser.close().catch(() => {});
}

if (proofError) throw proofError;

const evidence = {
  generatedAt: new Date().toISOString(),
  base,
  browser: browserInfo,
  localAlpineAssets: haveAlpineAssets,
  scenarios,
  screenshot: path.relative(repo, screenshotPath),
};
await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
