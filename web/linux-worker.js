// E4-T22 (pragmatic first cut): run the FULL WasmLinux boot — chunked disk, snapshot restore,
// node-alpine, IndexedDB overlay persistence — inside a dedicated Web Worker, OFF the main thread.
// This reuses the entire verified `startLinuxBoot` stack (loader.js is already worker-safe: it guards
// every `window`/`document` access). The CPU dispatch loop therefore no longer competes with page
// paint/input and is NOT subject to the main thread's setTimeout/background throttle — the measured
// cause of slow in-browser Node. No SharedArrayBuffer / COOP-COEP needed for this path.
//
// The full shared-guest-RAM design (cpu-worker.js + cpu-control-block.js) — which additionally lets the
// MAIN thread read guest memory zero-copy for the IDE/framebuffer — remains the follow-on. Here the
// console + input cross the worker boundary via postMessage, which is enough for interactive Node.
//
// Protocol (main ⇄ worker):
//   main → worker:  {type:"boot", opts}     serialisable startLinuxBoot opts (NO callbacks)
//                   {type:"input", bytes}   ArrayBuffer of console bytes → ctl.sendInput
//                   {type:"rpc", id, method, args}   invoke a controller method, reply "rpc-result"
//   worker → main:  {type:"state"|"progress"|"output"|"error"|"storage"|"writer"|"quota"|"ready"|"fatal"|"rpc-result"}
import { startLinuxBoot } from "./loader.js";

let ctl = null;

// ── Console-output batching: onOutput can fire per-byte; coalesce a tick's worth into one
//    transferable ArrayBuffer so we post O(ticks) messages, not O(bytes). ──
let outChunks = [];
let flushScheduled = false;
let __outCount = 0;
function flushOut() {
  flushScheduled = false;
  if (!outChunks.length) return;
  let n = 0;
  for (const c of outChunks) n += c.length;
  const merged = new Uint8Array(n);
  let o = 0;
  for (const c of outChunks) { merged.set(c, o); o += c.length; }
  outChunks = [];
  self.postMessage({ type: "output", buf: merged.buffer }, [merged.buffer]);
}
function pushOut(u8) {
  // Copy: u8 is a view into wasm memory that the next slice will overwrite.
  __outCount++;
  if (__outCount === 1) console.info("[cpu-worker] first onOutput (" + u8.length + " bytes)");
  outChunks.push(u8.slice());
  if (!flushScheduled) { flushScheduled = true; queueMicrotask(flushOut); }
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (!msg) return;

  if (msg.type === "boot") {
    try {
      console.info("[cpu-worker] calling startLinuxBoot mode=" + (msg.opts?.mode || "?"));
      ctl = await startLinuxBoot({
        // A worker has no page to keep smooth, so run a MUCH larger slice than the main-thread
        // default (500k) — far fewer yields ⇒ higher guest throughput. Still yields between slices
        // (MessageChannel) so input postMessages and IndexedDB drains are serviced.
        quantum: 20_000_000,
        ...msg.opts,
        onState: (s) => { console.info("[cpu-worker] state=" + s); self.postMessage({ type: "state", s }); },
        onProgress: (label, l, t) => self.postMessage({ type: "progress", label, l, t }),
        onOutput: (u8) => pushOut(u8),
        onError: (err) => self.postMessage({ type: "error", error: String(err?.message || err) }),
        onStorage: (info) => self.postMessage({ type: "storage", info }),
        onWriterStatus: (info) => self.postMessage({ type: "writer", info }),
        // Interactive quota dialog isn't bridged in this first cut; surface it and let the guest
        // continue (node-alpine restore writes ~KB). A full bridge is a follow-on.
        onQuota: (info) => self.postMessage({ type: "quota", info }),
      });
      flushOut();
      const restored = !!(ctl.restoredFromBootSnapshot && ctl.restoredFromBootSnapshot());
      console.info("[cpu-worker] boot returned; restored=" + restored + " outChunksSeen=" + __outCount);
      // Bridge the controller's `whenDone` promise (resolves on guest halt) back to the host proxy.
      if (ctl.whenDone && typeof ctl.whenDone.then === "function") {
        ctl.whenDone.then(
          (state) => self.postMessage({ type: "done", state }),
          (err) => self.postMessage({ type: "done", state: "error:" + (err?.message || err) }),
        );
      }
      self.postMessage({ type: "ready", restored });
    } catch (err) {
      self.postMessage({ type: "fatal", error: String(err?.stack || err?.message || err) });
    }
    return;
  }

  if (!ctl) return;

  if (msg.type === "input") {
    try { ctl.sendInput(new Uint8Array(msg.bytes)); } catch (err) { /* re-entrant/closed: drop */ }
    return;
  }

  if (msg.type === "rpc") {
    let res = null, err = null;
    try {
      const fn = ctl[msg.method];
      res = typeof fn === "function" ? await fn.apply(ctl, msg.args || []) : undefined;
    } catch (e2) { err = String(e2?.message || e2); }
    self.postMessage({ type: "rpc-result", id: msg.id, res, err });
    return;
  }
};

self.onmessageerror = () => self.postMessage({ type: "fatal", error: "worker received an un-clonable message" });
