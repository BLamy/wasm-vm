// E3.5-T05f6: direct Chromium proof for the complete Docker-tab lifecycle.
// The browser only observes the UI. Every catalog value, container identity, status, log byte,
// exec byte, and failure comes from the real Alpine RISC-V guest through wvmDemo.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const web = path.join(repo, "web");
const base = (process.env.E3_T05F6_BASE_URL || "http://127.0.0.1:8123").replace(/\/$/, "");
const assetBase = process.env.E3_T05F6_ASSET_BASE || null;
const evidenceDir = path.join(repo, "evidence", "e3-t05f6");
const evidencePath = path.join(evidenceDir, "docker-tab-integration-browser.json");
const screenshotPath = path.join(evidenceDir, "docker-tab-integration-browser.png");
const flowName = process.env.E3_T05F6_CONTAINER_NAME ||
  `t05f6-flow-${Date.now().toString(36).slice(-7)}`;
const externalName = `${flowName}-external`;
const uiRunName = `${flowName}-ui`;
const failedRunName = `${flowName}-failed`;
const shq = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;
const mark = (message) => console.error(`[e3-t05f6] ${message}`);

const haveAlpine = await Promise.all([
  fs.access(path.join(web, "artifacts-alpine.json")),
  fs.access(path.join(repo, "releases", "chunked-alpine", "manifest.json")),
]).then(() => true).catch(() => false);
if (!haveAlpine) throw new Error("local Alpine assets are required for E3.5-T05f6 proof");

