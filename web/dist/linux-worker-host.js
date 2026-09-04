// E4-T32: page-side entry point for the whole-machine worker. The protocol module owns the
// allow-listed controller surface, byte ownership, fatal settlement, and stop/terminate ordering.
import { createLinuxWorkerClient } from "./linux-worker-protocol.js";

// Main-thread controllers do not own their outer storage lifecycle in stop(); whole-worker
// controllers do. Keep the page's destructive-reset/reboot path ordered and backend-neutral.
export async function stopLinuxController(controller) {
  if (!controller) return;
  let firstError = null;
  try { await controller.stop?.(); } catch (error) { firstError = error; }
  if (controller.backend !== "whole-machine-worker") {
    try { await controller.releaseWriterLock?.(); } catch (error) { firstError ??= error; }
    try { await controller.closeStorage?.(); } catch (error) { firstError ??= error; }
  }
  if (firstError) throw firstError;
}

export async function startLinuxBootWorker(opts = {}) {
  const WorkerCtor = opts.WorkerCtor ?? globalThis.Worker;
  if (typeof WorkerCtor !== "function") {
    throw new Error("whole-machine Web Worker is unavailable");
  }

  const worker = new WorkerCtor(new URL("./linux-worker.js", import.meta.url), {
    type: "module",
    name: "wasm-vm-linux",
  });

  // DOM/xterm callbacks stay on the page. Everything else is structured-clone boot data.
  const {
    onState = () => {},
    onProgress = () => {},
    onOutput = () => {},
    onError = () => {},
    onWriterStatus = () => {},
    onStorage = () => {},
    onQuota = () => {},
    onCaptureStart = () => {},
    onDisplayFrame = () => {},
    onTailscaleEvent = (message) => globalThis.__wasmVmTailscaleEvent?.(message),
    onWorker = () => {},
    workerHeartbeatIntervalMs,
    workerHeartbeatTimeoutMs,
    workerBootTimeoutMs,
    WorkerCtor: _ignored,
    ...dataOpts
  } = opts;
  try { onWorker(worker); } catch (error) {
    worker.terminate();
    throw error;
  }

  let detachVisibility = () => {};
  const client = createLinuxWorkerClient(worker, {
    onState,
    onProgress,
    onOutput,
    onError,
    onWriterStatus,
    onStorage,
    onQuota,
    onCaptureStart,
    onDisplayFrame,
    onTailscaleEvent,
    heartbeatIntervalMs: workerHeartbeatIntervalMs,
    heartbeatTimeoutMs: workerHeartbeatTimeoutMs,
    bootTimeoutMs: workerBootTimeoutMs,
    isHeartbeatSuspended: () => globalThis.document?.hidden === true,
    onTerminate: () => detachVisibility(),
  });
  if (globalThis.document?.addEventListener) {
    const onVisibility = () => client.setHeartbeatSuspended(globalThis.document.hidden);
    globalThis.document.addEventListener("visibilitychange", onVisibility);
    detachVisibility = () => globalThis.document.removeEventListener("visibilitychange", onVisibility);
    onVisibility();
  }
  worker.addEventListener?.("error", (event) => {
    client.fail(new Error(event?.message || "whole-machine worker error"));
  });
  worker.addEventListener?.("messageerror", () => {
    client.fail(new Error("whole-machine worker received an un-clonable message"));
  });
  return client.boot(dataOpts);
}
