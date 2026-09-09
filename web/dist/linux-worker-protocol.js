// E4-T32: explicit, versioned protocol for the whole-machine Linux worker.
//
// Keep this module pure: it is imported by the page, the Worker, and Node protocol tests. The
// controller surface is deliberately an allow-list. Adding a loader controller method therefore
// requires an intentional protocol change instead of silently exposing arbitrary worker objects.

export const LINUX_WORKER_PROTOCOL_VERSION = 1;
export const MAX_OUTPUT_BATCH_BYTES = 64 * 1024;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_CLEANUP_TIMEOUT_MS = 4_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 2_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 10_000;
const DEFAULT_BOOT_TIMEOUT_MS = 180_000;
// Full architectural hashing and snapshot serialization/copying walk guest RAM synchronously. They
// are explicit bulk operations rather than the execution scheduler, so announce only these known
// methods to the page watchdog and give each a separate finite deadline. Ordinary runChunk/input/RPC
// stalls retain the strict 10s watchdog.
const LONG_RPC_GRACE_MS = Object.freeze({
  stateDigest: 60_000,
  snapshotSave: 120_000,
  snapshotRead: 120_000,
  snapshotDecision: 60_000,
  snapshotExport: 120_000,
  snapshotRestore: 120_000,
  snapshotImport: 120_000,
  saveDesktopSnapshot: 120_000,
  restoreDesktopSnapshot: 120_000,
  terminalStateDigest: 60_000,
});

export const LINUX_CONTROLLER_METHODS = Object.freeze([
  "setDisplay",
  "displayStats",
  "sendKeyboardEvent",
  "syncKeyboard",
  "sendTabletEvent",
  "syncTablet",
  "sendMouseEvent",
  "syncMouse",
  "keyboardLedState",
  "pause",
  "resume",
  "isPaused",
  "stateDigest",
  "saveDesktopSnapshot",
  "confirmAgentHello",
  "sendAgentInput",
  "takeAgentOutput",
  "restoreDesktopSnapshot",
  "dhcpStats",
  "fileTransferReady",
  "setFileDownloadReady",
  "beginFileUpload",
  "pushFileUpload",
  "cancelFileUpload",
  "dismissFileUpload",
  "cancelFileDownload",
  "finishFileDownload",
  "fileTransferStatus",
  "takeFileDownloadChunk",
  "dismissFileDownload",
  "fetchStats",
  "persist",
  "persistStats",
  "readOnly",
  "overlaySeedIdentity",
  "audioOutputReady",
  "audioCaptureReady",
  "captureState",
  "notifyCaptureEvent",
  "resumeAfterQuota",
  "continueReadOnly",
  "hasUnpersisted",
  "snapshotSave",
  "snapshotRead",
  "snapshotDecision",
  "storedSnapshotRestoreEvidence",
  "snapshotAdvanceGen",
  "snapshotGeneration",
  "snapshotExport",
  "snapshotRestore",
  "snapshotImport",
  "storageEstimate",
  "closeStorage",
  "releaseWriterLock",
  "jitStats",
  "profileStats",
  "schedulerStats",
  "guestClockState",
  "icountDividerSelection",
  "tailscaleCommand",
]);

const METHOD_SET = new Set(LINUX_CONTROLLER_METHODS);
const BYTE_ARG = Object.freeze({
  pushFileUpload: 1,
  snapshotImport: 0,
  restoreDesktopSnapshot: 0,
  sendAgentInput: 0,
});
const BYTE_RESULT = new Set([
  "takeFileDownloadChunk",
  "snapshotRead",
  "snapshotExport",
  "saveDesktopSnapshot",
  "takeAgentOutput",
]);

function errorFrom(value, fallback = "Linux worker failed") {
  if (value instanceof Error) return value;
  return new Error(typeof value === "string" && value ? value : fallback);
}

/** Return an exact, privately-owned Uint8Array (never the caller's backing buffer). */
export function privateBytes(value) {
  if (value == null) return new Uint8Array();
  const view = value instanceof Uint8Array
    ? value
    : ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : new Uint8Array(value);
  return view.slice();
}

function post(endpoint, message, transfer = []) {
  endpoint.postMessage(message, transfer);
}

