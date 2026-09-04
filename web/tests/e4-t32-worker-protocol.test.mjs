import assert from "node:assert/strict";
import test from "node:test";

import {
  LINUX_CONTROLLER_METHODS,
  LINUX_WORKER_PROTOCOL_VERSION,
  createLinuxWorkerClient,
  createLinuxWorkerRuntime,
} from "../linux-worker-protocol.js";
import { stopLinuxController } from "../linux-worker-host.js";
import { createTaskQuiescence } from "../task-quiescence.js";

function endpointPair(events = []) {
  const connection = { closed: false };
  const make = (name) => ({
    name,
    listeners: new Set(),
    addEventListener(type, listener) { if (type === "message") this.listeners.add(listener); },
    removeEventListener(type, listener) { if (type === "message") this.listeners.delete(listener); },
    terminate() { events.push(`${name}:terminate`); connection.closed = true; },
  });
  const page = make("page");
  const worker = make("worker");
  page.peer = worker;
  worker.peer = page;
  for (const endpoint of [page, worker]) {
    endpoint.postMessage = (message, transfer = []) => {
      if (connection.closed) return;
      const cloned = structuredClone(message, { transfer });
      queueMicrotask(() => {
        if (connection.closed) return;
        for (const listener of endpoint.peer.listeners) listener({ data: cloned });
      });
    };
  }
  return { page, worker };
}

function fakeController(events, done) {
  const uploads = [];
  return {
    backend: "main-thread",
    whenDone: done,
    restoredFromBootSnapshot: () => true,
    sendInput(bytes) { events.push(["input", [...bytes]]); },
    sendKeyboardEvent: (eventType, code, value) => events.push(["keyboard", eventType, code, value]),
    syncKeyboard: () => events.push("keyboard-sync"),
    sendTabletEvent: (eventType, code, value) => events.push(["tablet", eventType, code, value]),
    syncTablet: () => events.push("tablet-sync"),
    sendMouseEvent: (eventType, code, value) => events.push(["mouse", eventType, code, value]),
    syncMouse: () => events.push("mouse-sync"),
    keyboardLedState: () => ({ numLock: false, capsLock: false, scrollLock: false }),
    pause: () => events.push("pause"),
    resume: () => events.push("resume"),
    isPaused: () => false,
    stateDigest: () => "digest",
    dhcpStats: () => ({ offers: 1 }),
    fileTransferReady: (slot) => slot === 0,
    setFileDownloadReady: () => true,
    beginFileUpload: () => 7,
    pushFileUpload: (_id, bytes) => { uploads.push([...bytes]); return bytes.byteLength; },
    cancelFileUpload: () => true,
    dismissFileUpload: () => true,
    cancelFileDownload: () => true,
    finishFileDownload: () => true,
    fileTransferStatus: () => ({ uploads: [], downloads: [], maxBuffered: 8 }),
    takeFileDownloadChunk: () => Uint8Array.from([8, 9, 10]).subarray(1),
    dismissFileDownload: () => true,
    fetchStats: () => ({ fetches: 1, bytes: 2 }),
    persist: () => 0,
    persistStats: () => ({ pendingBytes: 0 }),
    readOnly: () => false,
    overlaySeedIdentity: () => "d".repeat(64),
    audioOutputReady: () => true,
    audioCaptureReady: () => true,
    captureState: () => ({ enabled: true, state: "running", startCount: 1 }),
    notifyCaptureEvent: (event) => { events.push(["capture", event]); return true; },
    resumeAfterQuota: () => true,
    continueReadOnly: () => true,
    hasUnpersisted: () => false,
    snapshotSave: () => true,
    snapshotRead: () => Uint8Array.of(1, 2),
    snapshotDecision: () => "resume",
    snapshotAdvanceGen: () => 2,
    snapshotGeneration: () => 2,
    snapshotExport: () => Uint8Array.of(3, 4),
    snapshotRestore: () => "resume",
    snapshotImport: (bytes) => { events.push(["snapshot", [...bytes]]); return true; },
    storageEstimate: () => ({ usage: 1, quota: 2 }),
    jitStats: () => ({ compiledBlocks: 2, executedBlocks: 3, retiredViaJit: 4 }),
    profileStats: () => ({ totalNs: 5 }),
    schedulerStats: () => ({ quantum: 500_000 }),
    async stop() { events.push("inner-stop"); },
    async releaseWriterLock() { events.push("release-lock"); },
    async closeStorage() { events.push("close-storage"); },
    _uploads: uploads,
  };
}

