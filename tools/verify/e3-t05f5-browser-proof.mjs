// E3.5-T05f5: direct Chromium proof for the Docker interactive Exec pane.
// The container, shell arithmetic, namespace provenance, and typed failure all execute in the
// real Alpine guest. The browser harness only observes the pane and records the result.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const web = path.join(repo, "web");
const base = process.env.E3_T05F5_BASE_URL || "http://127.0.0.1:8123";
const assetBase = process.env.E3_T05F5_ASSET_BASE || null;
const evidenceDir = path.join(repo, "evidence", "e3-t05f5");
const evidencePath = path.join(evidenceDir, "docker-exec-pane-browser.json");
const screenshotPath = path.join(evidenceDir, "docker-exec-pane-browser.png");
const containerName = process.env.E3_T05F5_CONTAINER_NAME ||
  `t05f5-exec-${Date.now().toString(36).slice(-7)}`;
const guestSecret = "/root/t05f5-guest-secret";
const shq = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

const haveAlpine = await Promise.all([
  fs.access(path.join(web, "artifacts-alpine.json")),
  fs.access(path.join(repo, "releases/chunked-alpine/manifest.json")),
]).then(() => true).catch(() => false);
if (!haveAlpine) throw new Error("local Alpine artifacts are required for E3.5-T05f5 proof");

const { chromium } = await import(
  pathToFileURL(path.join(web, "node_modules/playwright/index.mjs")).href,
);
const chromePath = process.env.E3_T05F5_CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const launchOptions = {
  headless: process.env.E3_T05F5_HEADED !== "1",
  args: ["--disable-dev-shm-usage", "--disable-gpu", "--js-flags=--max-old-space-size=4096"],
};
try {
  await fs.access(chromePath);
  launchOptions.executablePath = chromePath;
} catch {
  // Fall back to the Playwright browser when the local Chrome app is absent.
}

const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
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

const waitFor = (predicate, argOrTimeout = undefined, maybeTimeout = 900_000) => {
  const hasArg = typeof argOrTimeout !== "number";
  const arg = hasArg ? argOrTimeout : undefined;
  const timeout = hasArg ? maybeTimeout : argOrTimeout;
  return page.waitForFunction(predicate, arg, { timeout });
};
const dockerState = () => page.evaluate(() => window.__dockerStateForTest());
const execState = () => page.evaluate(() => window.__dockerExecStateForTest());
const row = () => page.locator(`#ide-dk-clist .ide-dk-ctr[data-name="${containerName}"]`);

const result = {
  base,
  assetBase: assetBase || "page default release base",
  browser: { name: browser.browserType().name(), version: browser.version() },
  containerName,
  guestSecret,
  stages: {},
};
let stage = "initial-load";
let containerId = "";
await fs.mkdir(evidenceDir, { recursive: true });

async function bootDockerRuntime() {
  await page.waitForFunction(() => window.wvmDemo && typeof window.wvmDemo.bootAlpine === "function", null, {
    timeout: 120_000,
  });
  await page.locator("#ide-act-docker").click();
  await page.locator("#ide-dk-runtime").waitFor({ state: "visible", timeout: 30_000 });
  await waitFor(() => window.__dockerStateForTest?.().alpineStatus === "present", 30_000);
  await page.locator("#ide-dk-boot-alpine").click();
  await waitFor(
    () => window.wvmDemo.isGuestReady?.() === true &&
      window.__dockerStateForTest?.().runtime === "available" &&
      window.__dockerStateForTest?.().catalogStatus === "available",
  );
}

async function waitForActiveRow() {
  await waitFor(
    (name) => {
      const item = [...document.querySelectorAll("#ide-dk-clist .ide-dk-ctr")]
        .find((candidate) => candidate.dataset.name === name);
      return item && /^(running|created)$/.test(item.dataset.status || "");
    },
    containerName,
    120_000,
  );
  assert.equal(await row().count(), 1);
  assert.match(await row().getAttribute("data-status"), /^(running|created)$/);
}

