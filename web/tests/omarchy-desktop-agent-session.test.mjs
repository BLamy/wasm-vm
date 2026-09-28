// T03l: synthetic host/lifecycle fixtures, NOT guest boot or desktop-response evidence.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createDesktopAgentSession } from "../desktop-agent-session.js";
import { restoreDesktopThroughHost } from "../desktop-restore.js";
import { AgentFrameDecoder, CAP_PING, encodeFrame, TYPE_HELLO } from "../agent-channel.js";

const noop = () => {};
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
function bridgeSpy() {
  const bridges = [];
  function createBridge(controller) {
    const received = [], calls = [];
    const channel = {
      state: "idle", ready: Promise.resolve({ version: 1 }),
      start() { calls.push("start"); this.state = "ready"; },
      waitUntilReady: async () => ({ version: 1 }),
      rehandshake: async () => { calls.push("rehandshake"); return { version: 1 }; },
      subscribe: () => { calls.push("subscribe"); return noop; },
      subscribeState: () => { calls.push("subscribeState"); return noop; },
      send: (type, bytes) => controller.sendAgentInput(bytes),
      close() { calls.push("close"); this.state = "closed"; },
    };
    const bridge = { controller, channel, received, calls,
      start: () => channel.start(), close: () => channel.close(),
      receive: (bytes) => { received.push(bytes); return bytes.length; } };
    bridges.push(bridge);
    return bridge;
  }
  return { bridges, createBridge };
}

test("lazy Omarchy discards pre-controller and dormant bytes; availability reads are passive", () => {
  const spy = bridgeSpy();
  const session = createDesktopAgentSession({ request: { key: "omarchy", generation: 1 },
    isCurrent: () => true, createBridge: spy.createBridge });
  for (let i = 0; i < 1000; i++) assert.equal(session.receive(Uint8Array.of(i)), 0);
  session.attach({ sendAgentInput() { assert.fail("unsolicited send"); } });
  for (let i = 0; i < 1000; i++) session.receive(Uint8Array.of(i));
  const channel = session.channel;
  assert.equal(channel.state, "idle");
  assert.equal(channel.negotiated, null);
  assert.equal(channel.negotiatedVersion, null);
  assert.equal(channel.negotiatedCapabilities, 0n);
  assert.equal(channel.transportGeneration, 0);
  assert.equal(channel.pendingCount, 0);
  assert.equal(channel.transportListenerCount, 0);
  assert.equal(channel.listenerCount(TYPE_HELLO), 0);
  assert.equal(channel.supports(CAP_PING), false);
  assert.ok(channel.ready instanceof Promise);
  for (const method of ["start", "send", "subscribe", "subscribeState", "rehandshake"]) {
    assert.equal(typeof channel[method], "function");
  }
  assert.equal(spy.bridges.length, 0);
  channel.subscribe(TYPE_HELLO, noop); // Existing clipboard consumer activation seam.
  channel.subscribeState(noop);
  channel.start();
  assert.equal(spy.bridges.length, 1);
  assert.deepEqual(spy.bridges[0].received, [], "no dormant backlog reaches explicit consumer");
  assert.deepEqual(spy.bridges[0].calls, ["start", "subscribe", "subscribeState"]);
  session.close();
});

test("CLI retains a bounded owned pre-controller queue and automatically starts exactly once", () => {
  for (const key of ["busybox", "alpine", "node-alpine"]) {
    const spy = bridgeSpy();
    const session = createDesktopAgentSession({ request: { key, generation: 1 },
      isCurrent: () => true, createBridge: spy.createBridge });
    const bytes = Uint8Array.of(0);
    for (let i = 0; i < 140; i++) { bytes[0] = i; session.receive(bytes); }
    bytes[0] = 255;
    const controller = { sendAgentInput: noop };
    session.attach(controller);
    session.attach(controller);
    assert.equal(spy.bridges.length, 1);
    assert.deepEqual(spy.bridges[0].calls, ["start"]);
    assert.deepEqual(spy.bridges[0].received.map((b) => b[0]), Array.from({ length: 128 }, (_, i) => i + 12));
    session.close();
  }
});

