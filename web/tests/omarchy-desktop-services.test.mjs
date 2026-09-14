// T03l: exercise the production IDE service lifecycle without booting a guest.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const ide = readFileSync(new URL("../ide.js", import.meta.url), "utf8");
const main = readFileSync(new URL("../main.js", import.meta.url), "utf8");
const loader = readFileSync(new URL("../loader.js", import.meta.url), "utf8");

function sourceFunction(source, signature, nextDeclaration) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing production ${signature}`);
  const end = source.indexOf(nextDeclaration, start);
  assert.ok(end > start, `missing production ending for ${signature}`);
  return source.slice(start, end);
}

function lifecycleFixture() {
  const calls = [];
  let rawSession = null;
  let sideView = "files";
  const context = {
    cliGuestServicesSession: () => rawSession?.key === "omarchy" ? null : rawSession,
    sameGuestSession: (expected) => Boolean(expected && rawSession &&
      expected.key === rawSession.key && expected.generation === rawSession.generation),
    resetDockerRuntime: () => calls.push("reset"),
    loadTree: () => calls.push("loadTree"),
    showNoTab: () => calls.push("showNoTab"),
    refreshGuestStatus: () => calls.push("status"),
    renderDocker: () => calls.push("renderDocker"),
    startPsPoll: () => calls.push("startPsPoll"),
    stopPsPoll: () => calls.push("stopPsPoll"),
    stopAllLogStreams: () => calls.push("stopAllLogStreams"),
    explorerEl: { innerHTML: "" },
    tabs: [],
    get sideView() { return sideView; },
  };
  const showReady = sourceFunction(ide, "  function showReady() {", "\n\n  window.addEventListener(\"wvm:guest-ready\"");
  const showBooting = sourceFunction(ide, "  function showBooting(event = null) {", "\n  function showReady()");
  vm.runInNewContext(`let initializedGuestServices = null; ${showBooting}; ${showReady}; globalThis.showBooting = showBooting; globalThis.showReady = showReady;`, context);
  return {
    calls,
    context,
    setSession(value) { rawSession = value; },
    setSideView(value) { sideView = value; },
    showBooting: context.showBooting,
    showReady: context.showReady,
  };
}

function rpcFixture({ desktopFlag = false } = {}) {
  const calls = [];
  let rawSession = null;
  let resolveExec;
  const context = {
    window: {
      wvmDemo: {
        guestSession: () => rawSession,
        exec(command, timeout, options) {
          calls.push({ command, timeout, options });
          return new Promise((resolve) => { resolveExec = resolve; });
        },
      },
    },
  };
  const helpers = sourceFunction(ide, "  function guestSession() {", "\n\n  function selectedProvider()");
  vm.runInNewContext(`const api = () => window.wvmDemo; const OMARCHY_DESKTOP_MODE = ${desktopFlag}; ${helpers} globalThis.bgExec = bgExec;`, context);
  return {
    calls,
    setSession(value) { rawSession = value; },
    call(command) { return context.bgExec(command, 30000); },
    resolve(value) { resolveExec(value); },
  };
}

function logStreamFixture() {
  const calls = [];
  let rawSession = { key: "alpine", generation: 31 };
  let releaseRefresh;
  const context = {
    cliGuestServicesSession: () => rawSession?.key === "omarchy" ? null : rawSession,
    sameGuestSession: (expected) => Boolean(expected && rawSession &&
      expected.key === rawSession.key && expected.generation === rawSession.generation),
    api: () => ({
      stream(command) {
        calls.push(command);
        return { stop: async () => {} };
      },
    }),
    shq: (value) => `'${value}'`,
    renderContainerLogs: () => {},
    appendContainerLogLine: () => {},
    refreshContainers: () => {},
    stopAllLogStreams: () => calls.push("stopAllLogStreams"),
    resetDockerRuntime: () => calls.push("resetDockerRuntime"),
    explorerEl: { innerHTML: "" },
    tabs: [],
    showNoTab: () => {},
    refreshGuestStatus: () => {},
    sideView: "files",
  };
  const startLogStream = sourceFunction(ide, "  async function startLogStream(t) {", "\n  async function refreshContainerLogs");
  const showBooting = sourceFunction(ide, "  function showBooting(event = null) {", "\n  function showReady()");
  vm.runInNewContext(`let initializedGuestServices = null; ${startLogStream}; ${showBooting}; globalThis.startLogStream = startLogStream; globalThis.showBooting = showBooting;`, context);
  return {
    calls,
    context,
    setSession(value) { rawSession = value; },
    start(t) { return context.startLogStream(t); },
    booting(event) { return context.showBooting(event); },
    setTabs(value) { context.tabs = value; },
    delayedRefresh() {
      return new Promise((resolve) => { releaseRefresh = resolve; });
    },
    releaseRefresh() { releaseRefresh(); },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function catalogFixture() {
  const calls = [];
  let rawSession = { key: "alpine", generation: 41 };
  const response = deferred();
  const context = {
    cliGuestServicesSession: () => rawSession?.key === "omarchy" ? null : rawSession,
    sameGuestSession: (expected) => Boolean(expected && rawSession &&
      expected.key === rawSession.key && expected.generation === rawSession.generation),
    runtimeReady: () => rawSession?.key !== "omarchy" && rawSession != null,
    bgExec(command) { calls.push(`exec:${command}`); return response.promise; },
    dockerRuntime: { generation: 1 },
    dockerCatalog: {
      status: "unknown", error: "", code: "", raw: null, entries: [], promise: null,
      generation: 0, selected: null, lastRun: null,
    },
    sideView: "docker",
    parseGuestJson: () => [],
    normalizeCatalog: () => [],
    loadGuestBundleMetadata: async () => true,
    renderDocker: () => calls.push("renderDocker"),
  };
  const fn = sourceFunction(ide, "  function loadDockerCatalog() {", "\n\n  function resetDockerRuntime");
  vm.runInNewContext(`${fn}; globalThis.loadDockerCatalog = loadDockerCatalog;`, context);
  return {
    calls,
    start() { return context.loadDockerCatalog(); },
    setSession(value) { rawSession = value; },
    resolve(value) { response.resolve(value); },
    context,
  };
}

function probeFixture() {
  const calls = [];
  let rawSession = { key: "alpine", generation: 51 };
  const response = deferred();
  const currentApi = {
    hasContainerRuntime() { calls.push("hasContainerRuntime"); return response.promise; },
  };
  const context = {
    cliGuestServicesSession: () => rawSession?.key === "omarchy" ? null : rawSession,
    sameGuestSession: (expected) => Boolean(expected && rawSession &&
      expected.key === rawSession.key && expected.generation === rawSession.generation),
    api: () => currentApi,
    ready: () => true,
    guestUp: () => true,
    dockerRuntime: { generation: 1, status: "unknown", error: "", code: "", probe: null },
    sideView: "docker",
    setDockerError: (...args) => calls.push(["error", ...args]),
    renderDocker: () => calls.push("renderDocker"),
    startPsPoll: () => calls.push("startPsPoll"),
    stopPsPoll: () => calls.push("stopPsPoll"),
  };
  const fn = sourceFunction(ide, "  function probeDockerRuntime() {", "\n\n  function bootAlpineFromDocker");
  vm.runInNewContext(`${fn}; globalThis.probeDockerRuntime = probeDockerRuntime;`, context);
  return {
    calls,
    start() { return context.probeDockerRuntime(); },
    setSession(value) { rawSession = value; },
    resolve(value) { response.resolve(value); },
    context,
  };
}

function snapshotFixture(kind) {
  const calls = [];
  let rawSession = { key: "alpine", generation: 61 };
  const response = deferred();
  const currentApi = {
    snapshotStatus() { calls.push("snapshotStatus"); return response.promise; },
    snapshotSave() { calls.push("snapshotSave"); return response.promise; },
  };
  const context = {
    cliGuestServicesSession: () => rawSession?.key === "omarchy" ? null : rawSession,
    sameGuestSession: (expected) => Boolean(expected && rawSession &&
      expected.key === rawSession.key && expected.generation === rawSession.generation),
    api: () => currentApi,
    runtimeReady: () => rawSession?.key !== "omarchy" && rawSession != null,
    dockerRuntime: {
      generation: 1,
      snapshot: { status: "unknown", decision: "missing", generation: null, restored: false },
    },
    sideView: "docker",
    renderDocker: () => calls.push("renderDocker"),
  };
  const fn = kind === "status"
    ? sourceFunction(ide, "  async function refreshDockerSnapshot() {", "\n\n  async function saveDockerSnapshot")
    : sourceFunction(ide, "  async function saveDockerSnapshot() {", "\n\n  function probeDockerRuntime");
  vm.runInNewContext(`${fn}; globalThis.snapshotFn = ${kind === "status" ? "refreshDockerSnapshot" : "saveDockerSnapshot"};`, context);
  return {
    calls,
    start() { return context.snapshotFn(); },
    setSession(value) { rawSession = value; },
    resolve(value) { response.resolve(value); },
    context,
  };
}

function containersFixture() {
  const calls = [];
  let rawSession = { key: "alpine", generation: 71 };
  const response = deferred();
  const context = {
    cliGuestServicesSession: () => rawSession?.key === "omarchy" ? null : rawSession,
    sameGuestSession: (expected) => Boolean(expected && rawSession &&
      expected.key === rawSession.key && expected.generation === rawSession.generation),
    runtimeReady: () => rawSession?.key !== "omarchy" && rawSession != null,
    sideView: "docker",
    dockerRuntime: { generation: 1 },
    containerRefreshPromise: null,
    containerLedger: { status: "unknown", error: "", code: "", rows: [], lastCommand: "", action: null },
    document: { getElementById: () => null },
    renderContainerList: () => {},
    repaintContainerList: () => calls.push("repaintContainerList"),
    bgExec(command) { calls.push(`exec:${command}`); return response.promise; },
    parsePs: () => [],
  };
  const fn = sourceFunction(ide, "  async function refreshContainers({ force = false } = {}) {", "\n\n  function renderContainerList");
  vm.runInNewContext(`${fn}; globalThis.refreshContainers = refreshContainers;`, context);
  return {
    calls,
    start() { return context.refreshContainers(); },
    setSession(value) { rawSession = value; },
    resolve(value) { response.resolve(value); },
    context,
  };
}

function actionFixture() {
  const calls = [];
  let rawSession = { key: "alpine", generation: 81 };
  const response = deferred();
  let resolveCommandEntered;
  const commandEntered = new Promise((resolve) => { resolveCommandEntered = resolve; });
  const context = {
    cliGuestServicesSession: () => rawSession?.key === "omarchy" ? null : rawSession,
    sameGuestSession: (expected) => Boolean(expected && rawSession &&
      expected.key === rawSession.key && expected.generation === rawSession.generation),
    runtimeReady: () => rawSession?.key !== "omarchy" && rawSession != null,
    dockerRuntime: { generation: 1 },
    containerLedger: {
      action: null, rows: [{ id: "ctr1", name: "demo", status: "running" }],
      error: "", code: "", lastCommand: "",
    },
    containerRefreshPromise: null,
    stopContainerStreams: async () => {},
    shq: (value) => `'${value}'`,
    setContainerActionCommand: (command) => calls.push(`command:${command}`),
    runGuestContainerCommand: () => {
      calls.push("runGuestContainerCommand");
      resolveCommandEntered();
      return response.promise;
    },
    repaintContainerList: () => calls.push("repaintContainerList"),
  };
  const fn = sourceFunction(ide, "  async function runContainerAction(row, kind) {", "\n\n  function renderImageInspect");
  vm.runInNewContext(`${fn}; globalThis.runContainerAction = runContainerAction;`, context);
  return {
    calls,
    start() { return context.runContainerAction({ id: "ctr1" }, "stop"); },
    retireAndReplace() {
      rawSession = { key: "omarchy", generation: 82 };
      context.containerLedger.action = null;
      rawSession = { key: "alpine", generation: 83 };
    },
    resolve(value) { response.resolve(value); },
    waitForCommand() { return commandEntered; },
    context,
  };
}

test("the actual ready lifecycle is once per authoritative generation and isolates Omarchy", () => {
  const f = lifecycleFixture();

  f.showReady();
  assert.deepEqual(f.calls.filter((call) => call === "loadTree"), [], "no owner cannot authorize Explorer");

  f.setSession({ key: "omarchy", generation: 1 });
  f.setSideView("docker");
  f.showReady();
  f.showReady();
  assert.equal(f.calls.filter((call) => call === "loadTree").length, 0,
    "duplicate and delayed Omarchy ready events stay isolated");
  assert.equal(f.calls.filter((call) => call === "renderDocker").length, 0,
    "saved Docker view cannot start Omarchy guest services");

  f.setSession({ key: "alpine", generation: 7 });
  f.showReady();
  f.showReady();
  assert.equal(f.calls.filter((call) => call === "loadTree").length, 1,
    "CLI readiness initializes Explorer once for one winning generation");
  assert.equal(f.calls.filter((call) => call === "renderDocker").length, 1,
    "CLI readiness renders the saved Docker view once");

  f.showBooting({ type: "wvm:guest-booting" });
  f.setSession({ key: "alpine", generation: 8 });
  f.showReady();
  assert.equal(f.calls.filter((call) => call === "loadTree").length, 2,
    "a subsequent eligible CLI generation initializes once");
});

test("actual RPC gate rejects no-owner/retired work and fences late CLI completion", async () => {
  const f = rpcFixture({ desktopFlag: false });

  await assert.rejects(f.call("ls -la '/root'"), /disabled/u);
  assert.equal(f.calls.length, 0, "no owner cannot issue guest RPC");

  f.setSession({ key: "alpine", generation: 11 });
  const pending = f.call("ls -la '/root'");
  assert.equal(f.calls.length, 1);
  f.setSession({ key: "omarchy", generation: 12 });
  f.resolve({ exit: 0, stdout: "stale" });
  await assert.rejects(pending, /retired session/u);

  f.setSession({ key: "busybox", generation: 13 });
  const allowed = f.call("ls -la '/root'");
  f.resolve({ exit: 0, stdout: "cli" });
  assert.deepEqual(await allowed, { exit: 0, stdout: "cli" });
});

test("the authoritative Omarchy key blocks service RPC even when the page is not marked desktop", async () => {
  const f = rpcFixture({ desktopFlag: false });
  f.setSession({ key: "omarchy", generation: 21 });
  await assert.rejects(f.call("cat /opt/containers/index.json"), /disabled/u);
  assert.equal(f.calls.length, 0);
});

test("desktop control entry points remain wired to the existing production bridges", () => {
  assert.match(main, /const keyboardHost = _omarchyDesktopMode \? displayCanvas/u);
  assert.match(main, /const pointerHost = _omarchyDesktopMode \? displayCanvas/u);
  assert.match(main, /new DisplayViewportController\(/u);
  assert.match(main, /onDisplayFrame: handleDisplayFrame/u);
  assert.match(main, /startKeyboardLedPoll\(ctlForRelease\)/u);
  assert.match(loader, /machine\.attachDisplay\(/u);
  assert.match(loader, /machine\.attachAudioOutput\(/u);
  assert.match(ide, /id="ide-display-canvas"/u);
  assert.match(ide, /window\.addEventListener\("wvm:guest-ready", showReady\)/u);
  assert.match(ide, /window\.addEventListener\("wvm:guest-booting", showBooting\)/u);
  assert.match(ide, /file-transfer/u);
  assert.match(main, /fileTransfer: false/u);
});

test("host-only preboot Docker affordance remains available, but an Omarchy owner blocks it", () => {
  assert.match(ide, /function probeAlpineAssets\(\) \{\s*if \(guestSession\(\)\?\.key === "omarchy"\) return Promise\.resolve\(false\);/u);
  assert.match(ide, /function bootAlpineFromDocker\(\) \{\s*const current = api\(\);\s*if \(guestSession\(\)\?\.key === "omarchy"\) return;/u);
  assert.match(ide, /function renderDocker\(\) \{\s*dkEl\.replaceChildren\(\);\s*if \(guestSession\(\)\?\.key === "omarchy"\)/u);
});

test("a retired CLI log refresh cannot create a stream for the Omarchy owner", async () => {
  const f = logStreamFixture();
  const refresh = f.delayedRefresh();
  const tab = {
    type: "container", id: "ctr1", follow: true, stream: null, streamStarting: false,
    logRefreshPromise: refresh, stopPromise: null, streamGeneration: 0,
    logsError: "", logsCode: "", logsText: "", lastStreamExit: null,
  };
  const pending = f.start(tab);
  f.setSession({ key: "omarchy", generation: 32 });
  f.setTabs([tab]);
  f.booting({ type: "wvm:guest-booting" });
  f.releaseRefresh();
  await pending;
  assert.equal(f.calls.includes("stopAllLogStreams"), true,
    "the retirement attack passes through the production boot lifecycle");
  assert.deepEqual(f.calls.filter((call) => call.startsWith("wvrun logs")), [],
    "retired CLI work must not call api().stream");

  f.setSession({ key: "busybox", generation: 33 });
  tab.logRefreshPromise = Promise.resolve();
  await f.start(tab);
  assert.deepEqual(f.calls.filter((call) => call.startsWith("wvrun logs")), ["wvrun logs -f 'ctr1'"],
    "an eligible CLI session retains the stream path");
});

test("retired catalog/probe/snapshot/container completions cannot repaint a replacement owner", async () => {
  const catalog = catalogFixture();
  const catalogPending = catalog.start();
  await Promise.resolve();
  catalog.setSession({ key: "omarchy", generation: 42 });
  catalog.setSession({ key: "alpine", generation: 43 });
  catalog.resolve({ exit: 0, stdout: "[]" });
  assert.equal(await catalogPending, false);
  await Promise.resolve();
  assert.equal(catalog.calls.includes("renderDocker"), false);
  assert.equal(catalog.context.dockerCatalog.promise, null);

  const probe = probeFixture();
  const probePending = probe.start();
  await Promise.resolve();
  probe.setSession({ key: "omarchy", generation: 52 });
  probe.setSession({ key: "alpine", generation: 53 });
  probe.resolve(true);
  assert.equal(await probePending, false);
  await Promise.resolve();
  assert.equal(probe.calls.includes("renderDocker"), false);
  assert.equal(probe.context.dockerRuntime.probe, null);

  for (const kind of ["status", "save"]) {
    const snapshot = snapshotFixture(kind);
    const snapshotPending = snapshot.start();
    const initialRenders = snapshot.calls.filter((call) => call === "renderDocker").length;
    snapshot.setSession({ key: "omarchy", generation: kind === "status" ? 62 : 63 });
    snapshot.setSession({ key: "alpine", generation: kind === "status" ? 64 : 65 });
    snapshot.resolve(kind === "status" ? { available: true } : { ok: true });
    assert.equal(await snapshotPending, kind === "status" ? false : undefined);
    await Promise.resolve();
    assert.equal(
      snapshot.calls.filter((call) => call === "renderDocker").length,
      initialRenders,
      `${kind} completion repainted replacement owner`,
    );
  }

  const containers = containersFixture();
  const containersPending = containers.start();
  containers.setSession({ key: "omarchy", generation: 72 });
  containers.setSession({ key: "alpine", generation: 73 });
  containers.resolve({ exit: 0, stdout: "" });
  assert.equal(await containersPending, null);
  await Promise.resolve();
  assert.equal(containers.calls.includes("repaintContainerList"), false);
  assert.equal(containers.context.containerRefreshPromise, null);
});

test("retired container action completion cannot apply to the next session", async () => {
  const action = actionFixture();
  const pending = action.start();
  await action.waitForCommand();
  assert.equal(action.calls.includes("runGuestContainerCommand"), true,
    "action fixture must enter the deferred guest command before retirement");
  const initialRepaints = action.calls.filter((call) => call === "repaintContainerList").length;
  action.retireAndReplace();
  action.resolve({ exit: 0, stdout: "" });
  await pending;
  assert.equal(action.calls.filter((call) => call === "repaintContainerList").length, initialRepaints);
  assert.equal(action.context.containerLedger.error, "");
});
