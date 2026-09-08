// Bounded real-CDP proof for the persistent-context adapter used by F diagnostics.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "../../web/node_modules/playwright/index.mjs";
import { attachWorkerProfiler } from "./e5-t22c-cpu-profile.mjs";

test("persistent-context CDP adapter samples only the exact owned worker", { timeout: 30_000 }, async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), "e5-t26f-cpu-adapter-"));
  const server = createServer((req, res) => {
    if (req.url === "/worker.js") res.writeHead(200, { "Content-Type": "text/javascript" }).end(`
      function persistentCpuProbe() {
        const start = performance.now(); let value = 1;
        while (performance.now() - start < 300) value = Math.imul(value, 1664525) + 1013904223;
        return value;
      }
      self.onmessage = () => self.postMessage(persistentCpuProbe()); self.postMessage("ready");
    `);
    else res.writeHead(200, { "Content-Type": "text/html" }).end(
      '<script>window.worker=new Worker("/worker.js");worker.onmessage=e=>window.result=e.data;</script>');
  });
  let context, profiler;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    context = await chromium.launchPersistentContext(profile, {
      headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    });
    const page = context.pages()[0];
    const url = `http://127.0.0.1:${server.address().port}`;
    await page.goto(url);
    await page.waitForFunction(() => window.result === "ready");
    const identity = await context.newCDPSession(page);
    let version;
    try { version = (await identity.send("Browser.getVersion")).product; }
    finally { await identity.detach(); }
    const host = { newBrowserCDPSession: () => context.newCDPSession(page), version: () => version };
    await assert.rejects(() => attachWorkerProfiler(host, url + "/missing.js"), /exact owned worker/);
    profiler = await attachWorkerProfiler(host, url + "/worker.js");
    await profiler.start();
    await page.evaluate(() => worker.postMessage("burn"));
    await page.waitForFunction(() => typeof window.result === "number");
    const result = await profiler.stop();
    assert.equal(result.url, url + "/worker.js");
    assert.equal(result.browser, version);
    assert.ok(result.profile.samples.length > 10);
    assert.ok(result.profile.nodes.some(n => n.callFrame.functionName === "persistentCpuProbe" && n.hitCount > 0));
  } finally {
    await profiler?.close();
    await context?.close();
    await new Promise(resolve => server.close(resolve));
    // This exact directory was created above solely for the synthetic 300 ms worker test.
    await rm(profile, { recursive: true, force: true });
  }
});