test("retired lazy references cannot activate; old active transports cannot send into any owner", async () => {
  const spy = bridgeSpy();
  let owner = 1;
  let sent = 0;
  const make = (generation) => createDesktopAgentSession({ request: { key: "omarchy", generation },
    isCurrent: () => owner === generation, createBridge: spy.createBridge });
  const dormant = make(1);
  dormant.attach({ sendAgentInput: () => ++sent });
  owner = 2;
  assert.throws(() => dormant.channel.start(), /retired/);
  await assert.rejects(dormant.channel.rehandshake(), /retired/);
  assert.equal(spy.bridges.length, 0);
  const active = make(2);
  active.attach({ sendAgentInput: () => ++sent });
  active.channel.start();
  const retainedTransport = spy.bridges[0].controller;
  owner = 3;
  await assert.rejects(retainedTransport.sendAgentInput(Uint8Array.of(1)), /retired/);
  await assert.rejects(active.channel.send(1, Uint8Array.of(1)), /retired/);
  assert.equal(active.receive(Uint8Array.of(1)), 0);
  assert.equal(active.attach({ sendAgentInput: noop }), false);
  assert.equal(sent, 0);
  assert.deepEqual(spy.bridges[0].calls, ["start", "close"]);
});

function helloFrame() {
  const payload = new Uint8Array(10);
  const view = new DataView(payload.buffer);
  view.setUint16(0, 1, true);
  view.setBigUint64(2, CAP_PING, true);
  return encodeFrame(TYPE_HELLO, payload);
}
test("explicit restore uses the real Channel fresh HELLO, not preloaded Omarchy output", async (t) => {
  const decoder = new AgentFrameDecoder();
  const order = [];
  let session;
  const controller = {
    sendAgentInput(bytes) {
      decoder.push(bytes, (frame) => {
        assert.equal(frame.type, TYPE_HELLO);
        order.push("HELLO");
        queueMicrotask(() => session.receive(helloFrame())); // Reply only to observed command.
      });
      return Promise.resolve(bytes.length);
    },
    async confirmAgentHello() { order.push("confirm"); return true; },
    async restoreDesktopSnapshot(bytes, width, height) {
      order.push("restore");
      assert.deepEqual([...bytes], [1, 2]);
      return { hostViewport: { width, height } };
    },
  };
  session = createDesktopAgentSession({ request: { key: "omarchy", generation: 1 }, isCurrent: () => true });
  t.after(() => session.close());
  session.receive(helloFrame());
  session.attach(controller);
  session.receive(helloFrame());
  await flush();
  assert.deepEqual(order, []);
  await restoreDesktopThroughHost({ controller, agentChannel: session.channel,
    presentation: { clear: noop, setViewport: (width, height) => ({ width, height }) },
  }, Uint8Array.of(1, 2), { width: 640, height: 480 });
  assert.deepEqual(order, ["HELLO", "HELLO", "confirm", "restore"]);
  assert.equal(session.channel.negotiatedVersion, 1);
});