test("loader task quiescence joins held persistence and permanently closes scheduling", async () => {
  const events = [];
  let releasePersist;
  const heldPersist = new Promise((resolve) => { releasePersist = resolve; });
  const barrier = createTaskQuiescence(() => events.push("idle"));
  const pump = barrier.run(async () => {
    events.push("persist-start");
    await heldPersist;
    events.push("persist-end");
  });
  await Promise.resolve();
  assert.deepEqual(events, ["persist-start"]);

  let stopSettled = false;
  const stopped = barrier.stop().then(() => {
    stopSettled = true;
    events.push("stop-settled");
  });
  await Promise.resolve();
  assert.equal(stopSettled, false, "stop must join the active persistence pump");
  assert.deepEqual(events, ["persist-start"]);

  releasePersist();
  await Promise.all([pump, stopped]);
  assert.deepEqual(events, ["persist-start", "persist-end", "idle", "idle", "stop-settled"]);
  assert.equal(await barrier.run(() => events.push("post-stop-tick")), false);
  assert.equal(events.includes("post-stop-tick"), false, "no pump can be scheduled after stop");
});

test("explicit surface, FIFO input/RPC, exact transferable ownership, Tailscale, and stop order", async () => {
  const events = [];
  const { page, worker } = endpointPair(events);
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  let inner;
  createLinuxWorkerRuntime(worker, {
    startBoot: async (opts) => {
      events.push(["boot", opts.quantum]);
      opts.onOutput(new Uint8Array(70_000).fill(5));
      inner = fakeController(events, done);
      return inner;
    },
    tailscaleCommand: (command) => { events.push(["tailscale", command]); return true; },
  });
  const output = [];
  const outputBatchSizes = [];
  const client = createLinuxWorkerClient(page, { onOutput: (bytes) => {
    outputBatchSizes.push(bytes.byteLength);
    output.push(...bytes);
  } });
  const controller = await client.boot({ quantum: 500_000 });

  assert.equal(controller.backend, "whole-machine-worker");
  assert.equal(controller.restoredFromBootSnapshot(), true);
  assert.equal(typeof controller.workerRpcStats, "function");
  assert.equal(controller.arbitraryMethod, undefined);
  for (const method of LINUX_CONTROLLER_METHODS) assert.equal(typeof controller[method], "function", method);
  assert.equal(output.length, 70_000);
  assert.ok(outputBatchSizes.every((size) => size <= 64 * 1024));

  const backing = Uint8Array.from([90, 1, 2, 3, 91]);
  const view = backing.subarray(1, 4);
  assert.equal(controller.sendInput(view), true);
  assert.equal(backing.byteLength, 5, "caller input buffer must not detach");
  await controller.pause();
  assert.deepEqual(events.slice(-2), [["input", [1, 2, 3]], "pause"], "input cannot be overtaken by RPC");
  assert.equal((await controller.workerRpcStats()).completed, 1);

  await controller.pushFileUpload(7, view, false);
  assert.equal(backing.byteLength, 5, "caller upload buffer must not detach");
  assert.deepEqual(inner._uploads, [[1, 2, 3]]);
  assert.deepEqual([...await controller.takeFileDownloadChunk(9)], [9, 10]);
  await controller.snapshotImport(view);
  assert.equal(backing.byteLength, 5, "caller snapshot buffer must not detach");
  assert.deepEqual(events.at(-1), ["snapshot", [1, 2, 3]]);
  assert.equal(await controller.tailscaleCommand("login"), true);

  resolveDone("stopped");
  assert.equal(await controller.stop(), "stopped");
  const tail = events.slice(-4);
  assert.deepEqual(tail, ["inner-stop", "release-lock", "close-storage", "page:terminate"]);
  assert.equal(controller.sendInput(Uint8Array.of(1)), false);
  await assert.rejects(() => controller.resume(), /stopped/);
  await assert.rejects(() => controller.workerRpcStats(), /stopped/);
});

test("every explicit controller method crosses the runtime and no-provider Tailscale is false/nonfatal", async () => {
  const events = [];
  const invoked = [];
  const { page, worker } = endpointPair(events);
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  createLinuxWorkerRuntime(worker, {
    startBoot: async () => {
      const inner = fakeController(events, done);
      for (const method of LINUX_CONTROLLER_METHODS) {
        if (method === "tailscaleCommand") continue;
        const fn = inner[method];
        assert.equal(typeof fn, "function", `fake must implement ${method}`);
        inner[method] = (...args) => {
          invoked.push(method);
          return fn.apply(inner, args);
        };
      }
      return inner;
    },
    tailscaleCommand: (command) => {
      invoked.push("tailscaleCommand");
      assert.equal(command, "status");
      return false;
    },
  });
  const controller = await createLinuxWorkerClient(page).boot({});
  // READY intentionally samples initial JIT/scheduler stats; the table below covers the public
  // controller calls themselves, so start its invocation ledger after boot metadata is complete.
  invoked.length = 0;
  try {
    const args = {
      sendKeyboardEvent: [1, 30, 1],
      syncKeyboard: [],
      sendTabletEvent: [3, 0, 12],
      syncTablet: [],
      sendMouseEvent: [2, 0, -2],
      syncMouse: [],
      keyboardLedState: [],
      fileTransferReady: [0],
      setFileDownloadReady: [true],
      beginFileUpload: [0, "all-methods.bin", 3, "sha256"],
      pushFileUpload: [7, Uint8Array.of(1, 2, 3), false],
      cancelFileUpload: [7],
      dismissFileUpload: [7],
      cancelFileDownload: [9],
      finishFileDownload: [9, true],
      takeFileDownloadChunk: [9],
      dismissFileDownload: [9],
      snapshotImport: [Uint8Array.of(4, 5)],
      notifyCaptureEvent: ["muted"],
      tailscaleCommand: ["status"],
    };
    const results = new Map();
    for (const method of LINUX_CONTROLLER_METHODS) {
      results.set(method, await controller[method](...(args[method] ?? [])));
    }
    assert.deepEqual([...invoked], LINUX_CONTROLLER_METHODS);
    assert.deepEqual(events.slice(0, 2), [["keyboard", 1, 30, 1], "keyboard-sync"]);
    assert.equal(results.get("tailscaleCommand"), false);
    assert.deepEqual([...results.get("takeFileDownloadChunk")], [9, 10]);
    assert.deepEqual([...results.get("snapshotRead")], [1, 2]);
    assert.deepEqual([...results.get("snapshotExport")], [3, 4]);
    assert.equal(await controller.isPaused(), false, "controller remains live after false Tailscale result");
  } finally {
    resolveDone("stopped");
    await controller.whenDone;
  }
});

