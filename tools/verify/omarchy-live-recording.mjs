// Harness-only observers. They do not supply guest input, output, pixels or readiness.
import { createHash } from "node:crypto";
import path from "node:path";

export function servedIdentity({ pathname, method, filename, bytes, repoRoot }) {
  return { pathname, method, status: 200, size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    repoPath: filename ? path.relative(repoRoot, filename) : null,
    timestamp: new Date().toISOString() };
}

// Self-contained so Playwright can install the same observer before application code.
export function installWireEvidence() {
  const evidence = globalThis.__omarchyWireEvidence = { inputEvents: [], workerTraffic: [] };
  const stamp = () => ({ timestamp: new Date().toISOString(), ms: performance.now() });
  for (const type of ["keydown", "keyup"]) globalThis.addEventListener(type, event => {
    evidence.inputEvents.push({ ...stamp(), type, code: event.code, key: event.key,
      trusted: event.isTrusted, repeat: event.repeat, target: event.target?.id || "",
      activeElement: document.activeElement?.id || "" });
  }, true);
  const workers = new WeakMap();
  let workerSequence = 0;
  const original = Worker.prototype.postMessage;
  const summarize = value => {
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return { binaryBytes: value.byteLength };
    if (Array.isArray(value)) return value.map(summarize);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, summarize(v)]));
    return value;
  };
  Worker.prototype.postMessage = function (message, ...rest) {
    let worker = workers.get(this);
    if (!worker) {
      worker = ++workerSequence; workers.set(this, worker);
      const decoder = new TextDecoder();
      const calls = new Map();
      this.addEventListener("message", event => {
        const data = event.data;
        if (data?.type === "output") {
          evidence.workerTraffic.push({ ...stamp(), worker, type: "serial-output",
            text: decoder.decode(new Uint8Array(data.buffer), { stream: true }) });
        } else if (data?.type === "result" && calls.has(data.id)) {
          evidence.workerTraffic.push({ ...stamp(), worker, type: "input-result",
            id: data.id, method: calls.get(data.id), result: data.result, error: data.error ?? null });
          calls.delete(data.id);
        } else if (["fatal", "error"].includes(data?.type)) {
          evidence.workerTraffic.push({ ...stamp(), worker, type: data.type, error: String(data.error) });
        }
      });
      // Keep a per-worker reference only for associating actual input acknowledgements.
      workers.set(this, { id: worker, calls });
    }
    const tracked = workers.get(this);
    const id = tracked.id;
    let record = null;
    if (message?.type === "input") {
      record = { ...stamp(), worker: id, type: "serial-input", bytes: Array.from(new Uint8Array(message.bytes)) };
    } else if (message?.type === "call") {
      record = { ...stamp(), worker: id, type: "worker-call", id: message.id,
        method: message.method, args: summarize(message.args) };
      if (["sendKeyboardEvent", "syncKeyboard", "sendTabletEvent", "syncTablet", "sendMouseEvent", "syncMouse"].includes(message.method)) {
        tracked.calls.set(message.id, message.method);
      }
    } else if (message?.type === "boot") {
      record = { ...stamp(), worker: id, type: "worker-boot" };
    }
    // Snapshot transferables above; forward the original object and transfer list exactly once.
    try {
      const result = original.call(this, message, ...rest);
      if (record) evidence.workerTraffic.push({ ...record, sent: true });
      return result;
    } catch (error) {
      if (record) evidence.workerTraffic.push({ ...record, sent: false, error: String(error) });
      throw error;
    }
  };
}
