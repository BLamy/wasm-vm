// E4-T22g adversarial leg: the whole-machine worker remains usable when COOP/COEP headers are
// absent. The test starts a local static server when E4T22_NOHEADERS_URL is not supplied, so the
// acceptance command exercises the fallback deterministically on this machine.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const webRoot = path.join(repoRoot, "web");
const configuredBase = process.env.E4T22_NOHEADERS_URL?.replace(/\/+$/, "") || null;
let server;
let base;

const CONTENT_TYPES = {
  ".css": "text/css",
  ".elf": "application/octet-stream",
  ".gz": "application/gzip",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".snap": "application/octet-stream",
  ".wasm": "application/wasm",
};

function staticPath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl || "/", "http://127.0.0.1").pathname);
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const candidate = path.resolve(webRoot, relative);
  if (candidate !== webRoot && !candidate.startsWith(webRoot + path.sep)) return null;
  return candidate;
}

async function serve(request, response) {
  const filePath = staticPath(request.url);
  if (!filePath) {
    response.writeHead(403);
    response.end("forbidden");
    return;
  }
  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream",
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("not found");
  }
}

test.describe("whole-machine worker on a headerless host", () => {
  test.beforeAll(async () => {
    if (configuredBase) {
      base = configuredBase;
      return;
    }
    server = createServer((request, response) => { void serve(request, response); });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    base = "http://127.0.0.1:" + server.address().port;
  });

  test.afterAll(async () => {
    if (!server) return;
    await new Promise((resolve) => server.close(resolve));
  });

  test("blocked isolation shim keeps the explicit main-thread fallback clean", async ({ browser }) => {
    test.setTimeout(240_000);
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = [];
    const pageErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().toLowerCase().includes("favicon")) {
        errors.push(message.text());
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    try {
      await page.goto(base + "/?guest=busybox&worker=0&nosw&testHooks=1&jit=1&jitThreshold=512", {
        waitUntil: "domcontentloaded",
      });
      await page.waitForFunction(() => Boolean(globalThis.__cpuBackendSelection), null, {
        timeout: 30_000,
      });
      expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(false);
      const selection = await page.evaluate(() => globalThis.__cpuBackendSelection);
      expect(selection.backend).toBe("single-thread");
      expect(selection.wasmVariant).toBe("fallback");
      await page.waitForFunction(
        () => window.wvmDemo?.isGuestReady?.() === true && window.__linuxCtl,
        null,
        { timeout: 180_000 },
      );
      await page.waitForFunction(() => typeof window.__jitStats === "function", null, { timeout: 30_000 });
      const policy = await page.evaluate(async () => ({
        backend: document.documentElement.dataset.linuxBackend,
        jitPolicy: document.documentElement.dataset.jitPolicy,
        guest: document.documentElement.dataset.linuxGuest,
        restored: window.__linuxCtl.restoredFromBootSnapshot(),
        jit: await window.__jitStats(),
        scheduler: await window.__schedulerStats(),
      }));
      expect(policy.backend).toBe("main-thread");
      expect(policy.guest).toBe("busybox");
      expect(policy.restored).toBe(true);
      expect(policy.jitPolicy).toBe("unavailable-no-isolation");
      expect(policy.jit.hasExecutor).toBe(false);
      expect(policy.scheduler.retiredInstructions).toBeGreaterThan(0);
      const result = await page.evaluate(() => window.wvmDemo.run("echo E4T22G_NOHEADERS_$((6*7))", 30_000));
      expect(result.exit).toBe(0);
      expect(result.stdout).toContain("E4T22G_NOHEADERS_42");
      expect(errors).toEqual([]);
      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("active isolation shim reaches the shared worker after its second load", async ({ browser }) => {
    test.setTimeout(240_000);
    const context = await browser.newContext({ serviceWorkers: "allow" });
    const page = await context.newPage();
    const errors = [];
    const pageErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().toLowerCase().includes("favicon")) {
        errors.push(message.text());
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    try {
      await page.goto(base + "/?guest=busybox&nosw&testHooks=1&jit=0", {
        waitUntil: "domcontentloaded",
      });
      await page.waitForFunction(
        () => globalThis.crossOriginIsolated === true && Boolean(globalThis.__cpuBackendSelection),
        null,
        { timeout: 180_000 },
      );
      await page.waitForFunction(() => window.wvmDemo?.isGuestReady?.() === true && window.__linuxCtl, null, {
        timeout: 180_000,
      });
      const policy = await page.evaluate(async () => ({
        isolated: globalThis.crossOriginIsolated === true,
        controller: Boolean(navigator.serviceWorker?.controller),
        selection: globalThis.__cpuBackendSelection,
        backend: document.documentElement.dataset.linuxBackend,
        guest: document.documentElement.dataset.linuxGuest,
        restored: window.__linuxCtl.restoredFromBootSnapshot(),
        jitPolicy: document.documentElement.dataset.jitPolicy,
        digest: await window.__linuxCtl.stateDigest(),
      }));
      expect(policy.isolated).toBe(true);
      expect(policy.controller).toBe(true);
      expect(policy.selection.backend).toBe("worker-shared");
      expect(policy.backend).toBe("whole-machine-worker");
      expect(policy.guest).toBe("busybox");
      expect(policy.restored).toBe(true);
      expect(policy.jitPolicy).toBe("forced-off");
      expect(policy.digest).toMatch(/^[0-9a-f]{64}$/);
      const result = await page.evaluate(() => window.wvmDemo.run("echo E4T22G_SHIM_$((6*7))", 30_000));
      expect(result.exit).toBe(0);
      expect(result.stdout).toContain("E4T22G_SHIM_42");
      expect(errors).toEqual([]);
      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