async function sendExec(panel, command, marker) {
  const input = panel.locator('[data-a="exec-input"]');
  const current = (await execState())[0];
  if (!current?.active) {
    await panel.locator('[data-a="exec-start"]').click();
    await waitFor(() => window.__dockerExecStateForTest?.()[0]?.active === true, 30_000);
  }
  await input.fill(command);
  await input.press("Enter");
  await waitFor(() => window.__dockerExecStateForTest?.()[0]?.active === true, 30_000);
  await waitFor(
    (expected) => window.__dockerExecStateForTest?.()[0]?.output.includes(expected),
    marker,
    120_000,
  );
  const state = (await execState())[0];
  assert.equal(state.active, true);
  assert.match(state.output, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  return state;
}

const query = new URLSearchParams({
  noAutoBoot: "1",
  testHooks: "1",
  nosw: "1",
  guest: "alpine",
  worker: "0",
  jit: "0",
});
if (assetBase) query.set("assetBase", assetBase);

try {
  await page.goto(`${base}/?${query}#ide`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await bootDockerRuntime();

  stage = "detached-run";
  const catalog = await page.evaluate(() => window.__dockerCatalogForTest());
  const busybox = catalog.entries.find((entry) =>
    entry.repo === "busybox" || entry.repo.endsWith("/busybox") || entry.name === "busybox",
  );
  assert.ok(busybox, "guest catalog must contain busybox");
  const runCommand = `wvrun run -d --name ${shq(containerName)} ${shq(busybox.bundlePath)} /bin/sh -c ${shq(
    "hostname t05f5-ctr; while :; do sleep 1; done",
  )}`;
  const started = await page.evaluate((command) => window.wvmDemo.run(command), runCommand);
  assert.equal(started.exit, 0);
  containerId = String(started.stdout).trim().split(/\s+/).pop();
  assert.match(containerId, /^[0-9a-f]{12}$/i);
  const planted = await page.evaluate((file) => window.wvmDemo.run(
    `echo TOPSECRET_$((6*7)) > ${file}`,
  ), guestSecret);
  assert.equal(planted.exit, 0);
  await page.locator('button[data-action="refresh-containers"]').click();
  await waitForActiveRow();
  result.stages.detachedRun = { command: runCommand, result: started, id: containerId };

  stage = "interactive-provenance";
  await row().click();
  const panel = page.locator(".ide-ctr-panel.active");
  await panel.waitFor({ state: "visible", timeout: 30_000 });
  const marker = await sendExec(panel, "echo INEXEC_$((6*7))", "INEXEC_42");
  result.stages.marker = {
    execActive: marker.active,
    output: marker.output,
  };
  const host = await sendExec(panel, "hostname", "t05f5-ctr");
  const pid = await sendExec(panel, "cat /proc/1/comm", "sh");
  assert.match(pid.output, /(?:^|\n)(?:sh|busybox)(?:\n|$)/);
  const noLeak = await sendExec(
    panel,
    `cat ${guestSecret} 2>/dev/null || echo NOLEAK_$((6*7))`,
    "NOLEAK_42",
  );
  assert.doesNotMatch(noLeak.output, /TOPSECRET_42/);
  result.stages.provenance = {
    hostname: host.output.includes("t05f5-ctr"),
    pid1: pid.output.match(/(?:^|\n)(?:sh|busybox)(?:\n|$)/)?.[0]?.trim() || null,
    secretIsolation: noLeak.output.includes("NOLEAK_42") && !noLeak.output.includes("TOPSECRET_42"),
    command: marker.command,
  };

  stage = "clean-exit";
  await panel.locator('button[data-a="exec-exit"]').click();
  await waitFor(() => window.__dockerExecStateForTest?.().length === 0, 30_000);
  const afterExit = await page.evaluate(async (id) => ({
    rpc: await window.wvmDemo.run("echo AFTER_EXEC_EXIT_$((6*7))"),
    ps: await window.wvmDemo.run("wvrun ps -a"),
    id,
  }), containerId);
  assert.equal(afterExit.rpc.exit, 0);
  assert.match(afterExit.rpc.stdout, /AFTER_EXEC_EXIT_42/);
  assert.match(afterExit.ps.stdout, new RegExp(`"id":"${containerId}"`));
  assert.match(afterExit.ps.stdout, /"status":"running"/);
  result.stages.exit = afterExit;

  stage = "race-exec-with-stop";
  await row().click();
  const racePanel = page.locator(".ide-ctr-panel.active");
  await racePanel.locator('[data-a="exec-start"]').click();
  await waitFor(() => window.__dockerExecStateForTest?.()[0]?.active === true, 30_000);
  await row().locator('button[data-action="stop-container"]').click();
  await page.waitForFunction(
    (name) => {
      const item = [...document.querySelectorAll("#ide-dk-clist .ide-dk-ctr")]
        .find((candidate) => candidate.dataset.name === name);
      const exec = window.__dockerExecStateForTest?.()[0];
      return item && /^(exited|stopped|dead)$/.test(item.dataset.status || "") &&
        exec && !exec.active && !exec.starting && !exec.stopping;
    },
    containerName,
    { timeout: 120_000 },
  );
  const race = (await execState())[0];
  assert.equal(race.active, false);
  result.stages.race = race;

  stage = "typed-exited-error";
  await row().click();
  const exitedPanel = page.locator(".ide-ctr-panel.active");
  await exitedPanel.waitFor({ state: "visible", timeout: 30_000 });
  await exitedPanel.locator('[data-a="exec-start"]').click();
  await waitFor(
    () => window.__dockerExecStateForTest?.()[0]?.code === "EXEC_TARGET_NOT_RUNNING",
    30_000,
  );
  const typed = (await execState())[0];
  assert.equal(typed.active, false);
  assert.equal(typed.code, "EXEC_TARGET_NOT_RUNNING");
  assert.match(typed.error, /not running|exited|stopped/i);
  const afterError = await page.evaluate(() => window.wvmDemo.run("echo AFTER_EXEC_ERROR_$((6*7))"));
  assert.equal(afterError.exit, 0);
  assert.match(afterError.stdout, /AFTER_EXEC_ERROR_42/);
  result.stages.typedError = { state: typed, rpc: afterError };

  stage = "typed-absent-error";
  await page.evaluate(() => window.__dockerOpenContainerForTest({
    id: "deadbeefdead",
    name: "t05f5-absent",
    image: "busybox",
  }));
  const absentPanel = page.locator(".ide-ctr-panel.active");
  await absentPanel.waitFor({ state: "visible", timeout: 30_000 });
  await absentPanel.locator('[data-a="exec-start"]').click();
  await waitFor(
    () => window.__dockerExecStateForTest?.().find((item) => item.id === "deadbeefdead")?.code === "EXEC_CONTAINER_NOT_FOUND",
    30_000,
  );
  const absent = (await execState()).find((item) => item.id === "deadbeefdead");
  assert.ok(absent);
  assert.equal(absent.active, false);
  assert.equal(absent.code, "EXEC_CONTAINER_NOT_FOUND");
  assert.match(absent.error, /no such container|unknown container|does not exist/i);
  const afterAbsent = await page.evaluate(() => window.wvmDemo.run("echo AFTER_EXEC_ABSENT_$((6*7))"));
  assert.equal(afterAbsent.exit, 0);
  assert.match(afterAbsent.stdout, /AFTER_EXEC_ABSENT_42/);
  result.stages.absentError = { state: absent, rpc: afterAbsent };

  result.state = await dockerState();
  result.exec = await execState();
  result.consoleErrors = consoleErrors;
  result.failedRequests = failedRequests;
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(failedRequests, []);
  await page.screenshot({ path: screenshotPath, fullPage: true });
} catch (error) {
  error.message = `[${stage}] ${error.message || error}`;
  throw error;
} finally {
  // Best-effort cleanup is deliberately after the assertions; it is not part of the proof.
  if (containerId && !page.isClosed()) {
    await page.evaluate(async ({ id, file }) => {
      await window.wvmDemo.run(`wvrun rm -f ${id}`).catch(() => {});
      await window.wvmDemo.run(`rm -f ${file}`).catch(() => {});
    }, { id: containerId, file: guestSecret }).catch(() => {});
  }
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
}

await fs.mkdir(evidenceDir, { recursive: true });
await fs.writeFile(evidencePath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  ...result,
  screenshot: path.relative(repo, screenshotPath),
}, null, 2)}\n`);
console.log(JSON.stringify({ ...result, screenshot: path.relative(repo, screenshotPath) }, null, 2));