test("capture PCM_START lifecycle notification crosses the worker boundary", async () => {
  const events = [];
  const { page, worker } = endpointPair(events);
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  let resolveCapture;
  const capture = new Promise((resolve) => { resolveCapture = resolve; });
  createLinuxWorkerRuntime(worker, {
    startBoot: async (opts) => {
      opts.onCaptureStart({ enabled: true, state: "running", startCount: 3 });
      return fakeController(events, done);
    },
  });
  const client = createLinuxWorkerClient(page, {
    onCaptureStart: (info) => resolveCapture(info),
  });
  const controller = await client.boot({});
  assert.deepEqual(await capture, { enabled: true, state: "running", startCount: 3 });
  resolveDone("stopped");
  await controller.whenDone;
});

test("display FrameSink projections cross the worker boundary with private pixel ownership", async () => {
  const events = [];
  const { page, worker } = endpointPair(events);
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  let resolveDisplay;
  const display = new Promise((resolve) => { resolveDisplay = resolve; });
  createLinuxWorkerRuntime(worker, {
    startBoot: async (opts) => {
      const source = Uint32Array.of(0x11223344, 0x55667788);
      opts.onDisplayFrame({
        scanout: 0,
        rect: { x: 1, y: 0, width: 1, height: 1 },
        resourceWidth: 2,
        resourceHeight: 1,
        pixels: source,
      });
      source[0] = 0;
      return fakeController(events, done);
    },
  });
  const client = createLinuxWorkerClient(page, { onDisplayFrame: resolveDisplay });
  const controller = await client.boot({});
  const frame = await display;
  assert.deepEqual(frame.rect, { x: 1, y: 0, width: 1, height: 1 });
  assert.deepEqual([...frame.pixels], [0x11223344, 0x55667788]);
  resolveDone("stopped");
  await controller.whenDone;
});

test("cursor-plane update and move projections keep MOVE payloads empty and privately owned", async () => {
  const events = [];
  const { page, worker } = endpointPair(events);
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const cursors = [];
  createLinuxWorkerRuntime(worker, {
    startBoot: async (opts) => {
      const source = Uint32Array.of(0x11223344, 0x55667788);
      opts.onCursorState({
        type: "cursor-update",
        state: { resourceId: 7, hotX: 1, hotY: 0, pos: { scanoutId: 0, x: 10, y: 20 } },
        format: 1,
        resourceWidth: 2,
        resourceHeight: 1,
        pixels: source,
      });
      source[0] = 0;
      opts.onCursorState({
        type: "cursor-move",
        state: { resourceId: 7, hotX: 1, hotY: 0, pos: { scanoutId: 0, x: 11, y: 21 } },
        format: null,
        resourceWidth: 0,
        resourceHeight: 0,
        pixels: new Uint32Array(0),
      });
      return fakeController(events, done);
    },
  });
  const client = createLinuxWorkerClient(page, { onCursorState: (frame) => cursors.push(frame) });
  const controller = await client.boot({});
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cursors.length, 2);
  assert.equal(cursors[0].type, "cursor-update");
  assert.deepEqual([...cursors[0].pixels], [0x11223344, 0x55667788]);
  assert.equal(cursors[0].resourceWidth, 2);
  assert.equal(cursors[1].type, "cursor-move");
  assert.deepEqual(cursors[1].state.pos, { scanoutId: 0, x: 11, y: 21 });
  assert.equal(cursors[1].format, null);
  assert.equal(cursors[1].resourceWidth, 0);
  assert.equal(cursors[1].pixels.byteLength, 0);
  resolveDone("stopped");
  await controller.whenDone;
});

