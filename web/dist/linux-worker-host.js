// E4-T22 (pragmatic first cut) — main-thread side of the CPU-on-a-worker bridge. `startLinuxBootWorker`
// is a drop-in for loader.js `startLinuxBoot`: SAME opts (callbacks + data) and SAME returned controller
// shape, but the heavy `startLinuxBoot` work runs inside linux-worker.js off the main thread. Callbacks
// stay main-side (they touch the DOM/xterm); the worker relays their invocations over postMessage, and
// the returned controller proxies method calls back to the worker.
//
// Why: the interpreter/JIT dispatch loop no longer shares the main thread with page paint/input and is
// not subject to the setTimeout/background-tab throttle — the measured cause of slow in-browser Node.

export async function startLinuxBootWorker(opts = {}) {
  const worker = new Worker(new URL("./linux-worker.js", import.meta.url), {
    type: "module",
    name: "wasm-vm-cpu",
  });

  // Callbacks are NOT structured-cloneable — keep them main-side; only the data opts cross to the worker.
  const {
    onState = () => {},
    onProgress = () => {},
    onOutput = () => {},
    onError = () => {},
    onWriterStatus = () => {},
    onStorage = () => {},
    onQuota = () => {},
    ...dataOpts
  } = opts;

  let restoredCache = false;
  let readyResolve;
  const ready = new Promise((r) => { readyResolve = r; });
  // `whenDone` is a PROMISE property on the controller (resolves when the guest halts), not a method —
  // consumers do `linuxCtl.whenDone.then(...)`. Bridge it so the proxy exposes a real thenable.
  let doneResolve;
  const whenDone = new Promise((r) => { doneResolve = r; });
  const rpcPending = new Map();
  let rpcSeq = 0;
  let fatalErr = null;

  worker.onmessage = (e) => {
    const m = e.data;
    if (!m) return;
    switch (m.type) {
      case "state": onState(m.s); break;
      case "progress": onProgress(m.label, m.l, m.t); break;
      case "output": { if (!worker.__gotOut) { worker.__gotOut = true; console.info("[cpu-worker-host] first output " + m.buf.byteLength + "B → onOutput"); } onOutput(new Uint8Array(m.buf)); break; }
      case "error": onError(new Error(m.error)); break;
      case "storage": onStorage(m.info); break;
      case "writer": onWriterStatus(m.info); break;
      case "quota": onQuota(m.info); break;
      case "ready": restoredCache = !!m.restored; console.info("[cpu-worker-host] ready restored=" + restoredCache); readyResolve(); break;
      case "done": doneResolve(m.state); break;
      case "fatal":
        fatalErr = new Error(m.error);
        onError(fatalErr);
        readyResolve();
        break;
      case "rpc-result": {
        const p = rpcPending.get(m.id);
        if (p) { rpcPending.delete(m.id); m.err ? p.reject(new Error(m.err)) : p.resolve(m.res); }
        break;
      }
    }
  };
  worker.onerror = (ev) => {
    fatalErr = new Error(ev.message || "cpu worker error");
    onError(fatalErr);
    readyResolve();
  };

  worker.postMessage({ type: "boot", opts: dataOpts });
  await ready;
  if (fatalErr) throw fatalErr;

  const rpc = (method, args = []) =>
    new Promise((resolve, reject) => {
      const id = ++rpcSeq;
      // Function arguments (callbacks) can't be structured-cloned across the worker boundary — such
      // methods aren't bridged in this first cut. Strip them to null and guard the postMessage so a
      // non-cloneable arg resolves to undefined instead of throwing a DataCloneError that would crash
      // the whole boot (which previously left window.__linuxCtl unset and the guest "not up").
      const safeArgs = Array.isArray(args) ? args.map((a) => (typeof a === "function" ? null : a)) : args;
      rpcPending.set(id, { resolve, reject });
      try {
        worker.postMessage({ type: "rpc", id, method, args: safeArgs });
      } catch {
        rpcPending.delete(id);
        resolve(undefined);
      }
    });

  // Controller proxy — same surface main.js/loader consumers use. A few methods have local semantics
  // (fire-and-forget input, cached restore flag, terminate); EVERY other property resolves to an async
  // RPC that invokes the real controller method inside the worker. Using a JS Proxy means main.js can
  // call ANY controller method (fetchStats, persistPending, hasUnpersisted, saveSnapshot…) and it
  // forwards correctly as a promise — no per-method allow-list to drift out of sync (which previously
  // surfaced as `cannot read properties of undefined (reading 'then')` for an unlisted method).
  const local = {
    sendInput(bytes) {
      const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const copy = b.slice().buffer; // transfer a private copy
      worker.postMessage({ type: "input", bytes: copy }, [copy]);
    },
    // Known synchronously at boot from the worker's "ready" message (main.js calls this right after boot).
    restoredFromBootSnapshot: () => restoredCache,
    // Promise property (not a method) — resolves when the guest halts.
    whenDone,
    stop() { try { worker.terminate(); } catch { /* already gone */ } },
    _worker: worker,
  };
  return new Proxy(local, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop !== "string") return undefined;
      // Any other controller method → async RPC into the worker's real controller.
      return (...args) => rpc(prop, args);
    },
  });
}