const mainSource = readFileSync(new URL("../main.js", import.meta.url), "utf8");
function mainSlice(start, end) {
  const i = mainSource.indexOf(start), j = mainSource.indexOf(end, i + start.length);
  assert.ok(i >= 0 && j > i, `actual main source boundary: ${start}`);
  return mainSource.slice(i, j);
}
// Execute the production functions verbatim; mock only browser/device dependencies. This is a
// host wiring fixture, not a substituted copy of the ownership or activation implementation.
function mainFixture() {
  const spy = bridgeSpy(), events = [], outputs = [], bootOptions = [], controls = [], timers = new Map();
  let timerId = 0;
  const context = vm.createContext({
    URLSearchParams, TextDecoder, TextEncoder, Uint8Array, Event, console, performance,
    window: { dispatchEvent(event) { events.push({ type: event.type, session: this.wvmDemo.guestSession() }); } },
    document: { hidden: false, documentElement: { dataset: {} }, getElementById: () => null },
    location: { search: "?guest=omarchy&desktop=1" },
    createDesktopAgentSession: (opts) => createDesktopAgentSession({ ...opts, createBridge: spy.createBridge }),
    restoreDesktopThroughHost,
    bootLinuxBtn: null, bootAlpineBtn: null, bootAlpineFullBtn: null,
    audioReady: Promise.resolve(), audioPipelineReady: false, audioSink: null,
    microphoneRing: null, microphoneSampleRateHz: 48000, micEnabled: false,
    microphoneCapture: { reset: noop, onPcmStart: () => controls.push("capture") },
    updateMicrophoneIndicator: noop, flushMicrophoneGuestEvents: () => controls.push("microphone"),
    _workerRequested: false, _workerAvailable: true, _useCpuWorker: true,
    _omarchyDesktopMode: true, _desktopPerfHooksRequested: false,
    _desktopPerfStatsTimer: null, _desktopPerfGuestInstructions: null,
    networkProviderEl: null, networkWebsocketEl: null, networkRelayEl: null,
    term: { reset: noop, writeln: (s) => outputs.push(s) },
    ui: { write: (bytes) => outputs.push(new TextDecoder().decode(bytes)), attachSink: noop,
      detachSink: noop, fitNow: noop, focus: noop },
    bootProgressEl: {}, bootProgress: { state: {}, begin: noop, onState: noop,
      onProgress: noop, scanOutput: noop, fail: (e) => assert.fail(e), dispatch: noop },
    quietGuestExec: false, currentGuestKind: "omarchy", lastBootError: null,
    emitConsole: noop, emitGuestLifecycleEvent: (type, detail) => events.push({ type, detail }),
    setStatus: noop, setGuestChip: noop, setRunBanner: noop,
    renderLinuxQuotaDialog: noop, renderLinuxWriterStatus: noop,
    presentation: { snapshot: () => ({ scheduler: true, successfulPresents: 1 }),
      readPixels: () => Uint8Array.of(1), clear: noop, setViewport: (width, height) => ({ width, height }) },
    displayViewport: { setController: (ctl) => controls.push(["viewport", ctl]) },
    displayCanvas: { focus: () => controls.push("focus") },
    handleDisplayFrame: () => controls.push("frame"),
    cursorController: { reset: noop, handle: () => controls.push("cursor") }, cursorDiagnostics: [],
    pointerBridge: { reset: noop }, updatePointerIndicator: () => controls.push("pointer"),
    createWasmKeyboardAdapter: (ctl) => ctl,
    createKeyboardBridge: () => { controls.push("keyboard"); return { resetHeld: noop }; },
    createKeyboardReconciler: () => ({}), keyboardBridge: null, keyboardReconciler: null,
    keyboardLedState: {}, keyboardDiagnostics: [], keyboardFrames: [],
    keyboardCapture: { clearTransientState: noop }, keyboardSuppressLateKeyups: false,
    keyboardLastReleaseReason: "", updateKeyboardDebug: noop,
    startKeyboardLedPoll: () => controls.push("LED"), stopKeyboardLedPoll: noop,
    fileTransferUI: { attachController: noop }, cancelActiveStream: noop, rejectPendingGuestExecs: noop,
    guestExec: async (...args) => { controls.push(["guestExec", ...args]); return { exit: 1, stdout: "" }; },
    hasOmarchyDesktopLayers: () => false, hasDesktopPixels: () => true,
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout: (id) => timers.delete(id), setInterval: () => { assert.fail("unexpected interval"); },
    clearInterval: noop, stopLinuxController: async () => {},
    _bootLinux: async (opts) => { bootOptions.push(opts); return context.nextController; },
  });
  vm.runInContext([
    mainSlice("let linuxCtl = null;", "function updateMicrophoneIndicator("),
    mainSlice("function teardownLinuxController(", "function linuxRequestCanRenderOwnerUi("),
    mainSlice("function runLinuxBoot(", "if (bootLinuxBtn) {"),
    mainSlice("let guestReady = false;", "// E3.6-T05: shared body"),
    mainSlice("window.wvmDemo = {", "// E2-T22: \"Fit\""),
    mainSlice("window.__desktopRestore =", "// E3-T21c proof hook"),
  ].join("\n"), context, { filename: "actual-main-lifecycle-fixture.js" });
  function controller() {
    const done = deferred();
    const sent = [];
    return { backend: "whole-machine-worker", whenDone: done.promise, done, sent,
      sendAgentInput: (bytes) => { sent.push([...bytes]); return Promise.resolve(bytes.length); },
      jitStats: async () => ({ hasExecutor: true }), sendInput: noop,
      confirmAgentHello: async () => true,
      restoreDesktopSnapshot: async (bytes, width, height) => ({ hostViewport: { width, height } }),
    };
  }
  async function boot(key, ctl = controller()) {
    context.nextController = ctl;
    context.currentGuestKind = key;
    const result = await context.runLinuxBoot({ manifestUrl: `./${key}.json` }, "fixture", { requestKey: key });
    assert.equal(context.lastBootError, null, outputs.join("\n"));
    return { result, ctl };
  }
  return { context, spy, events, outputs, bootOptions, controls, timers, controller, boot };
}

