#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const verifierDir = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(process.env.E5_T22G_REPO || path.join(verifierDir, "../../.."));
const webRoot = path.join(repo, "web");
const workerPath = path.join(verifierDir, "zero-time-worker.mjs");
const playwright = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "no-store",
};

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (pathname === "/") {
      response.writeHead(200, { ...isolationHeaders, "Content-Type": "text/html" });
      response.end("<!doctype html><title>E5-T22g verifier zero-time attack</title>");
      return;
    }
    if (pathname === "/zero-time-worker.mjs") {
      response.writeHead(200, { ...isolationHeaders, "Content-Type": "text/javascript" });
      response.end(await readFile(workerPath));
      return;
    }
    const file = path.resolve(webRoot, `.${pathname}`);
    if (!file.startsWith(`${webRoot}${path.sep}`)) throw new Error("outside web root");
    const data = await readFile(file);
    const ext = path.extname(file);
    response.writeHead(200, {
      ...isolationHeaders,
      "Content-Type": ext === ".wasm" ? "application/wasm" : ext === ".elf" ? "application/octet-stream" : "text/javascript",
    });
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

async function run(name, browserType, launchOptions = {}) {
  const browser = await browserType.launch({ headless: true, ...launchOptions });
  const page = await browser.newPage({ serviceWorkers: "block" });
  const diagnostics = [];
  page.on("console", (message) => diagnostics.push(`console:${message.type()}:${message.text()}`));
  page.on("requestfailed", (request) => diagnostics.push(`requestfailed:${request.url()}:${request.failure()?.errorText}`));
  page.on("response", (response) => {
    if (response.status() >= 400) diagnostics.push(`http:${response.status()}:${response.url()}`);
  });
  try {
    await page.goto(base);
    const envelope = await page.evaluate(() => new Promise((resolve, reject) => {
      const worker = new Worker("/zero-time-worker.mjs", { type: "module" });
      const timeout = setTimeout(() => reject(new Error("zero-time worker timeout")), 180_000);
      worker.onmessage = (event) => {
        clearTimeout(timeout);
        worker.terminate();
        resolve(event.data);
      };
      worker.onerror = (event) => {
        clearTimeout(timeout);
        worker.terminate();
        resolve({ ok: false, error: `${event.message} ${event.filename}:${event.lineno}:${event.colno}` });
      };
      worker.postMessage("verify");
    }));
    assert.equal(envelope.ok, true, `${envelope.error}\n${diagnostics.join("\n")}`);
    return { browser: name, version: browser.version(), ...envelope.result };
  } finally {
    await page.close();
    await browser.close();
  }
}

try {
  const results = [
    await run("chromium", playwright.chromium, { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }),
    await run("firefox", playwright.firefox),
  ];
  const artifact = { schema: "wasm-vm-e5-t22g-verifier-zero-time-v1", results };
  const output = `${JSON.stringify(artifact, null, 2)}\n`;
  await writeFile(path.join(verifierDir, "zero-time-results.json"), output);
  process.stdout.write(output);
} finally {
  server.close();
}