function listen(endpoint, handler) {
  if (typeof endpoint.addEventListener === "function") {
    endpoint.addEventListener("message", handler);
    endpoint.start?.();
    return () => endpoint.removeEventListener?.("message", handler);
  }
  endpoint.onmessage = handler;
  return () => {
    if (endpoint.onmessage === handler) endpoint.onmessage = null;
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  // Fatal paths may settle whenDone before a consumer attaches. Mark it handled without changing
  // the promise exposed to callers, avoiding a noisy global unhandled-rejection report.
  promise.catch(() => {});
  return { promise, resolve, reject, settled: false };
}

/**
 * Page-side protocol client. `boot()` resolves to the explicit async controller.
 *
 * The Worker object is injected so deterministic Node tests can use a structured-clone endpoint.
 */
export function createLinuxWorkerClient(endpoint, callbacks = {}) {
  const booted = deferred();
  const done = deferred();
  const pending = new Map();
  let seq = 0;
  let fatal = null;
  let stopped = false;
  let restored = false;
  let errorReported = false;
  let terminated = false;
  let rpcCalls = 0;
  let rpcCompleted = 0;
  let rpcTotalMs = 0;
  let rpcMaxMs = 0;
  let heartbeatTimer = null;
  let bootTimer = null;
  let bootDeadline = 0;
  let bootSuspendedAt = 0;
  let bootPosted = false;
  let heartbeatSuspended = false;
  let lastHeardAt = 0;
  let longRpcId = null;
  let longRpcDeadline = 0;
  let longRpcMethod = null;
  let longRpcSuspendedAt = 0;
  const stopTimeoutMs = Math.max(1, Number(callbacks.stopTimeoutMs) || DEFAULT_STOP_TIMEOUT_MS);
  const heartbeatIntervalMs = Math.max(
    1,
    Number(callbacks.heartbeatIntervalMs) || DEFAULT_HEARTBEAT_INTERVAL_MS,
  );
  const heartbeatTimeoutMs = Math.max(
    heartbeatIntervalMs,
    Number(callbacks.heartbeatTimeoutMs) || DEFAULT_HEARTBEAT_TIMEOUT_MS,
  );
  const bootTimeoutMs = Math.max(1, Number(callbacks.bootTimeoutMs) || DEFAULT_BOOT_TIMEOUT_MS);
  const longRpcGraceMs = Object.freeze({
    ...LONG_RPC_GRACE_MS,
    ...(callbacks.longRpcGraceMs ?? {}),
  });
  const now = () => typeof performance !== "undefined" ? performance.now() : Date.now();

  const terminate = () => {
    if (terminated) return;
    terminated = true;
    if (heartbeatTimer != null) clearInterval(heartbeatTimer);
    if (bootTimer != null) clearTimeout(bootTimer);
    try { callbacks.onTerminate?.(); } catch { /* lifecycle diagnostic only */ }
    try { endpoint.terminate?.(); } catch { /* already terminated */ }
  };

  const reportError = (error) => {
    if (errorReported) return;
    errorReported = true;
    try { callbacks.onError?.(error); } catch { /* error reporting cannot block fatal settlement */ }
  };

  const settleDone = (kind, value) => {
    if (done.settled) return;
    done.settled = true;
    done[kind](value);
  };

  const armBootTimeout = () => {
    if (bootTimer != null) clearTimeout(bootTimer);
    bootTimer = null;
    if (!bootPosted || booted.settled || fatal || heartbeatSuspended) return;
    const remaining = bootDeadline - now();
    if (remaining <= 0) {
      fail(new Error(`Linux worker boot timed out after ${bootTimeoutMs}ms`));
      return;
    }
    bootTimer = setTimeout(() => {
      fail(new Error(`Linux worker boot timed out after ${bootTimeoutMs}ms`));
    }, remaining);
  };

  const fail = (reason) => {
    if (fatal) return;
    fatal = errorFrom(reason);
    reportError(fatal);
    if (!booted.settled) {
      booted.settled = true;
      booted.reject(fatal);
    }
    for (const request of pending.values()) request.reject(fatal);
    pending.clear();
    settleDone("reject", fatal);
    terminate();
  };

  const startHeartbeat = () => {
    if (heartbeatTimer != null) return;
    lastHeardAt = now();
    heartbeatTimer = setInterval(() => {
      let suspended = heartbeatSuspended;
      try { suspended ||= callbacks.isHeartbeatSuspended?.() === true; } catch { /* keep watchdog live */ }
      if (suspended) {
        lastHeardAt = now();
        return;
      }
      const current = now();
      if (longRpcId != null) {
        if (current <= longRpcDeadline) return;
        fail(new Error(`Linux worker ${longRpcMethod} exceeded its bounded grace period`));
        return;
      }
      const silentMs = current - lastHeardAt;
      if (silentMs > heartbeatTimeoutMs) {
        fail(new Error(`Linux worker heartbeat timed out after ${Math.round(silentMs)}ms`));
        return;
      }
      try {
        post(endpoint, {
          type: "ping",
          version: LINUX_WORKER_PROTOCOL_VERSION,
        });
      } catch (error) {
        fail(error);
      }
    }, heartbeatIntervalMs);
  };

  const onMessage = (event) => {
    const message = event?.data;
    if (!message || message.version !== LINUX_WORKER_PROTOCOL_VERSION) {
      fail(`Linux worker protocol version mismatch (expected ${LINUX_WORKER_PROTOCOL_VERSION})`);
      return;
    }
    lastHeardAt = now();
    switch (message.type) {
      case "state": callbacks.onState?.(message.state); break;
      case "progress": callbacks.onProgress?.(message.label, message.loaded, message.total); break;
      case "output": callbacks.onOutput?.(new Uint8Array(message.buffer)); break;
      case "agent": {
        if (!(message.buffer instanceof ArrayBuffer)) {
          fail(new Error("invalid Linux worker agent frame"));
          break;
        }
        callbacks.onAgentOutput?.(new Uint8Array(message.buffer));
        break;
      }
      case "storage": callbacks.onStorage?.(message.info); break;
      case "writer": callbacks.onWriterStatus?.(message.info); break;
      case "quota": callbacks.onQuota?.(message.info); break;
      case "capture-start": callbacks.onCaptureStart?.(message.info); break;
      case "display": {
        const frame = message.frame;
        if (frame?.type === "clear") {
          callbacks.onDisplayFrame?.({ type: "clear" });
          break;
        }
        if (!frame || !(frame.pixels instanceof ArrayBuffer)) {
          fail(new Error("invalid Linux worker display frame"));
          break;
        }
        callbacks.onDisplayFrame?.({
          scanout: frame.scanout ?? null,
          format: frame.format ?? 1,
          rect: frame.rect,
          resourceWidth: frame.resourceWidth,
          resourceHeight: frame.resourceHeight,
          pixels: new Uint32Array(frame.pixels),
        });
        break;
      }
      case "cursor": {
        const frame = message.frame;
        if (!frame || (frame.type !== "cursor-update" && frame.type !== "cursor-move")
            || !frame.state || !(frame.pixels instanceof ArrayBuffer)) {
          fail(new Error("invalid Linux worker cursor frame"));
          break;
        }
        callbacks.onCursorState?.({
          type: frame.type,
          state: frame.state,
          format: frame.format ?? null,
          resourceWidth: frame.resourceWidth,
          resourceHeight: frame.resourceHeight,
          pixels: new Uint32Array(frame.pixels),
        });
        break;
      }
      case "tailscale-event":
        // Tailscale status persistence is ancillary UI work. localStorage/security failures must not
        // terminate the emulated machine or poison the controller protocol.
        try { callbacks.onTailscaleEvent?.(message.message); } catch (error) {
          try { callbacks.onTailscaleError?.(error); } catch { /* diagnostic only */ }
        }
        break;
      case "busy": {
        const request = pending.get(message.id);
        const grace = Number(longRpcGraceMs[message.method]);
        const lifecycle = message.id === 0 && message.method === "terminalStateDigest";
        if (longRpcId != null || (!lifecycle && (!request || request.method !== message.method)) || !grace) {
          fail(new Error(`invalid Linux worker busy frame for ${String(message.method)}`));
          break;
        }
        longRpcId = message.id;
        longRpcMethod = message.method;
        longRpcDeadline = now() + grace;
        longRpcSuspendedAt = heartbeatSuspended ? now() : 0;
        break;
      }
      case "idle":
        if (message.id !== longRpcId || message.method !== longRpcMethod) {
          fail(new Error(`invalid Linux worker idle frame for ${String(message.method)}`));
          break;
        }
        longRpcId = null;
        longRpcMethod = null;
        longRpcDeadline = 0;
        longRpcSuspendedAt = 0;
        break;
      case "pong": break;
      case "error": reportError(errorFrom(message.error)); break;
      case "ready":
        if (bootTimer != null) clearTimeout(bootTimer);
        bootTimer = null;
        bootDeadline = 0;
        bootSuspendedAt = 0;
        restored = Boolean(message.restored);
        if (!booted.settled) {
          booted.settled = true;
          booted.resolve(controller);
          startHeartbeat();
        }
        break;
      case "done": {
        if (!booted.settled) {
          fail(new Error("Linux worker completed before ready"));
          break;
        }
        const stopRequested = stopped;
        stopped = true;
        const completed = new Error(`Linux worker completed: ${String(message.state)}`);
        for (const [id, request] of pending) {
          // Explicit stop sends DONE immediately before its correlated result; retain only that one
          // request so clean stop can finish, while no unrelated RPC survives termination.
          if (stopRequested && request.method === "stop-internal") continue;
          request.reject(completed);
          pending.delete(id);
        }
        settleDone("resolve", message.state);
        if (!stopRequested) terminate();
        break;
      }
      case "fatal": fail(message.error); break;
      case "result": {
        const request = pending.get(message.id);
        if (!request) break;
        pending.delete(message.id);
        const elapsed = now() - request.startedAt;
        rpcCompleted += 1;
        rpcTotalMs += elapsed;
        rpcMaxMs = Math.max(rpcMaxMs, elapsed);
        if (message.error) request.reject(errorFrom(message.error));
        else if (message.bytes) request.resolve(new Uint8Array(message.result));
        else request.resolve(message.result);
        break;
      }
      default: fail(`unknown Linux worker message: ${String(message.type)}`);
    }
  };
  const unlisten = listen(endpoint, (event) => {
    try { onMessage(event); } catch (error) { fail(error); }
  });

  const rpc = (method, args = []) => {
    if (method !== "stop-internal" && !METHOD_SET.has(method)) {
      return Promise.reject(new Error(`unknown Linux worker method: ${method}`));
    }
    if (fatal) return Promise.reject(fatal);
    if (stopped && method !== "stop-internal") {
      return Promise.reject(new Error("Linux worker is stopped"));
    }
    return new Promise((resolve, reject) => {
      // Encoding lives inside the Promise constructor so a detached/invalid byte view is an async
      // rejection, never a synchronous exception from an otherwise-Promise controller method.
      const encoded = [...args];
      const transfer = [];
      const byteIndex = BYTE_ARG[method];
      if (byteIndex != null) {
        const bytes = privateBytes(encoded[byteIndex]);
        encoded[byteIndex] = bytes.buffer;
        transfer.push(bytes.buffer);
      }
      const id = ++seq;
      rpcCalls += 1;
      pending.set(id, { resolve, reject, method, startedAt: now() });
      try {
        post(endpoint, {
          type: "call",
          version: LINUX_WORKER_PROTOCOL_VERSION,
          id,
          method,
          args: encoded,
        }, transfer);
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  };

  const controller = {
    backend: "whole-machine-worker",
    sendInput(value) {
      if (fatal || stopped) return false;
      const bytes = privateBytes(value);
      post(endpoint, {
        type: "input",
        version: LINUX_WORKER_PROTOCOL_VERSION,
        bytes: bytes.buffer,
      }, [bytes.buffer]);
      return true;
    },
    restoredFromBootSnapshot: () => restored,
    workerRpcStats: async () => {
      if (fatal) throw fatal;
      if (stopped) throw new Error("Linux worker is stopped");
      return {
        calls: rpcCalls,
        completed: rpcCompleted,
        pending: pending.size,
        averageMs: rpcCompleted ? rpcTotalMs / rpcCompleted : 0,
        maxMs: rpcMaxMs,
      };
    },
    whenDone: done.promise,
    async stop() {
      if (stopped) return done.promise;
      stopped = true;
      let timer;
      try {
        // Worker runtime owns the required order: inner stop → release lock → close storage → done.
        await Promise.race([
          rpc("stop-internal"),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Linux worker stop timed out after ${stopTimeoutMs}ms`)), stopTimeoutMs);
          }),
        ]);
      } catch (error) {
        fail(error);
        throw error;
      } finally {
        clearTimeout(timer);
        terminate();
        unlisten();
      }
      return done.promise;
    },
  };
  for (const method of LINUX_CONTROLLER_METHODS) {
    controller[method] = (...args) => rpc(method, args);
  }

  return {
    controller,
    boot(opts) {
      if (fatal) return Promise.reject(fatal);
      if (bootPosted) return Promise.reject(new Error("Linux worker boot already started"));
      bootPosted = true;
      bootDeadline = now() + bootTimeoutMs;
      bootSuspendedAt = heartbeatSuspended ? now() : 0;
      armBootTimeout();
      try {
        post(endpoint, {
          type: "boot",
          version: LINUX_WORKER_PROTOCOL_VERSION,
          opts,
        });
      } catch (error) {
        fail(error);
      }
      return booted.promise;
    },
    setHeartbeatSuspended(value) {
      const suspended = Boolean(value);
      const current = now();
      if (suspended === heartbeatSuspended) {
        lastHeardAt = current;
        return;
      }
      heartbeatSuspended = suspended;
      if (suspended) {
        if (bootPosted && !booted.settled) {
          bootSuspendedAt = current;
          if (bootTimer != null) clearTimeout(bootTimer);
          bootTimer = null;
        }
        if (longRpcId != null) longRpcSuspendedAt = current;
      } else {
        if (bootSuspendedAt) {
          bootDeadline += current - bootSuspendedAt;
          bootSuspendedAt = 0;
        }
        if (longRpcSuspendedAt) {
          longRpcDeadline += current - longRpcSuspendedAt;
          longRpcSuspendedAt = 0;
        }
        armBootTimeout();
      }
      // Visibility transitions provide an explicit grace edge even when page timers were throttled
      // for much longer than the production timeout.
      lastHeardAt = current;
    },
    fail,
  };
}

/**
 * Worker-side FIFO runtime. The caller supplies the real loader and optional Tailscale command.
 * Every input/call is serialized behind boot; no RPC can overtake a prior input message.
 */
export function createLinuxWorkerRuntime(endpoint, {
  startBoot,
  tailscaleCommand = () => false,
  cleanupTimeoutMs = DEFAULT_CLEANUP_TIMEOUT_MS,
} = {}) {
  let controller = null;
  let bootStarted = false;
  let fatal = null;
  let doneSent = false;
  let stopping = false;
  let terminalizing = false;
  let chain = Promise.resolve();
  let outputParts = [];
  let outputBytes = 0;
  let outputScheduled = false;
  let innerStopPromise = null;
  let cleanupPromise = null;
  let fatalPromise = null;
  let terminalPromise = null;
  const boundedCleanupMs = Math.max(1, Number(cleanupTimeoutMs) || DEFAULT_CLEANUP_TIMEOUT_MS);

  const send = (message, transfer = []) => post(endpoint, {
    ...message,
    version: LINUX_WORKER_PROTOCOL_VERSION,
  }, transfer);

  const sendDone = (state) => {
    if (doneSent) return;
    doneSent = true;
    send({ type: "done", state });
  };

  const flushOutput = () => {
    outputScheduled = false;
    while (outputBytes > 0) {
      const size = Math.min(outputBytes, MAX_OUTPUT_BATCH_BYTES);
      const batch = new Uint8Array(size);
      let offset = 0;
      while (offset < size) {
        const head = outputParts[0];
        const take = Math.min(head.byteLength, size - offset);
        batch.set(head.subarray(0, take), offset);
        offset += take;
        outputBytes -= take;
        if (take === head.byteLength) outputParts.shift();
        else outputParts[0] = head.slice(take);
      }
      send({ type: "output", buffer: batch.buffer }, [batch.buffer]);
    }
  };

  const settleCleanup = async (operation) => {
    let timer;
    try {
      await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Linux worker cleanup timed out")), boundedCleanupMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };

  const stopInner = () => {
    if (!controller) return Promise.resolve();
    if (!innerStopPromise) {
      innerStopPromise = settleCleanup(() => controller.stop?.());
    }
    return innerStopPromise;
  };

  const cleanup = () => {
    if (!controller) return Promise.resolve();
    if (!cleanupPromise) cleanupPromise = (async () => {
      // The loader may still be awaiting a lazy fetch or persistence transaction. `stop()` is its
      // quiescence barrier; storage ownership cannot be released before that active pump settles.
      // If bounded stop fails, fail closed: the page will terminate this Worker, whose realm
      // teardown is the only safe reclamation boundary. Never close storage under a live pump.
      await stopInner();
      try { await settleCleanup(() => controller.releaseWriterLock?.()); } catch { /* bounded best effort */ }
      try { await settleCleanup(() => controller.closeStorage?.()); } catch { /* bounded best effort */ }
    })();
    return cleanupPromise;
  };

  const fail = (reason) => {
    if (fatal) return fatalPromise ?? Promise.resolve();
    fatal = errorFrom(reason);
    fatalPromise = (async () => {
      try { await cleanup(); } catch { /* Worker termination reclaims a non-quiescent realm */ }
      send({ type: "fatal", error: fatal.stack || fatal.message });
    })();
    return fatalPromise;
  };

  const beginNaturalCompletion = (state) => {
    if (terminalPromise || stopping || fatal) return;
    terminalizing = true;
    terminalPromise = (async () => {
      if (state !== "error" && typeof controller?.stateDigest === "function") {
        send({ type: "busy", id: 0, method: "terminalStateDigest" });
        try {
          const digest = await controller.stateDigest();
          callbacks.onOutput(new TextEncoder().encode(`\r\nstate sha256=${digest}\r\n`));
        } catch (error) {
          callbacks.onError(error);
        } finally {
          send({ type: "idle", id: 0, method: "terminalStateDigest" });
        }
      }
      if (stopping || fatal) return;
      await cleanup();
      // Fatal protocol input or an explicit stop may arrive while storage cleanup is awaited.
      // Re-check ownership so clean DONE can never overwrite a newer fatal/stop outcome.
      if (!stopping && !fatal) sendDone(state);
    })();
    terminalPromise.catch((error) => fail(error));
  };

  const queueNaturalCompletion = (state) => {
    // The terminal digest uses lifecycle BUSY id=0. Launch it only after the FIFO's active RPC has
    // fully emitted RESULT/IDLE; otherwise a held snapshot RPC and terminal hashing overlap and the
    // client correctly rejects the second BUSY frame as malformed.
    const launch = chain.then(() => beginNaturalCompletion(state));
    chain = launch.catch((error) => fail(error));
  };

  const queueControllerFailure = (reason) => {
    const launch = chain.then(() => { throw errorFrom(reason); });
    chain = launch.catch((error) => fail(error));
  };

  const callbacks = {
    onState: (state) => send({ type: "state", state }),
    onProgress: (label, loaded, total) => send({ type: "progress", label, loaded, total }),
    onOutput: (value) => {
      const bytes = privateBytes(value);
      if (!bytes.byteLength) return;
      outputParts.push(bytes);
      outputBytes += bytes.byteLength;
      if (!outputScheduled) {
        outputScheduled = true;
        queueMicrotask(flushOutput);
      }
    },
    onAgentOutput: (value) => {
      const bytes = privateBytes(value);
      if (!bytes.byteLength) return;
      send({ type: "agent", buffer: bytes.buffer }, [bytes.buffer]);
    },
    onError: (error) => send({ type: "error", error: String(error?.message || error) }),
    onStorage: (info) => send({ type: "storage", info }),
    onWriterStatus: (info) => send({ type: "writer", info }),
    onQuota: (info) => send({ type: "quota", info }),
    onCaptureStart: (info) => send({ type: "capture-start", info }),
    onDisplayFrame: (frame) => {
      try {
        if (frame?.type === "clear") {
          send({ type: "display", frame: { type: "clear" } });
          return;
        }
        const source = frame?.pixels;
        const pixels = source instanceof Uint32Array ? source.slice() : Uint32Array.from(source ?? []);
        send({
          type: "display",
          frame: {
            scanout: frame?.scanout ?? null,
            format: frame?.format ?? 1,
            rect: frame?.rect,
            resourceWidth: frame?.resourceWidth,
            resourceHeight: frame?.resourceHeight,
            pixels: pixels.buffer,
          },
        }, [pixels.buffer]);
      } catch (error) {
        send({ type: "error", error: String(error?.message || error) });
      }
    },
    onCursorState: (frame) => {
      try {
        const source = frame?.pixels;
        const pixels = source instanceof Uint32Array ? source.slice() : Uint32Array.from(source ?? []);
        send({
          type: "cursor",
          frame: {
            type: frame?.type,
            state: frame?.state,
            format: frame?.format ?? null,
            resourceWidth: frame?.resourceWidth ?? 0,
            resourceHeight: frame?.resourceHeight ?? 0,
            pixels: pixels.buffer,
          },
        }, [pixels.buffer]);
      } catch (error) {
        send({ type: "error", error: String(error?.message || error) });
      }
    },
  };

  const handleBoot = async (message) => {
    if (bootStarted) throw new Error("Linux worker boot already started");
    bootStarted = true;
    controller = await startBoot({ ...(message.opts ?? {}), ...callbacks });
    controller.whenDone?.then(
      (state) => {
        // Give an already-posted explicit stop message one task turn to claim lifecycle ownership.
        // This prevents natural completion and stop from racing duplicate cleanup/out-of-order done.
        setTimeout(() => {
          queueNaturalCompletion(state);
        }, 0);
      },
      (error) => { queueControllerFailure(error); },
    );
    send({
      type: "ready",
      restored: Boolean(controller.restoredFromBootSnapshot?.()),
      info: {
        backend: "whole-machine-worker",
        jit: await controller.jitStats?.() ?? null,
        scheduler: await controller.schedulerStats?.() ?? null,
      },
    });
  };

  const handleCall = async (message) => {
    const { id, method } = message;
    if (method === "stop-internal") {
      stopping = true;
      let state = "stopped";
      let stopError = null;
      try {
        try { await stopInner(); } catch (error) { stopError = error; }
        await cleanup();
        if (stopError) throw stopError;
        state = await controller?.whenDone ?? "stopped";
        sendDone(state);
        send({ type: "result", id, result: state });
      } catch (error) {
        send({ type: "result", id, error: String(error?.message || error) });
        throw error;
      }
      return;
    }
    if (terminalizing) {
      send({ type: "result", id, error: "Linux worker is completing" });
      return;
    }
    if (!METHOD_SET.has(method)) {
      send({ type: "result", id, error: `unknown Linux worker method: ${String(method)}` });
      return;
    }
    if (!controller) throw new Error("Linux worker controller is not ready");
    const args = [...(message.args ?? [])];
    const byteIndex = BYTE_ARG[method];
    if (byteIndex != null) args[byteIndex] = new Uint8Array(args[byteIndex]);
    const longRpc = Object.hasOwn(LONG_RPC_GRACE_MS, method);
    if (longRpc) send({ type: "busy", id, method });
    try {
      const fn = method === "tailscaleCommand" ? tailscaleCommand : controller[method];
      if (typeof fn !== "function") throw new Error(`Linux controller method unavailable: ${method}`);
      const value = await fn.apply(controller, args);
      if (BYTE_RESULT.has(method)) {
        if (value == null) {
          send({ type: "result", id, result: null });
        } else {
          const bytes = privateBytes(value);
          send({ type: "result", id, result: bytes.buffer, bytes: true }, [bytes.buffer]);
        }
      } else {
        send({ type: "result", id, result: value });
      }
    } catch (error) {
      send({ type: "result", id, error: String(error?.message || error) });
    } finally {
      if (longRpc) send({ type: "idle", id, method });
    }
  };

  const handle = async (message) => {
    if (fatal) throw fatal;
    if (!message || message.version !== LINUX_WORKER_PROTOCOL_VERSION) {
      throw new Error(`Linux worker protocol version mismatch (expected ${LINUX_WORKER_PROTOCOL_VERSION})`);
    }
    switch (message.type) {
      case "boot": return handleBoot(message);
      case "input":
        if (!controller) throw new Error("Linux worker input before ready");
        if (terminalizing) return;
        // The page already transferred an exact private ArrayBuffer. Re-wrap it without a second copy.
        controller.sendInput(new Uint8Array(message.bytes));
        return;
      case "call": return handleCall(message);
      case "ping":
        if (!controller) throw new Error("Linux worker heartbeat before ready");
        send({ type: "pong" });
        return;
      default: throw new Error(`unknown Linux worker request: ${String(message.type)}`);
    }
  };

  const onMessage = (event) => {
    const message = event?.data;
    // Heartbeats are liveness-only and may bypass an awaited persistence/snapshot RPC. Guest input
    // and controller calls remain on `chain`; a synchronous runChunk/JIT stall still blocks pong and
    // is therefore detected honestly.
    if (message?.type === "ping" &&
        message.version === LINUX_WORKER_PROTOCOL_VERSION && !fatal) {
      send({ type: "pong" });
      return;
    }
    chain = chain.then(() => handle(event?.data)).catch((error) => fail(error));
  };
  listen(endpoint, onMessage);
  return { handleMessage: onMessage, fail, callbacks };
}