test("actual main publishes the winning generation during early guest-ready, never query identity", async () => {
  const f = mainFixture(), entered = deferred(), release = deferred();
  const { context: c } = f;
  const ctl = f.controller();
  c._bootLinux = async (opts) => {
    f.bootOptions.push(opts);
    opts.onAgentOutput(helloFrame());
    opts.onOutput(new TextEncoder().encode("[omarchy@omarchy-demo ~]$ "));
    entered.resolve();
    await release.promise;
    return ctl;
  };
  assert.equal(c.window.wvmDemo.guestSession(), null);
  const pending = f.boot("omarchy", ctl);
  await entered.promise;
  const ready = f.events.find((e) => e.type === "wvm:guest-ready");
  assert.equal(JSON.stringify(ready.session), '{"key":"omarchy","generation":1}');
  assert.equal(c.window.wvmDemo.isGuestUp(), false, "ready event predates active controller assignment");
  const first = c.window.wvmDemo.guestSession();
  first.key = "busybox";
  assert.equal(c.window.wvmDemo.guestSession().key, "omarchy");
  const conflict = await c.runLinuxBoot({ manifestUrl: "busybox" }, "", { requestKey: "busybox" });
  assert.equal(conflict.conflict, true);
  assert.equal(c.window.wvmDemo.guestSession().generation, 1);
  release.resolve();
  await pending;
  assert.equal(f.spy.bridges.length, 0);
  assert.equal(c.window.__agentChannel, c.window.__desktopAgentChannel);
  assert.equal(c.window.__agentChannel.state, "idle");
  assert.equal(f.bootOptions[0].onDisplayFrame, c.handleDisplayFrame);
  f.bootOptions[0].onCursorState({});
  f.bootOptions[0].onCaptureStart({});
  for (const name of ["keyboard", "LED", "microphone", "pointer", "cursor", "capture", "focus"]) {
    assert.ok(f.controls.includes(name), `retained ${name} path`);
  }
  const check = [...f.timers.values()].find((timer) => timer.delay === 1000);
  assert.ok(check, "real desktop readiness timer retained");
  await check.fn();
  const rpc = f.controls.find((row) => row?.[0] === "guestExec");
  assert.equal(rpc[1], "XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers");
  assert.equal(rpc[2], 300000);
  assert.equal(rpc[4].quiet, true);
  assert.ok(!f.events.some((e) => e.type === "wvm:desktop-ready"), "failed real query is not readiness");
  await c.retireLinuxController(ctl);
});