test("RPC ids correlate out-of-order results and arbitrary methods are not exposed", async () => {
  const { page, worker } = endpointPair();
  const client = createLinuxWorkerClient(page);
  const calls = [];
  worker.addEventListener("message", ({ data }) => {
    if (data.type === "boot") {
      worker.postMessage({ type: "ready", version: LINUX_WORKER_PROTOCOL_VERSION, restored: false });
    } else if (data.type === "call") {
      calls.push(data);
      if (calls.length === 2) {
        for (const call of calls.toReversed()) {
          worker.postMessage({ type: "result", version: LINUX_WORKER_PROTOCOL_VERSION, id: call.id, result: call.method });
        }
      }
    }
  });
  const controller = await client.boot({});
  const [a, b] = await Promise.all([controller.pause(), controller.resume()]);
  assert.deepEqual([a, b], ["pause", "resume"]);
  assert.equal(controller.notAllowed, undefined);
  worker.postMessage({ type: "done", version: LINUX_WORKER_PROTOCOL_VERSION, state: "stopped" });
  await controller.whenDone;
});

test("version mismatch/fatal rejects boot, pending and future calls exactly once", async () => {
  const { page, worker } = endpointPair();
  const errors = [];
  const client = createLinuxWorkerClient(page, { onError: (error) => errors.push(error.message) });
  worker.addEventListener("message", ({ data }) => {
    if (data.type === "boot") worker.postMessage({ type: "ready", version: 999, restored: false });
  });
  await assert.rejects(() => client.boot({}), /version mismatch/);
  await assert.rejects(() => client.controller.pause(), /version mismatch/);
  await assert.rejects(() => client.controller.whenDone, /version mismatch/);
  assert.equal(errors.length, 1);
});

test("fatal after ready rejects pending, whenDone, stats, and future RPCs once", async () => {
  const events = [];
  const { page, worker } = endpointPair(events);
  const errors = [];
  const client = createLinuxWorkerClient(page, { onError: (error) => errors.push(error.message) });
  worker.addEventListener("message", ({ data }) => {
    if (data.type === "boot") {
      worker.postMessage({ type: "ready", version: LINUX_WORKER_PROTOCOL_VERSION, restored: false });
    }
    // Intentionally leave RPCs pending until the fatal frame arrives.
  });
  const controller = await client.boot({});
  const pending = controller.pause();
  worker.postMessage({ type: "fatal", version: LINUX_WORKER_PROTOCOL_VERSION, error: "boom" });
  await assert.rejects(() => pending, /boom/);
  await assert.rejects(() => controller.whenDone, /boom/);
  await assert.rejects(() => controller.resume(), /boom/);
  await assert.rejects(() => controller.workerRpcStats(), /boom/);
  assert.equal(controller.sendInput(Uint8Array.of(1)), false);
  assert.deepEqual(errors, ["boom"]);
  assert.equal(events.filter((event) => event === "page:terminate").length, 1);
});

