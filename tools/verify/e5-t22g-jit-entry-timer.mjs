#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const webRoot = path.join(repo, "web");
const workerPath = path.join(repo, "tools/verify/e5-t22g-jit-entry-timer-worker.mjs");
const out = path.resolve(process.env.E5_T22G_OUT || path.join(repo, "evidence/e5-t22g/browser"));
const chromePath = process.env.E5_T22G_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const mime = {
  ".elf": "application/octet-stream",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
};

function responseHeaders(type) {
  return {
    "Content-Type": type,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "no-store",
  };
}

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (pathname === "/") {
      response.writeHead(200, responseHeaders(mime[".html"]));
      response.end("<!doctype html><meta charset=utf-8><title>E5-T22g</title><body><h1>E5-T22g browser-JIT entry timer</h1><pre id=result>running…</pre>");
      return;
    }
    if (pathname === "/favicon.ico") {
      response.writeHead(204, responseHeaders("image/x-icon"));
      response.end();
      return;
    }
    if (pathname === "/e5-t22g-worker.mjs") {
      const source = await readFile(workerPath);
      response.writeHead(200, responseHeaders(mime[".mjs"]));
      response.end(source);
      return;
    }
    const file = path.resolve(webRoot, `.${pathname}`);
    if (!file.startsWith(`${webRoot}${path.sep}`)) {
      response.writeHead(404).end();
      return;
    }
    const data = await readFile(file);
    response.writeHead(200, responseHeaders(mime[path.extname(file)] || "application/octet-stream"));
    response.end(data);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const base = `http://127.0.0.1:${server.address().port}`;
const playwright = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));

async function runWorker(page, workerUrl) {
  return page.evaluate((url) => new Promise((resolve, reject) => {
    const worker = new Worker(url, { type: "module", name: "e5-t22g-entry-timer" });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("E5-T22g worker timed out"));
    }, 180_000);
    worker.onmessage = (event) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage("verify");
  }), workerUrl);
}

async function runBrowser(name, browserType, launchOptions = {}) {
  const browser = await browserType.launch({ headless: true, ...launchOptions });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  const consoleErrors = [];
  const pageErrors = [];
  const httpErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) {
      httpErrors.push({ status: response.status(), url: response.url() });
    }
  });
  try {
    await page.goto(base, { waitUntil: "load" });
    const envelope = await runWorker(page, "/e5-t22g-worker.mjs");
    assert.equal(envelope.ok, true, envelope.error);
    const sabotage = await runWorker(page, "/e5-t22g-worker.mjs?sabotage-default-on=1");
    assert.equal(sabotage.ok, false, "default-on sabotage escaped the profiling-off assertion");
    assert.match(sabotage.error, /default-off: timing unexpectedly enabled/);
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(httpErrors, []);

    const browserMeta = await page.evaluate(() => ({
      crossOriginIsolated,
      userAgent: navigator.userAgent,
    }));
    assert.equal(browserMeta.crossOriginIsolated, true);
    const summary = {
      browser: name,
      version: browser.version(),
      browserMeta,
      consoleErrors,
      pageErrors,
      httpErrors,
      sabotageGuard: sabotage.error,
      result: envelope.result,
    };
    await page.locator("#result").evaluate((node, value) => {
      node.textContent = JSON.stringify({
        browser: value.browser,
        version: value.version,
        realm: value.result.realm,
        phaseRuns: value.result.phaseRuns,
        fixedRetiredPerPhase: value.result.fixedRetiredPerPhase,
        defaultOff: value.result.defaultOff.after,
        enabled: value.result.enabledAfterExecutor.after,
        disabledAgain: value.result.disabledAfterEnable.after,
        parity: {
          ramDigest: value.result.finalParity.control.ramDigest,
          retired: value.result.finalParity.control.retired,
        },
        errors: [],
      }, null, 2);
    }, summary);
    await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
    return summary;
  } finally {
    await page.close();
    await browser.close();
  }
}

try {
  await mkdir(out, { recursive: true });
  const chromium = await runBrowser("chromium", playwright.chromium, { executablePath: chromePath });
  const firefox = await runBrowser("firefox", playwright.firefox);

  assert.equal(
    chromium.result.fixedRetiredPerPhase,
    firefox.result.fixedRetiredPerPhase,
    "fixed retirement differs across browsers",
  );
  assert.deepEqual(
    chromium.result.finalParity.control.registers,
    firefox.result.finalParity.control.registers,
    "architectural registers differ across browsers",
  );
  assert.equal(
    chromium.result.finalParity.control.ramDigest,
    firefox.result.finalParity.control.ramDigest,
    "RAM digest differs across browsers",
  );

  const proof = { schema: "wasm-vm-e5-t22g-browser-v1", chromium, firefox };
  await writeFile(path.join(out, "results.json"), `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify({
    browsers: [chromium.version, firefox.version],
    fixedRetiredPerPhase: chromium.result.fixedRetiredPerPhase,
    ramDigest: chromium.result.finalParity.control.ramDigest,
    defaultTimerReads: [
      chromium.result.defaultOff.after.timerReads,
      firefox.result.defaultOff.after.timerReads,
    ],
    enabledTimerReads: [
      chromium.result.enabledAfterExecutor.after.timerReads,
      firefox.result.enabledAfterExecutor.after.timerReads,
    ],
    errors: [],
  }));
} finally {
  server.close();
}