test("actual main supplied restore bypasses default; omitted channel activates one shared session", async () => {
  const f = mainFixture(), { context: c } = f;
  const { ctl } = await f.boot("omarchy");
  let suppliedHandshakes = 0;
  const supplied = { state: "ready", async rehandshake() { suppliedHandshakes++; return { version: 1 }; } };
  await c.window.__desktopRestore(Uint8Array.of(1), { width: 640, height: 480 }, supplied);
  assert.equal(suppliedHandshakes, 1);
  assert.equal(f.spy.bridges.length, 0);
  await c.window.__desktopRestore(Uint8Array.of(1), { width: 640, height: 480 });
  await c.window.__desktopRestore(Uint8Array.of(2), { width: 800, height: 600 });
  assert.equal(f.spy.bridges.length, 1);
  assert.deepEqual(f.spy.bridges[0].calls, ["start", "rehandshake", "rehandshake"]);
  await c.retireLinuxController(ctl);
});

test("actual main fences retirement immediately and ignores late callbacks/retained channels", async () => {
  const f = mainFixture(), { context: c } = f;
  const old = await f.boot("omarchy");
  const callbacks = f.bootOptions[0], retained = c.window.__agentChannel;
  retained.start();
  const teardown = deferred();
  c.stopLinuxController = () => teardown.promise;
  const retiring = c.retireLinuxController(old.ctl);
  assert.equal(c.window.wvmDemo.guestSession(), null, "not an owner while teardown awaits");
  assert.equal(retained.state, "closed");
  assert.throws(() => retained.start(), /retired/);
  await assert.rejects(retained.rehandshake(), /retired/);
  teardown.resolve();
  await retiring;
  c.stopLinuxController = async () => {};
  const next = await f.boot("busybox"); // Stale Omarchy query/CSS remain deliberately present.
  assert.equal(c.window.wvmDemo.guestSession().key, "busybox");
  assert.equal(c.window.wvmDemo.guestSession().generation, 2);
  assert.equal(f.spy.bridges.length, 2);
  assert.deepEqual(f.spy.bridges[1].calls, ["start"]);
  await f.boot("busybox", next.ctl);
  assert.equal(f.spy.bridges.length, 2);
  const progressFailures = [];
  c.bootProgress.fail = (message) => {
    progressFailures.push(message);
    c.bootProgress.state.error = message;
  };
  const progressBefore = { ...c.bootProgress.state };
  const eventCount = f.events.length, outputCount = f.outputs.length;
  callbacks.onAgentOutput(helloFrame());
  callbacks.onOutput(new TextEncoder().encode("\n~ # "));
  callbacks.onState("restored");
  callbacks.onProgress("kernel", 1, 1);
  callbacks.onError(new Error("retired Omarchy error"));
  await assert.rejects(f.spy.bridges[0].controller.sendAgentInput(Uint8Array.of(1)), /retired/);
  old.ctl.done.resolve("poweroff");
  await flush();
  assert.equal(f.events.length, eventCount);
  assert.equal(f.outputs.length, outputCount);
  assert.deepEqual(progressFailures, []);
  assert.deepEqual(c.bootProgress.state, progressBefore);
  assert.deepEqual(f.spy.bridges[1].received, []);
  assert.deepEqual(next.ctl.sent, []);
  assert.equal(c.window.wvmDemo.guestSession().generation, 2);
  // Current-owner errors must still reach all three existing reporting surfaces.
  f.bootOptions[1].onError(new Error("current BusyBox error"));
  assert.deepEqual(progressFailures, ["current BusyBox error"]);
  assert.equal(c.bootProgress.state.error, "current BusyBox error");
  assert.match(f.outputs.at(-1), /boot error: current BusyBox error/);
  assert.equal(f.events.at(-1).type, "wvm:guest-error");
  assert.equal(f.events.at(-1).detail.message, "current BusyBox error");
  await c.retireLinuxController(next.ctl);
});