test("worker rejects an unknown method without executing it and propagates controller rejections", async () => {
  const events = [];
  const { page, worker } = endpointPair(events);
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  createLinuxWorkerRuntime(worker, {
    startBoot: async () => {
      const inner = fakeController(events, done);
      inner.pause = () => { throw new Error("pause exploded"); };
      return inner;
    },
  });
  const rawResults = [];
  page.addEventListener("message", ({ data }) => {
    if (data.type === "result" && data.id === 999) rawResults.push(data);
  });
  const client = createLinuxWorkerClient(page);
  const controller = await client.boot({});
  await assert.rejects(() => controller.pause(), /pause exploded/);
  assert.equal(typeof await controller.resume(), "number", "a rejected method must not kill the protocol");
  assert.ok(events.includes("resume"));
  page.postMessage({
    type: "call",
    version: LINUX_WORKER_PROTOCOL_VERSION,
    id: 999,
    method: "constructor",
    args: [],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(rawResults[0]?.error ?? "", /unknown Linux worker method/);
  assert.equal(events.includes("constructor"), false);
  resolveDone("stopped");
  await controller.whenDone;
});

test("unknown frames fail closed and Tailscale events remain versioned", async () => {
  const events = [];
  const { page, worker } = endpointPair(events);
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  createLinuxWorkerRuntime(worker, {
    startBoot: async () => fakeController(events, done),
  });
  const tailscale = [];
  const frames = [];
  page.addEventListener("message", ({ data }) => frames.push(data.type));
  const client = createLinuxWorkerClient(page, { onTailscaleEvent: (message) => tailscale.push(message) });
  const controller = await client.boot({});
  worker.postMessage({
    type: "tailscale-event",
    version: LINUX_WORKER_PROTOCOL_VERSION,
    message: { type: "status", status: { state: "Running" } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(tailscale[0]?.status?.state, "Running");
  page.postMessage({ type: "not-a-request", version: LINUX_WORKER_PROTOCOL_VERSION });
  await assert.rejects(() => controller.whenDone, /unknown Linux worker request/);
  await assert.rejects(() => controller.resume(), /unknown Linux worker request/);
  assert.deepEqual(
    events.filter((event) => ["inner-stop", "release-lock", "close-storage"].includes(event)),
    ["inner-stop", "release-lock", "close-storage"],
    "fatal teardown must quiesce the loader before releasing storage",
  );
  assert.equal(frames.includes("done"), false);
  resolveDone("unused");
});

test("DONE rejects pending RPCs and DONE-before-READY rejects boot", async () => {
  {
    const { page, worker } = endpointPair();
    const client = createLinuxWorkerClient(page);
    worker.addEventListener("message", ({ data }) => {
      if (data.type === "boot") {
        worker.postMessage({ type: "ready", version: LINUX_WORKER_PROTOCOL_VERSION, restored: false });
      }
    });
    const controller = await client.boot({});
    const pending = controller.pause();
    worker.postMessage({ type: "done", version: LINUX_WORKER_PROTOCOL_VERSION, state: "poweroff" });
    assert.equal(await controller.whenDone, "poweroff");
    await assert.rejects(() => pending, /completed: poweroff/);
    await assert.rejects(() => controller.resume(), /stopped/);
  }
  {
    const { page, worker } = endpointPair();
    const client = createLinuxWorkerClient(page);
    worker.addEventListener("message", ({ data }) => {
      if (data.type === "boot") {
        worker.postMessage({ type: "done", version: LINUX_WORKER_PROTOCOL_VERSION, state: "bad-order" });
      }
    });
    await assert.rejects(() => client.boot({}), /completed before ready/);
    await assert.rejects(() => client.controller.whenDone, /completed before ready/);
  }
});

test("byte RPC encoding errors reject asynchronously", async () => {
  const { page, worker } = endpointPair();
  const client = createLinuxWorkerClient(page);
  worker.addEventListener("message", ({ data }) => {
    if (data.type === "boot") {
      worker.postMessage({ type: "ready", version: LINUX_WORKER_PROTOCOL_VERSION, restored: false });
    }
  });
  const controller = await client.boot({});
  const detached = Uint8Array.of(1, 2, 3);
  structuredClone(detached.buffer, { transfer: [detached.buffer] });
  let returned;
  assert.doesNotThrow(() => { returned = controller.snapshotImport(detached); });
  await assert.rejects(() => returned, /detached|ArrayBuffer/i);
  worker.postMessage({ type: "done", version: LINUX_WORKER_PROTOCOL_VERSION, state: "stopped" });
  await controller.whenDone;
});

test("silent termination is detected before and after READY and rejects pending work", async () => {
  {
    const { page, worker } = endpointPair();
    const client = createLinuxWorkerClient(page, { heartbeatIntervalMs: 5, heartbeatTimeoutMs: 25 });
    worker.addEventListener("message", ({ data }) => {
      if (data.type === "boot") {
        worker.postMessage({ type: "ready", version: LINUX_WORKER_PROTOCOL_VERSION, restored: false });
      }
    });
    const controller = await client.boot({});
    const pending = controller.pause();
    page.terminate();
    await assert.rejects(() => pending, /heartbeat timed out/);
    await assert.rejects(() => controller.whenDone, /heartbeat timed out/);
    await assert.rejects(() => controller.resume(), /heartbeat timed out/);
  }
  {
    const { page, worker } = endpointPair();
    const client = createLinuxWorkerClient(page, {
      heartbeatIntervalMs: 5,
      heartbeatTimeoutMs: 25,
      bootTimeoutMs: 25,
    });
    worker.addEventListener("message", () => {});
    const boot = client.boot({});
    page.terminate();
    await assert.rejects(() => boot, /boot timed out/);
    await assert.rejects(() => client.controller.whenDone, /boot timed out/);
  }
});

test("heartbeat bypasses long async RPCs and visibility suspension shifts its deadline", async () => {
  const events = [];
  const { page, worker } = endpointPair(events);
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  let resolveSnapshot;
  const snapshotBlocked = new Promise((resolve) => { resolveSnapshot = resolve; });
  createLinuxWorkerRuntime(worker, {
    startBoot: async () => {
      const inner = fakeController(events, done);
      inner.snapshotSave = async () => {
        await snapshotBlocked;
        return true;
      };
      return inner;
    },
  });
  const client = createLinuxWorkerClient(page, {
    heartbeatIntervalMs: 5,
    heartbeatTimeoutMs: 25,
    longRpcGraceMs: { snapshotSave: 30 },
  });
  const controller = await client.boot({});
  const snapshot = controller.snapshotSave();
  await new Promise((resolve) => setTimeout(resolve, 10));
  client.setHeartbeatSuspended(true);
  await new Promise((resolve) => setTimeout(resolve, 60));
  client.setHeartbeatSuspended(false);
  await new Promise((resolve) => setTimeout(resolve, 10));
  resolveSnapshot(true);
  assert.equal(await snapshot, true);
  assert.equal(typeof await controller.resume(), "number");
  resolveDone("stopped");
  assert.equal(await controller.whenDone, "stopped");
});

test("visibility suspension pauses the pre-READY boot deadline", async () => {
  const { page, worker } = endpointPair();
  let sawBoot = false;
  worker.addEventListener("message", ({ data }) => {
    if (data.type === "boot") sawBoot = true;
  });
  const client = createLinuxWorkerClient(page, { bootTimeoutMs: 25 });
  client.setHeartbeatSuspended(true);
  const boot = client.boot({});
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(sawBoot, true);
  client.setHeartbeatSuspended(false);
  worker.postMessage({ type: "ready", version: LINUX_WORKER_PROTOCOL_VERSION, restored: false });
  const controller = await boot;
  worker.postMessage({ type: "done", version: LINUX_WORKER_PROTOCOL_VERSION, state: "stopped" });
  assert.equal(await controller.whenDone, "stopped");
});

test("stateDigest gets method-scoped heartbeat grace and the controller remains live afterward", async () => {
  const { page, worker } = endpointPair();
  const client = createLinuxWorkerClient(page, { heartbeatIntervalMs: 5, heartbeatTimeoutMs: 25 });
  worker.addEventListener("message", ({ data }) => {
    if (data.type === "boot") {
      worker.postMessage({ type: "ready", version: LINUX_WORKER_PROTOCOL_VERSION, restored: false });
    } else if (data.type === "call" && data.method === "stateDigest") {
      worker.postMessage({
        type: "busy", version: LINUX_WORKER_PROTOCOL_VERSION, id: data.id, method: data.method,
      });
      setTimeout(() => {
        worker.postMessage({
          type: "result", version: LINUX_WORKER_PROTOCOL_VERSION, id: data.id, result: "digest",
        });
        worker.postMessage({
          type: "idle", version: LINUX_WORKER_PROTOCOL_VERSION, id: data.id, method: data.method,
        });
      }, 60);
    } else if (data.type === "call") {
      worker.postMessage({
        type: "result", version: LINUX_WORKER_PROTOCOL_VERSION, id: data.id, result: true,
      });
    }
    // Intentionally ignore pings: without the scoped busy frame, the 25ms watchdog would fire.
  });
  const controller = await client.boot({});
  assert.equal(await controller.stateDigest(), "digest");
  assert.equal(await controller.resume(), true);
  worker.postMessage({ type: "done", version: LINUX_WORKER_PROTOCOL_VERSION, state: "stopped" });
  assert.equal(await controller.whenDone, "stopped");
});

test("every bulk snapshot RPC emits BUSY/IDLE and survives the scoped heartbeat grace", async () => {
  const { page, worker } = endpointPair();
  const frames = [];
  const postFromWorker = worker.postMessage.bind(worker);
  worker.postMessage = (message, transfer = []) => {
    if (message.type === "pong") return; // Make BUSY/IDLE, not heartbeat replies, keep the client alive.
    if (message.type === "busy" || message.type === "idle") {
      frames.push([message.type, message.method]);
    }
    postFromWorker(message, transfer);
  };
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const delay = () => new Promise((resolve) => setTimeout(resolve, 60));
  createLinuxWorkerRuntime(worker, {
    startBoot: async () => {
      const inner = fakeController([], done);
      inner.stateDigest = async () => { await delay(); return "slow-digest"; };
      inner.snapshotSave = async () => { await delay(); return true; };
      inner.snapshotRead = async () => { await delay(); return Uint8Array.of(1, 2); };
      inner.snapshotDecision = async () => { await delay(); return "resume"; };
      inner.snapshotExport = async () => { await delay(); return Uint8Array.of(3, 4); };
      inner.snapshotImport = async () => { await delay(); return true; };
      return inner;
    },
  });
  const methods = [
    "stateDigest",
    "snapshotSave",
    "snapshotRead",
    "snapshotDecision",
    "snapshotExport",
    "snapshotImport",
  ];
  const client = createLinuxWorkerClient(page, {
    heartbeatIntervalMs: 5,
    heartbeatTimeoutMs: 25,
    longRpcGraceMs: Object.fromEntries(methods.map((method) => [method, 200])),
  });
  const controller = await client.boot({});
  assert.equal(await controller.stateDigest(), "slow-digest");
  assert.equal(await controller.snapshotSave(), true);
  assert.deepEqual(await controller.snapshotRead(), Uint8Array.of(1, 2));
  assert.equal(await controller.snapshotDecision(), "resume");
  assert.deepEqual(await controller.snapshotExport(), Uint8Array.of(3, 4));
  assert.equal(await controller.snapshotImport(Uint8Array.of(9)), true);
  await Promise.resolve();
  assert.deepEqual(
    frames,
    methods.flatMap((method) => [["busy", method], ["idle", method]]),
  );
  resolveDone("stopped");
  assert.equal(await controller.whenDone, "stopped");
});

test("natural completion emits a scoped terminal digest before DONE", async () => {
  const events = [];
  const { page, worker } = endpointPair(events);
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  createLinuxWorkerRuntime(worker, {
    startBoot: async () => fakeController(events, done),
  });
  const frames = [];
  page.addEventListener("message", ({ data }) => frames.push(data));
  const output = [];
  const controller = await createLinuxWorkerClient(page, {
    onOutput: (bytes) => output.push(new TextDecoder().decode(bytes)),
  }).boot({});
  resolveDone("poweroff");
  assert.equal(await controller.whenDone, "poweroff");
  const terminalFrames = frames.filter((frame) =>
    frame.method === "terminalStateDigest" || frame.type === "done");
  assert.deepEqual(
    terminalFrames.map((frame) => [frame.type, frame.id ?? null]),
    [["busy", 0], ["idle", 0], ["done", null]],
  );
  assert.match(output.join(""), /state sha256=digest/);
});

test("natural completion waits behind a held snapshot RPC before terminal BUSY and cleanup", async () => {
  const events = [];
  const { page, worker } = endpointPair(events);
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  let releaseSnapshot;
  const snapshotBlocked = new Promise((resolve) => { releaseSnapshot = resolve; });
  let markSnapshotStarted;
  const snapshotStarted = new Promise((resolve) => { markSnapshotStarted = resolve; });
  createLinuxWorkerRuntime(worker, {
    startBoot: async () => {
      const inner = fakeController(events, done);
      inner.snapshotSave = async () => {
        events.push("snapshot-start");
        markSnapshotStarted();
        await snapshotBlocked;
        events.push("snapshot-end");
        return true;
      };
      return inner;
    },
  });
  const frames = [];
  page.addEventListener("message", ({ data }) => frames.push(data));
  const controller = await createLinuxWorkerClient(page).boot({});
  const save = controller.snapshotSave();
  await snapshotStarted;
  resolveDone("poweroff");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    frames.some((frame) => frame.type === "busy" && frame.id === 0),
    false,
    "terminal hashing cannot overlap the held long RPC",
  );
  assert.equal(events.includes("inner-stop"), false);
  assert.equal(events.includes("release-lock"), false);
  assert.equal(events.includes("close-storage"), false);

  releaseSnapshot();
  assert.equal(await save, true);
  assert.equal(await controller.whenDone, "poweroff");
  assert.deepEqual(
    frames
      .filter((frame) => frame.type === "busy" || frame.type === "idle" || frame.type === "done")
      .map((frame) => [frame.type, frame.id ?? null, frame.method ?? null]),
    [
      ["busy", 1, "snapshotSave"],
      ["idle", 1, "snapshotSave"],
      ["busy", 0, "terminalStateDigest"],
      ["idle", 0, "terminalStateDigest"],
      ["done", null, null],
    ],
  );
  assert.deepEqual(
    events.filter((event) => [
      "snapshot-start", "snapshot-end", "inner-stop", "release-lock", "close-storage",
    ].includes(event)),
    ["snapshot-start", "snapshot-end", "inner-stop", "release-lock", "close-storage"],
  );
});

test("fatal input during natural cleanup wins over clean DONE", async () => {
  const events = [];
  const { page, worker } = endpointPair(events);
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  let releaseCleanup;
  const cleanupBlocked = new Promise((resolve) => { releaseCleanup = resolve; });
  let markCleanupStarted;
  const cleanupStarted = new Promise((resolve) => { markCleanupStarted = resolve; });
  createLinuxWorkerRuntime(worker, {
    startBoot: async () => {
      const inner = fakeController(events, done);
      inner.releaseWriterLock = async () => {
        events.push("release-lock");
        markCleanupStarted();
        await cleanupBlocked;
      };
      return inner;
    },
  });
  const frames = [];
  page.addEventListener("message", ({ data }) => frames.push(data.type));
  const controller = await createLinuxWorkerClient(page).boot({});
  resolveDone("poweroff");
  await cleanupStarted;
  page.postMessage({ type: "unknown-during-cleanup", version: LINUX_WORKER_PROTOCOL_VERSION });
  releaseCleanup();
  await assert.rejects(() => controller.whenDone, /unknown Linux worker request/);
  assert.equal(frames.includes("done"), false);
  assert.equal(frames.includes("fatal"), true);
  assert.deepEqual(
    events.filter((event) => ["inner-stop", "release-lock", "close-storage"].includes(event)),
    ["inner-stop", "release-lock", "close-storage"],
  );
});

test("stop and fatal cleanup are bounded when a dependency never settles", async () => {
  {
    const { page, worker } = endpointPair();
    const client = createLinuxWorkerClient(page, { stopTimeoutMs: 20 });
    worker.addEventListener("message", ({ data }) => {
      if (data.type === "boot") {
        worker.postMessage({ type: "ready", version: LINUX_WORKER_PROTOCOL_VERSION, restored: false });
      }
    });
    const controller = await client.boot({});
    await assert.rejects(() => controller.stop(), /stop timed out/);
    await assert.rejects(() => controller.whenDone, /stop timed out/);
  }
  {
    const events = [];
    const { page, worker } = endpointPair(events);
    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });
    createLinuxWorkerRuntime(worker, {
      cleanupTimeoutMs: 10,
      startBoot: async () => {
        const inner = fakeController(events, done);
        inner.releaseWriterLock = () => new Promise(() => {});
        return inner;
      },
    });
    const client = createLinuxWorkerClient(page);
    const controller = await client.boot({});
    page.postMessage({ type: "unknown", version: LINUX_WORKER_PROTOCOL_VERSION });
    await assert.rejects(() => controller.whenDone, /unknown Linux worker request/);
    assert.ok(events.includes("close-storage"));
    resolveDone("unused");
  }
});

test("stop timeout fails closed without releasing storage under a live loader pump", async () => {
  for (const trigger of ["fatal", "natural"]) {
    const events = [];
    const { page, worker } = endpointPair(events);
    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });
    let releaseStop;
    const stopBlocked = new Promise((resolve) => { releaseStop = resolve; });
    createLinuxWorkerRuntime(worker, {
      cleanupTimeoutMs: 10,
      startBoot: async () => {
        const inner = fakeController(events, done);
        inner.stop = async () => {
          events.push("stop-start");
          await stopBlocked;
          events.push("stop-end");
        };
        return inner;
      },
    });
    const frames = [];
    page.addEventListener("message", ({ data }) => frames.push(data.type));
    const controller = await createLinuxWorkerClient(page).boot({});
    if (trigger === "fatal") {
      page.postMessage({ type: "malformed", version: LINUX_WORKER_PROTOCOL_VERSION });
    } else {
      resolveDone("poweroff");
    }
    await assert.rejects(
      () => controller.whenDone,
      trigger === "fatal" ? /unknown Linux worker request/ : /cleanup timed out/,
    );
    assert.deepEqual(events.filter((event) => event === "stop-start"), ["stop-start"]);
    assert.equal(events.includes("release-lock"), false, `${trigger}: lock released before quiescence`);
    assert.equal(events.includes("close-storage"), false, `${trigger}: storage closed before quiescence`);
    assert.equal(frames.includes("done"), false);
    assert.equal(frames.includes("fatal"), true);

    releaseStop();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(events.includes("stop-end"), true);
    assert.equal(events.includes("release-lock"), false, `${trigger}: timed-out cleanup resumed ownership release`);
    assert.equal(events.includes("close-storage"), false, `${trigger}: timed-out cleanup resumed storage close`);
  }
});