async function staticAudit() {
  const read = async (name) => fs.readFile(path.join(repo, name), "utf8");
  const pairs = [
    ["web/ide.js", "web/dist/ide.js"],
    ["web/main.js", "web/dist/main.js"],
    ["web/guest-rpc.js", "web/dist/guest-rpc.js"],
    ["web/docker.js", "web/dist/docker.js"],
    ["web/roadmap.js", "web/dist/roadmap.js"],
  ];
  const parity = [];
  for (const [sourceName, distName] of pairs) {
    const [source, dist] = await Promise.all([read(sourceName), read(distName)]);
    assert.equal(dist, source, `${sourceName} and ${distName} differ`);
    parity.push({ source: sourceName, dist: distName, equal: true });
  }

  const dockerSource = await read("web/docker.js");
  const dockerDist = await read("web/dist/docker.js");
  const antiFakery = [dockerSource, dockerDist].map((source, index) => {
    assert.doesNotMatch(source, /CONTAINED_42/,
      `${index ? "dist" : "source"} docker.js contains a canned success marker`);
    assert.doesNotMatch(source, /uid=\d+\(/,
      `${index ? "dist" : "source"} docker.js contains canned identity output`);
    assert.doesNotMatch(source, /\beval\s*\(/,
      `${index ? "dist" : "source"} docker.js contains a JavaScript shell`);
    for (const required of ["$((6*7))", "onConsole", "sendInput", "runBusybox"]) {
      assert.ok(source.includes(required), `${index ? "dist" : "source"} docker.js lost ${required}`);
    }
    return { file: index ? "web/dist/docker.js" : "web/docker.js", cannedMarker: false,
      cannedIdentity: false, javascriptShell: false };
  });

  const ideSource = await read("web/ide.js");
  const ideDist = await read("web/dist/ide.js");
  for (const source of [ideSource, ideDist]) {
    assert.doesNotMatch(source, /(?:CONTAINED_42|INEXEC_42)/,
      "Docker lifecycle runtime contains a guest result literal");
    assert.doesNotMatch(source, /\b(?:child_process|shelljs)\b|\beval\s*\(|new Function\s*\(/,
      "Docker lifecycle runtime contains a host-side command interpreter");
    for (const required of ["wvrun ps -a", "wvrun logs -f", "wvrun exec -it", "api().stream"]) {
      assert.ok(source.includes(required), `Docker lifecycle runtime lost ${required}`);
    }
  }

  const existingAntiFakery = await read("web/tests/docker-busybox.spec.js");
  assert.match(existingAntiFakery, /no fake command-interpreter \/ canned-output \/ fake-digest path exists/);
  assert.match(existingAntiFakery, /CONTAINED_42/);
  assert.ok(existingAntiFakery.includes("$((6*7))"));
  return { parity, antiFakery, existingDockerSpec: "web/tests/docker-busybox.spec.js" };
}

const staticEvidence = await staticAudit();
const { chromium } = await import(
  pathToFileURL(path.join(web, "node_modules", "playwright", "index.mjs")).href,
);
const chromePath = process.env.E3_T05F6_CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const launchOptions = {
  headless: process.env.E3_T05F6_HEADED !== "1",
  args: ["--disable-dev-shm-usage", "--disable-gpu", "--js-flags=--max-old-space-size=4096"],
};
try {
  await fs.access(chromePath);
  launchOptions.executablePath = chromePath;
} catch {
  // Fall back to Playwright's bundled Chromium when the Chrome app is absent.
}

const browser = await chromium.launch(launchOptions);
const contexts = [];
const result = {
  base,
  assetBase: assetBase || "page default release base",
  browser: { name: browser.browserType().name(), version: browser.version() },
  staticAudit: staticEvidence,
  localAlpineAssets: haveAlpine,
  names: { flowName, externalName, uiRunName, failedRunName },
  stages: {},
};
let alpinePage = null;
let alpineErrors = null;
let alpineFailedRequests = null;
let flowId = "";
let externalId = "";
let uiRunId = "";

const queryFor = (guest) => {
  const query = new URLSearchParams({
    noAutoBoot: "1",
    testHooks: "1",
    nosw: "1",
    guest,
    worker: "0",
    jit: "0",
  });
  if (assetBase) query.set("assetBase", assetBase);
  return query;
};

const installDiagnostics = (page, name) => {
  const consoleErrors = [];
  const failedRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.location().url.includes("/favicon.ico")) {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (!request.url().endsWith("/favicon.ico")) {
      failedRequests.push({ url: request.url(), failure: request.failure()?.errorText || "unknown" });
    }
  });
  page.on("close", () => console.error(`[e3-t05f6:${name}] page closed`));
  page.on("crash", () => console.error(`[e3-t05f6:${name}] page crashed`));
  return { consoleErrors, failedRequests };
};

const waitFor = (page, predicate, arg = undefined, timeout = 900_000) =>
  page.waitForFunction(predicate, arg, { timeout });

async function openDocker(context, guest, name) {
  const page = await context.newPage();
  const diagnostics = installDiagnostics(page, name);
  await page.goto(`${base}/?${queryFor(guest)}#ide`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await page.waitForFunction(() => window.wvmDemo && typeof window.wvmDemo.bootAlpine === "function", null, {
    timeout: 120_000,
  });
  await page.locator("#ide-act-docker").click();
  await page.locator("#ide-dk-runtime").waitFor({ state: "visible", timeout: 30_000 });
  return { page, ...diagnostics };
}

async function bootAlpineRuntime(page) {
  await waitFor(page, () => window.__dockerStateForTest?.().alpineStatus === "present", undefined, 30_000);
  await page.locator("#ide-dk-boot-alpine").click();
  await waitFor(
    page,
    () => window.wvmDemo.isGuestReady?.() === true &&
      window.__dockerStateForTest?.().runtime === "available" &&
      window.__dockerStateForTest?.().catalogStatus === "available",
    undefined,
    900_000,
  );
}

const dockerState = (page) => page.evaluate(() => window.__dockerStateForTest());
const containerState = (page) => page.evaluate(() => window.__dockerContainerStateForTest());
const logState = (page) => page.evaluate(() => window.__dockerLogStateForTest());
const execState = (page) => page.evaluate(() => window.__dockerExecStateForTest());

const psRows = (stdout) => String(stdout || "").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const findRow = (page, name) => page.locator(
  `#ide-dk-clist .ide-dk-ctr[data-name="${name}"]`,
);

async function waitForGuestRow(page, name, active = true, timeout = 120_000) {
  await waitFor(
    page,
    (payload) => {
      const row = window.__dockerContainerStateForTest?.().rows?.find((item) => item.name === payload.name);
      return row && (!payload.active || /^(running|created)$/.test(row.status));
    },
    { name, active },
    timeout,
  );
  const row = (await containerState(page)).rows.find((item) => item.name === name);
  assert.ok(row, `guest ps did not project ${name}`);
  if (active) assert.match(row.status, /^(running|created)$/);
  return row;
}

async function removeGuestContainer(page, id) {
  if (!id) return;
  await page.evaluate((ref) => window.wvmDemo.run(`wvrun rm -f ${ref}`), id).catch(() => {});
}

try {
  const alpineContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  contexts.push(alpineContext);
  const alpine = await openDocker(alpineContext, "alpine", "alpine");
  alpinePage = alpine.page;
  alpineErrors = alpine.consoleErrors;
  alpineFailedRequests = alpine.failedRequests;
  await bootAlpineRuntime(alpinePage);
  mark("Alpine runtime ready");

  let catalog = await alpinePage.evaluate(() => window.__dockerCatalogForTest());
  assert.equal(catalog.status, "available");
  assert.ok(catalog.entries.length > 0, "guest catalog must not be empty");
  const busyboxIndex = catalog.entries.findIndex((entry) =>
    entry.repo === "busybox" || entry.repo.endsWith("/busybox") || entry.name === "busybox",
  );
  assert.ok(busyboxIndex >= 0, "guest catalog must contain busybox");
  const busybox = catalog.entries[busyboxIndex];
  const imageRows = alpinePage.locator("#ide-dk .ide-dk-sec").first().locator(".ide-dk-row");
  assert.equal(await imageRows.count(), catalog.entries.length, "Images must equal guest catalog rows");
  for (let i = 0; i < catalog.entries.length; i += 1) {
    const text = await imageRows.nth(i).innerText();
    assert.match(text, new RegExp(String(catalog.entries[i].name || catalog.entries[i].repo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(text, new RegExp(String(catalog.entries[i].ref || `${catalog.entries[i].repo}:${catalog.entries[i].tag}`).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  await imageRows.nth(busyboxIndex).locator('button[data-action="inspect-image"]').click();
  const inspectText = await alpinePage.locator("#ide-dk-inspect").innerText();
  assert.match(inspectText, /\/opt\/containers\/index\.json \(guest\)/);
  assert.match(inspectText, new RegExp(String(busybox.bundlePath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  if (busybox.manifestDigest) {
    assert.match(inspectText, new RegExp(String(busybox.manifestDigest).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  result.stages.catalog = {
    status: catalog.status,
    count: catalog.entries.length,
    busybox: { repo: busybox.repo, ref: busybox.ref, bundlePath: busybox.bundlePath,
      manifestDigest: busybox.manifestDigest || null },
    inspectGuestSource: inspectText.includes("/opt/containers/index.json (guest)"),
  };
  mark("guest catalog and Inspect verified");

  // Make the guest bundle's config/argv produce a deterministic marker and remain alive. This is
  // guest setup, not browser injection: the subsequent Images → Run button passes only the bundle
  // path, so the lifecycle still exercises the exact UI command builder and guest wvrun path.
  const prepareCommand = `printf '/bin/sh\\n-c\\necho CONTAINED_$((6*7)); i=0; while [ $i -lt 5 ]; do echo BURST_$i; i=$((i+1)); sleep 1; done; while :; do sleep 1; done\\n' > ${shq(
    `${busybox.bundlePath}/config/argv`,
  )}`;
  const prepared = await alpinePage.evaluate((command) => window.wvmDemo.run(command), prepareCommand);
  assert.equal(prepared.exit, 0, `guest config/argv preparation failed: ${prepared.stdout}`);

  // Exercise the actual Images → Run button. The returned identity and the later ps/log/exec
  // observations all belong to this same UI-created container.
  await alpinePage.evaluate((name) => window.__dockerSetRunNameForTest(name), flowName);
  await imageRows.nth(busyboxIndex).locator('button[data-action="run-image"]').click();
  await waitFor(alpinePage, () => window.__dockerStateForTest?.().lastRun?.status === "accepted", undefined, 120_000);
  const uiRun = (await dockerState(alpinePage)).lastRun;
  assert.equal(uiRun.name, flowName);
  assert.match(uiRun.command, /wvrun run -d/);
  flowId = uiRun.id;
  assert.match(flowId, /^[0-9a-f]{12}$/i);
  await alpinePage.locator('button[data-action="refresh-containers"]').click();
  const uiRow = await waitForGuestRow(alpinePage, flowName, true);
  const uiPs = await alpinePage.evaluate(() => window.wvmDemo.run("wvrun ps -a"));
  assert.equal(uiPs.exit, 0);
  const uiPsRow = psRows(uiPs.stdout).find((row) => row.name === flowName);
  assert.ok(uiPsRow, "UI Run identity must be confirmed by guest ps -a");
  assert.equal(uiPsRow.id, flowId);
  const initial = await waitForGuestRow(alpinePage, flowName, true);
  const initialPs = await alpinePage.evaluate(() => window.wvmDemo.run("wvrun ps -a"));
  const initialPsRow = psRows(initialPs.stdout).find((row) => row.name === flowName);
  assert.deepEqual({ id: initialPsRow?.id, status: initialPsRow?.status }, { id: flowId, status: "running" });
  result.stages.lifecycleRun = {
    prepareCommand,
    command: uiRun.command,
    result: uiRun,
    row: initial,
    guestPs: initialPs,
  };
  mark(`UI Run accepted ${flowName} as ${flowId}`);

  const flowRow = findRow(alpinePage, flowName);
  await flowRow.click();
  const panel = alpinePage.locator(".ide-ctr-panel.active");
  await panel.waitFor({ state: "visible", timeout: 30_000 });

  // Logs: follow the guest stream, then re-render the Docker sidebar while it is active. The
  // marker must occur once, proving the stream is not a canned transcript or duplicate listener.
  await panel.locator('input[data-a="follow"]').check();
  await waitFor(alpinePage, (id) => window.__dockerLogStateForTest?.().find((item) => item.id === id)?.streamActive === true, flowId, 30_000);
  await waitFor(alpinePage, (id) => window.__dockerLogStateForTest?.().find((item) => item.id === id)?.logsText.includes("CONTAINED_42"), flowId, 120_000);
  let logs = (await logState(alpinePage)).find((item) => item.id === flowId);
  assert.ok(logs);
  assert.equal((logs.logsText.match(/CONTAINED_42/g) || []).length, 1);
  result.stages.logs = { id: flowId, streamActive: logs.streamActive, follow: logs.follow,
    markerCount: 1, text: logs.logsText };
  mark("live Logs produced CONTAINED_42 once");

  // Re-render the active Docker view without navigating away from the selected container. Leaving
  // the view would intentionally cancel private streams; this assertion targets Docker's own
  // rerender path while the guest log stream is live.
  await alpinePage.locator("#ide-act-docker").click();
  await waitFor(alpinePage, (name) => window.__dockerContainerStateForTest?.().rows?.some((row) =>
    row.name === name && /^(running|created)$/.test(row.status),
  ), flowName, 30_000);
  logs = (await logState(alpinePage)).find((item) => item.id === flowId);
  assert.ok(logs?.streamActive, "Docker re-render must preserve the live log stream");
  assert.equal((logs.logsText.match(/CONTAINED_42/g) || []).length, 1);
  result.stages.logsRerender = { streamActive: logs.streamActive, markerCount: 1 };
  mark("Docker rerender preserved the live log stream");

  // Exec: the same selected container tab receives input through the real wvrun stream.
  await panel.locator('[data-a="exec-start"]').click();
  await waitFor(alpinePage, (id) => window.__dockerExecStateForTest?.().find((item) => item.id === id)?.active === true, flowId, 30_000);
  const execInput = panel.locator('[data-a="exec-input"]');
  await execInput.fill("echo INEXEC_$((6*7))");
  await execInput.press("Enter");
  await waitFor(alpinePage, (id) => window.__dockerExecStateForTest?.().find((item) =>
    item.id === id && item.active && item.output.includes("INEXEC_42"),
  ), flowId, 120_000);
  const exec = (await execState(alpinePage)).find((item) => item.id === flowId);
  assert.ok(exec?.active);
  assert.match(exec.output, /INEXEC_42/);
  assert.match(await panel.locator('[data-a="exec-provenance"]').innerText(), new RegExp(flowName));
  assert.match(await panel.locator('[data-a="exec-provenance"]').innerText(), new RegExp(flowId));
  result.stages.exec = { id: flowId, active: exec.active, command: exec.command, output: exec.output,
    provenance: await panel.locator('[data-a="exec-provenance"]').innerText() };
  mark("interactive Exec produced INEXEC_42");

  // Close the interactive shell through its real Exit control before the lifecycle Stop. This
  // releases the shared guest tty cleanly; the task's adversarial list covers Exec failures and
  // stream cancellation separately, while the acceptance sequence is Run → Logs → Exec → Stop.
  await panel.locator('[data-a="exec-exit"]').click();
  await waitFor(alpinePage, (id) => !window.__dockerExecStateForTest?.().some((item) => item.id === id), flowId, 30_000);
  result.stages.exec.exit = "guest shell exited through Exec Exit";

  // Stop after Exec has released the shared tty. The action issues the guest stop and only then
  // projects the exited state from a fresh ps -a response.
  // Reacquire the row after the Logs/Exec transitions. Docker re-renders its list as each guest
  // stream releases the shared tty, so the stop control must be taken from the current projection,
  // and the proof must observe that the guest-confirmed row is active before clicking it.
  await alpinePage.locator("#ide-act-docker").click();
  const stopRow = findRow(alpinePage, flowName);
  const stopButton = stopRow.locator('button[data-action="stop-container"]');
  await stopRow.waitFor({ state: "visible", timeout: 30_000 });
  await waitFor(alpinePage, (name) => {
    const state = window.__dockerContainerStateForTest?.();
    const row = state?.rows?.find((item) => item.name === name);
    const button = document.querySelector(
      `#ide-dk-clist .ide-dk-ctr[data-name="${name}"] button[data-action="stop-container"]`,
    );
    return row && /^(running|created)$/.test(row.status) && !state.action && button && !button.disabled;
  }, flowName, 30_000);
  mark("Stop control is enabled for the active guest row");
  await stopButton.click();
  mark("UI Stop clicked; waiting for exited ps and inactive Exec");
  try {
    await waitFor(alpinePage, (payload) => {
      const row = window.__dockerContainerStateForTest?.().rows?.find((item) => item.name === payload.name);
      const execItem = window.__dockerExecStateForTest?.().find((item) => item.id === payload.id);
      return row && /^(exited|stopped|dead)$/.test(row.status) &&
        (!execItem || (!execItem.active && !execItem.starting && !execItem.stopping));
    }, { name: flowName, id: flowId }, 120_000);
  } catch (error) {
    const debug = await alpinePage.evaluate(() => ({
      containers: window.__dockerContainerStateForTest?.(),
      exec: window.__dockerExecStateForTest?.(),
      logs: window.__dockerLogStateForTest?.(),
      docker: window.__dockerStateForTest?.(),
    })).catch((captureError) => ({ captureError: captureError.message }));
    console.error(`[e3-t05f6] post-Stop timeout state: ${JSON.stringify(debug)}`);
    throw error;
  }
  const afterStop = await containerState(alpinePage);
  const stoppedRow = afterStop.rows.find((row) => row.name === flowName);
  assert.ok(stoppedRow);
  assert.match(stoppedRow.status, /^(exited|stopped|dead)$/);
  const afterStopRpc = await alpinePage.evaluate(() => window.wvmDemo.run("echo AFTER_UI_STOP_$((6*7))"));
  assert.equal(afterStopRpc.exit, 0);
  assert.match(afterStopRpc.stdout, /AFTER_UI_STOP_42/);
  const afterStopPs = await alpinePage.evaluate(() => window.wvmDemo.run("wvrun ps -a"));
  const afterStopPsRow = psRows(afterStopPs.stdout).find((row) => row.id === flowId);
  assert.equal(afterStopPsRow?.status, "exited");
  const stoppedExec = (await execState(alpinePage)).find((item) => item.id === flowId);
  const stoppedLogs = (await logState(alpinePage)).find((item) => item.id === flowId);
  assert.equal(stoppedExec?.active, false);
  assert.equal(stoppedLogs?.streamActive, false);
  result.stages.stop = { row: stoppedRow, guestPs: afterStopPs, rpc: afterStopRpc,
    execActive: stoppedExec?.active, logStreamActive: stoppedLogs?.streamActive };
  mark("UI Stop confirmed by guest ps and released streams");
  await alpinePage.screenshot({ path: screenshotPath, fullPage: true });

  // Terminal-tab adversarial path: stop a separate real guest container through the parent guest,
  // switch/re-render Docker, and confirm the external state instead of trusting a stale row.
  const externalCommand = `wvrun run -d --name ${shq(externalName)} ${shq(busybox.bundlePath)} /bin/sh -c ${shq(
    "while :; do sleep 1; done",
  )}`;
  const externalStarted = await alpinePage.evaluate((command) => window.wvmDemo.run(command), externalCommand);
  assert.equal(externalStarted.exit, 0);
  externalId = String(externalStarted.stdout).trim().split(/\s+/).pop();
  assert.match(externalId, /^[0-9a-f]{12}$/i);
  await alpinePage.locator('button[data-action="refresh-containers"]').click();
  const externalRunning = await waitForGuestRow(alpinePage, externalName, true);
  await alpinePage.locator("#ide-act-files").click();
  const externalStop = await alpinePage.evaluate((id) => window.wvmDemo.run(`wvrun stop ${id}`), externalId);
  assert.equal(externalStop.exit, 0);
  await alpinePage.locator("#ide-act-docker").click();
  await alpinePage.locator('button[data-action="refresh-containers"]').click();
  await waitFor(alpinePage, (name) => {
    const row = window.__dockerContainerStateForTest?.().rows?.find((item) => item.name === name);
    return row && /^(exited|stopped|dead)$/.test(row.status);
  }, externalName, 120_000);
  const externalStopped = (await containerState(alpinePage)).rows.find((row) => row.name === externalName);
  assert.equal(externalStopped.id, externalId);
  assert.match(externalStopped.status, /^(exited|stopped|dead)$/);
  result.stages.externalTerminalStop = { command: `wvrun stop ${externalId}`, result: externalStop,
    before: externalRunning, after: externalStopped };

  // Force the Run rejection with a tampered catalog path. No optimistic row may appear.
  await alpinePage.evaluate((name) => window.__dockerSetRunNameForTest(name), failedRunName);
  const tampered = await alpinePage.evaluate((repo) => {
    const catalogEntry = window.__dockerCatalogForTest().entries.find((entry) => entry.repo === repo);
    const ok = window.__dockerSetImageForTest(repo, { bundlePath: "/opt/containers/does-not-exist-t05f6" });
    return { ok, original: catalogEntry?.bundlePath };
  }, busybox.repo);
  assert.equal(tampered.ok, true);
  await alpinePage.locator('#ide-dk .ide-dk-row').nth(busyboxIndex).locator('button[data-action="run-image"]').click();
  await waitFor(alpinePage, () => window.__dockerStateForTest?.().lastRun?.status === "failed", undefined, 120_000);
  const failedRun = (await dockerState(alpinePage)).lastRun;
  assert.equal(failedRun.code, "BUNDLE_NOT_RUNNABLE");
  assert.notEqual(failedRun.exit, 0);
  assert.match(failedRun.error, /no rootfs|not found|bundle/i);
  const failedPs = await alpinePage.evaluate(() => window.wvmDemo.run("wvrun ps -a"));
  assert.equal(psRows(failedPs.stdout).some((row) => row.name === failedRunName), false);
  await alpinePage.evaluate(({ repo, bundlePath }) => {
    window.__dockerSetImageForTest(repo, { bundlePath, bundlePresent: true });
    window.__dockerSetRunNameForTest("");
  }, { repo: busybox.repo, bundlePath: tampered.original });
  result.stages.runFailure = { lastRun: failedRun, guestPs: failedPs };

  // Force an absent target through the same Exec pane and verify the parent RPC remains usable.
  await alpinePage.evaluate(() => window.__dockerOpenContainerForTest({
    id: "deadbeefdead", name: "t05f6-absent", image: "busybox", status: "exited",
  }));
  const absentPanel = alpinePage.locator(".ide-ctr-panel.active");
  await absentPanel.locator('[data-a="exec-start"]').click();
  await waitFor(alpinePage, () => window.__dockerExecStateForTest?.().find((item) =>
    item.id === "deadbeefdead" && item.code === "EXEC_CONTAINER_NOT_FOUND",
  ), undefined, 30_000);
  const absent = (await execState(alpinePage)).find((item) => item.id === "deadbeefdead");
  assert.ok(absent);
  assert.equal(absent.active, false);
  assert.equal(absent.code, "EXEC_CONTAINER_NOT_FOUND");
  const afterAbsentRpc = await alpinePage.evaluate(() => window.wvmDemo.run("echo AFTER_ABSENT_$((6*7))"));
  assert.equal(afterAbsentRpc.exit, 0);
  assert.match(afterAbsentRpc.stdout, /AFTER_ABSENT_42/);
  result.stages.execFailure = { state: absent, rpc: afterAbsentRpc };

  result.state = await dockerState(alpinePage);
  result.containers = await containerState(alpinePage);
  result.exec = await execState(alpinePage);
  result.logs = await logState(alpinePage);
  assert.deepEqual(alpineErrors, []);
  assert.deepEqual(alpineFailedRequests, []);

  // Public busybox intentionally has a ready guest shell but no wvrun/catalog capability. The UI
  // must keep lifecycle controls locked and describe Pull/provider behavior without pretending to
  // have fetched anything.
  const publicContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  contexts.push(publicContext);
  const publicBuild = await openDocker(publicContext, "busybox", "public-busybox");
  await publicBuild.page.evaluate(() => { void window.wvmDemo.runBusybox(); });
  await waitFor(
    publicBuild.page,
    () => window.wvmDemo.isGuestReady?.() === true && window.__dockerStateForTest?.().runtime === "unavailable",
    undefined,
    360_000,
  );
  const degraded = await dockerState(publicBuild.page);
  assert.equal(degraded.guestUp, true);
  assert.equal(degraded.runtime, "unavailable");
  assert.match(await publicBuild.page.locator("#ide-dk-runtime-status").innerText(), /Runtime absent/i);
  const degradedRun = publicBuild.page.locator('#ide-dk button[data-action="run-image"]').first();
  assert.equal(await degradedRun.isDisabled(), true);
  assert.match(await publicBuild.page.locator("#ide-dk-clist").innerText(), /stay locked/i);
  await publicBuild.page.locator("#ide-dk-pull").click();
  assert.match(await publicBuild.page.locator("#ide-dk-runtime").innerText(), /Live pull is unavailable/i);
  assert.match(await publicBuild.page.locator("#ide-dk-runtime").innerText(), /baked guest set/i);
  await publicBuild.page.locator("#ide-sb-net").click();
  await publicBuild.page.locator("#network-provider").selectOption("relay");
  const relay = await dockerState(publicBuild.page);
  assert.equal(relay.provider, "relay");
  await publicBuild.page.locator("#network-provider").selectOption("offline");
  const offline = await dockerState(publicBuild.page);
  assert.equal(offline.provider, "offline");
  assert.deepEqual(publicBuild.consoleErrors, []);
  assert.deepEqual(publicBuild.failedRequests, []);
  result.stages.publicDegraded = {
    state: degraded,
    runtimeText: await publicBuild.page.locator("#ide-dk-runtime").innerText(),
    runDisabled: await degradedRun.isDisabled(),
    provider: { relay: relay.provider, offline: offline.provider },
  };
} finally {
  if (alpinePage && !alpinePage.isClosed()) {
    await removeGuestContainer(alpinePage, flowId);
    await removeGuestContainer(alpinePage, externalId);
    await removeGuestContainer(alpinePage, uiRunId);
  }
  await Promise.all(contexts.map((context) => context.close().catch(() => {})));
  await browser.close().catch(() => {});
}

await fs.mkdir(evidenceDir, { recursive: true });
await fs.writeFile(evidencePath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  ...result,
  screenshot: path.relative(repo, screenshotPath),
}, null, 2)}\n`);
console.log(JSON.stringify({ ...result, screenshot: path.relative(repo, screenshotPath) }, null, 2));
