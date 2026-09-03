// E4-T22d: the raw CPU-worker ABI. This intentionally uses a tiny wasm fixture so the test proves
// the worker boundary itself without booting Linux or depending on generated wasm-bindgen glue.
// T22e wires this same protocol to the WasmLinux controller.
import { test, expect } from "@playwright/test";

const SEQUENCE_MODULE =
  "AGFzbQEAAAABBQFgAAF/AhABA2VudgZtZW1vcnkCAwECAwIBAAYGAX8BQQALBw0BCXJ1bl9zbGljZQAACisBKQAjAEEBaiQAIwBBAUYEQEEAQSI2AgBBAA8LIwBBAkYEQEHoBw8LQX8L";
const NO_DISPATCH_MODULE = "AGFzbQEAAAACEAEDZW52Bm1lbW9yeQIDAQI=";
const RUNNING_MODULE =
  "AGFzbQEAAAABBQFgAAF/AhABA2VudgZtZW1vcnkCAwECAwIBAAcNAQlydW5fc2xpY2UAAAoGAQQAQQAL";

function pageErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(message.text());
    }
  });
  return errors;
}

async function openTestPage(page) {
  await page.goto("/?noAutoBoot=1&nosw");
  await expect.poll(() => page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);
}

test.describe("E4-T22d imported-memory CPU worker bootstrap", () => {
  test("handshakes, dispatches a slice, parks for WFI, wakes, and halts", async ({ page }) => {
    const errors = pageErrors(page);
    await openTestPage(page);
    const result = await page.evaluate(async (encoded) => {
      const binary = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
      const wasmModule = await WebAssembly.compile(binary);
      const sharedMemory = { initial: 1, maximum: 2, shared: true };
      const controlSab = new SharedArrayBuffer(64);
      const cells = new Int32Array(controlSab);
      const worker = new Worker("/cpu-worker.js", { type: "module" });
      const events = [];
      const waitFor = (type, timeoutMs = 5_000) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeoutMs);
          const onMessage = (event) => {
            events.push(event.data);
            if (event.data?.type === type) {
              clearTimeout(timer);
              worker.removeEventListener("message", onMessage);
              resolve(event.data);
            }
          };
          worker.addEventListener("message", onMessage);
          worker.addEventListener("error", (event) => {
            clearTimeout(timer);
            reject(new Error(event.message || "worker error"));
          }, { once: true });
        });

      worker.postMessage({
        type: "boot",
        wasmModule,
        sharedMemory,
        controlSab,
        bootParams: { jit: false, sliceInstrs: 1 },
      });
      const ready = await waitFor("ready");
      const parkDeadline = performance.now() + 5_000;
      while (Atomics.load(cells, 0) !== 2 && performance.now() < parkDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (Atomics.load(cells, 0) !== 2) throw new Error("worker did not enter WFI parked state");
      const markerBeforeWake = new Uint32Array(ready.memoryBuffer)[0];
      Atomics.add(cells, 1, 1);
      const wakeCount = Atomics.notify(cells, 1);
      const halted = await waitFor("halted");
      const state = Atomics.load(cells, 0);
      worker.terminate();
      return {
        ready,
        halted,
        markerBeforeWake,
        wakeCount,
        state,
        eventTypes: events.map((event) => event.type),
      };
    }, SEQUENCE_MODULE);

    expect(result.ready).toMatchObject({
      type: "ready",
      protocol: 1,
      dispatchExport: "run_slice",
      memoryShared: true,
      jit: false,
    });
    expect(result.markerBeforeWake).toBe(0x22);
    expect(result.wakeCount).toBeGreaterThanOrEqual(0);
    expect(result.halted).toEqual({ type: "halted" });
    expect(result.state).toBe(0);
    expect(result.eventTypes).toEqual(["ready", "halted"]);
    expect(errors).toEqual([]);
  });

  test("reports a missing dispatch export as one terminal fatal", async ({ page }) => {
    const errors = pageErrors(page);
    await openTestPage(page);
    const result = await page.evaluate(async (encoded) => {
      const binary = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
      const wasmModule = await WebAssembly.compile(binary);
      const sharedMemory = { initial: 1, maximum: 2, shared: true };
      const controlSab = new SharedArrayBuffer(64);
      const cells = new Int32Array(controlSab);
      const worker = new Worker("/cpu-worker.js", { type: "module" });
      const events = [];
      const terminal = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("worker fatal handshake timed out")), 5_000);
        worker.addEventListener("message", (event) => {
          events.push(event.data);
          if (event.data?.type === "fatal") {
            clearTimeout(timer);
            resolve(event.data);
          }
        });
        worker.addEventListener("error", (event) => {
          clearTimeout(timer);
          reject(new Error(event.message || "worker error"));
        }, { once: true });
      });
      worker.postMessage({ type: "boot", wasmModule, sharedMemory, controlSab, bootParams: {} });
      const fatal = await terminal;
      worker.terminate();
      return { fatal, state: Atomics.load(cells, 0), eventTypes: events.map((event) => event.type) };
    }, NO_DISPATCH_MODULE);

    expect(result.fatal.type).toBe("fatal");
    expect(result.fatal.error).toContain("no run_slice dispatch export");
    expect(result.state).toBe(3);
    expect(result.eventTypes).toEqual(["ready", "fatal"]);
    expect(errors).toEqual([]);
  });

  test("rejects malformed and non-shareable boots", async ({ page }) => {
    const errors = pageErrors(page);
    await openTestPage(page);
    const result = await page.evaluate(async (encoded) => {
      const binary = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
      const wasmModule = await WebAssembly.compile(binary);
      const waitForFatal = (worker, post) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("malformed boot did not fail")), 5_000);
        worker.addEventListener("message", (event) => {
          if (event.data?.type === "fatal") {
            clearTimeout(timer);
            resolve(event.data);
          }
        }, { once: false });
        worker.addEventListener("error", (event) => {
          clearTimeout(timer);
          reject(new Error(event.message || "worker error"));
        }, { once: true });
        worker.postMessage(post);
      });

      const malformedWorker = new Worker("/cpu-worker.js", { type: "module" });
      const malformed = await waitForFatal(malformedWorker, { type: "boot" });
      malformedWorker.terminate();

      const nonShareableWorker = new Worker("/cpu-worker.js", { type: "module" });
      const nonShareableControl = new SharedArrayBuffer(64);
      const nonShareable = await waitForFatal(nonShareableWorker, {
        type: "boot",
        wasmModule,
        sharedMemory: { initial: 1, maximum: 2, shared: false },
        controlSab: nonShareableControl,
        bootParams: {},
      });
      const state = Atomics.load(new Int32Array(nonShareableControl), 0);
      nonShareableWorker.terminate();
      return { malformed: malformed.type, nonShareable: nonShareable.type, state };
    }, SEQUENCE_MODULE);

    expect(result).toEqual({ malformed: "fatal", nonShareable: "fatal", state: 3 });
    expect(errors).toEqual([]);
  });

  test("turns a duplicate boot into one fatal terminal state", async ({ page }) => {
    const errors = pageErrors(page);
    await openTestPage(page);
    const result = await page.evaluate(async (encoded) => {
      const binary = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
      const wasmModule = await WebAssembly.compile(binary);
      const sharedMemory = { initial: 1, maximum: 2, shared: true };
      const controlSab = new SharedArrayBuffer(64);
      const cells = new Int32Array(controlSab);
      const worker = new Worker("/cpu-worker.js", { type: "module" });
      const events = [];
      const fatal = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("duplicate boot did not fail")), 5_000);
        worker.addEventListener("message", (event) => {
          events.push(event.data);
          if (event.data?.type === "fatal") {
            clearTimeout(timer);
            resolve(event.data);
          }
        });
      });
      const boot = { type: "boot", wasmModule, sharedMemory, controlSab, bootParams: {} };
      worker.postMessage(boot);
      worker.postMessage(boot);
      const terminal = await fatal;
      await new Promise((resolve) => setTimeout(resolve, 20));
      worker.terminate();
      return { terminal, state: Atomics.load(cells, 0), eventTypes: events.map((event) => event.type) };
    }, RUNNING_MODULE);

    expect(result.terminal.error).toContain("duplicate CPU worker boot");
    expect(result.state).toBe(3);
    expect(result.eventTypes.filter((type) => type === "fatal")).toHaveLength(1);
    expect(result.eventTypes).not.toContain("halted");
    expect(errors).toEqual([]);
  });

  test("bounds a killed worker before the ready handshake", async ({ page }) => {
    const errors = pageErrors(page);
    await openTestPage(page);
    const result = await page.evaluate(async (encoded) => {
      const binary = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
      const wasmModule = await WebAssembly.compile(binary);
      const sharedMemory = { initial: 1, maximum: 2, shared: true };
      const { bootCpuWorker } = await import("/cpu-worker-host.js");
      let fatalMessage = null;
      try {
        await bootCpuWorker({
          workerUrl: "/tests/fixtures/e4-t22d-worker-killed.js",
          wasm: wasmModule,
          sharedMemory,
          bootParams: {},
          bootTimeoutMs: 100,
          onFatal: (message) => { fatalMessage = message; },
        });
        return { resolved: true, fatalMessage };
      } catch (error) {
        return { resolved: false, message: error.message, fatalMessage };
      }
    }, SEQUENCE_MODULE);

    expect(result.resolved).toBe(false);
    expect(result.message).toContain("did not become ready within 100 ms");
    expect(result.fatalMessage).toContain("did not become ready within 100 ms");
    expect(errors).toEqual([]);
  });
});