test("Tailscale UI exceptions are non-fatal", async () => {
  const { page, worker } = endpointPair();
  const client = createLinuxWorkerClient(page, {
    onTailscaleEvent: () => { throw new Error("storage denied"); },
  });
  worker.addEventListener("message", ({ data }) => {
    if (data.type === "boot") {
      worker.postMessage({ type: "ready", version: LINUX_WORKER_PROTOCOL_VERSION, restored: false });
    } else if (data.type === "call") {
      worker.postMessage({
        type: "result", version: LINUX_WORKER_PROTOCOL_VERSION, id: data.id, result: true,
      });
    }
  });
  const controller = await client.boot({});
  worker.postMessage({
    type: "tailscale-event", version: LINUX_WORKER_PROTOCOL_VERSION, message: { type: "storageUpdate" },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(await controller.resume(), true);
  worker.postMessage({ type: "done", version: LINUX_WORKER_PROTOCOL_VERSION, state: "stopped" });
  assert.equal(await controller.whenDone, "stopped");
});

test("backend-neutral stop closes main storage but does not RPC after worker termination", async () => {
  const mainEvents = [];
  await stopLinuxController({
    backend: "main-thread",
    stop: async () => mainEvents.push("stop"),
    releaseWriterLock: async () => mainEvents.push("release"),
    closeStorage: async () => mainEvents.push("close"),
  });
  assert.deepEqual(mainEvents, ["stop", "release", "close"]);
  const stopFailureEvents = [];
  await assert.rejects(() => stopLinuxController({
    backend: "main-thread",
    stop: async () => { stopFailureEvents.push("stop"); throw new Error("stop failed"); },
    releaseWriterLock: async () => stopFailureEvents.push("release"),
    closeStorage: async () => stopFailureEvents.push("close"),
  }), /stop failed/);
  assert.deepEqual(stopFailureEvents, ["stop", "release", "close"]);
  const releaseFailureEvents = [];
  await assert.rejects(() => stopLinuxController({
    backend: "main-thread",
    stop: async () => releaseFailureEvents.push("stop"),
    releaseWriterLock: async () => { releaseFailureEvents.push("release"); throw new Error("release failed"); },
    closeStorage: async () => releaseFailureEvents.push("close"),
  }), /release failed/);
  assert.deepEqual(releaseFailureEvents, ["stop", "release", "close"]);
  const workerEvents = [];
  await stopLinuxController({
    backend: "whole-machine-worker",
    stop: async () => workerEvents.push("stop"),
    releaseWriterLock: async () => workerEvents.push("release"),
    closeStorage: async () => workerEvents.push("close"),
  });
  assert.deepEqual(workerEvents, ["stop"]);
});
