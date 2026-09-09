import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const shell = "?guest=busybox&nosw&testHooks=1&startPaused=1&jit=0";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function captureErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function bootRestored(page, query, backend) {
  await page.goto(`/${shell}${query}`);
  await page.waitForFunction(
    () => window.wvmDemo?.isGuestReady?.() === true && window.__linuxCtl,
    null,
    { timeout: 180_000 },
  );
  const boot = await page.evaluate(async () => ({
    backend: document.documentElement.dataset.linuxBackend,
    isolated: globalThis.crossOriginIsolated === true,
    restored: Boolean(window.__linuxCtl.restoredFromBootSnapshot?.()),
    paused: await window.__linuxCtl.isPaused(),
    digest: await window.__linuxCtl.stateDigest(),
    scheduler: await window.__linuxCtl.schedulerStats(),
    policy: document.documentElement.dataset.jitPolicy,
    jit: await window.__linuxCtl.jitStats(),
  }));
  expect(boot.backend).toBe(backend);
  expect(boot.restored).toBe(true);
  expect(boot.paused).toBe(true);
  expect(boot.scheduler.slices).toBe(0);
  expect(boot.scheduler.retiredInstructions).toBe(0);
  expect(boot.scheduler.requestedInstructions).toBe(0);
  expect(boot.policy).toBe("forced-off");
  expect(boot.jit?.hasExecutor).toBe(false);
  return boot;
}

async function runOracle(page) {
  return page.evaluate(async () => {
    await window.__linuxCtl.resume();
    const command = await window.wvmDemo.run("printf 'E4T22E_ORACLE_%s\\n' \"$((6 * 7))\"", 30_000);
    await window.__linuxCtl.pause();
    return {
      command,
      paused: await window.__linuxCtl.isPaused(),
      digest: await window.__linuxCtl.stateDigest(),
      scheduler: await window.__linuxCtl.schedulerStats(),
    };
  });
}

async function readControllerSemantics(page) {
  return page.evaluate(async () => {
    const controller = window.__linuxCtl;
    return {
      persist: await controller.persist(),
      persistStats: await controller.persistStats(),
      readOnly: await controller.readOnly(),
      fileTransfer: await controller.fileTransferStatus(),
      snapshot: await window.wvmDemo.snapshotStatus(),
      overlaySeed: await controller.overlaySeedIdentity(),
    };
  });
}

test("restored worker and explicit single-thread fallback share the shell oracle", async ({ page }) => {
  test.setTimeout(360_000);
  const errors = captureErrors(page);

  const worker = await bootRestored(page, "", "whole-machine-worker");
  const workerRun = await runOracle(page);
  const workerSemantics = await readControllerSemantics(page);

  const fallback = await bootRestored(page, "&singlethread=1", "main-thread");
  const fallbackRun = await runOracle(page);
  const fallbackSemantics = await readControllerSemantics(page);

  // The paused restore is the deterministic architectural boundary. The shell command is the
  // foreground UI path, so compare its exact result as well as the common controller capabilities.
  expect(fallback.digest).toBe(worker.digest);
  expect(fallbackRun.command).toEqual(workerRun.command);
  expect(fallbackRun.command.exit).toBe(0);
  expect(fallbackRun.command.stdout).toContain("E4T22E_ORACLE_42");
  expect(fallbackRun.paused).toBe(true);
  expect(workerRun.paused).toBe(true);
  expect(fallbackSemantics.persist).toBe(workerSemantics.persist);
  expect(fallbackSemantics.persistStats).toEqual(workerSemantics.persistStats);
  expect(fallbackSemantics.readOnly).toBe(workerSemantics.readOnly);
  expect(fallbackSemantics.fileTransfer).toEqual(workerSemantics.fileTransfer);
  expect(fallbackSemantics.snapshot).toEqual(workerSemantics.snapshot);
  expect(fallbackSemantics.overlaySeed).toBe(workerSemantics.overlaySeed);

  // Snapshot save is an explicit controller operation. Exercise it only after the deterministic
  // cross-backend restore comparison so this test's own save cannot become the next boot's fixture.
  const snapshotSave = await page.evaluate(() => window.wvmDemo.snapshotSave());
  expect(snapshotSave.ok).toBe(true);
  expect(snapshotSave.available).toBe(true);
  await page.screenshot({
    path: path.join(repoRoot, "evidence/e4-t22e/cpu-worker-integration-2026-09-03.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("JIT policy is truthful and a killed worker cannot leave a stale controller", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);

  await page.goto("/?guest=busybox&nosw&testHooks=1&jit=1&jitThreshold=1");
  await page.waitForFunction(
    () => window.wvmDemo?.isGuestReady?.() === true && window.__linuxCtl,
    null,
    { timeout: 180_000 },
  );
  const policy = await page.evaluate(async () => ({
    isolated: globalThis.crossOriginIsolated === true,
    backend: document.documentElement.dataset.linuxBackend,
    policy: document.documentElement.dataset.jitPolicy,
    jit: await window.__linuxCtl.jitStats(),
  }));
  expect(policy.backend).toBe("whole-machine-worker");
  if (policy.isolated) {
    expect(policy.policy).toBe("enabled");
    expect(policy.jit.hasExecutor).toBe(true);
  } else {
    expect(policy.policy).toBe("unavailable-no-isolation");
    expect(policy.jit.hasExecutor).toBe(false);
  }

  const killed = await page.evaluate(() => {
    const controller = window.__linuxCtl;
    window.__e4t22KilledController = controller;
    window.__e4t22KilledSettlements = Promise.allSettled([
      controller.stateDigest(),
      controller.whenDone,
    ]);
    window.__linuxWorkerForTest.terminate();
    return true;
  });
  expect(killed).toBe(true);
  await expect(page.locator("#status")).toContainText("linux worker fatal", { timeout: 30_000 });
  const proof = await page.evaluate(async () => ({
    settled: await window.__e4t22KilledSettlements,
    future: await window.__e4t22KilledController.resume().then(
      () => "resolved",
      (error) => error.message,
    ),
    guestUp: window.wvmDemo.isGuestUp(),
    boot: window.__linuxBootStateForTest(),
  }));
  expect(proof.settled.map((entry) => entry.status)).toEqual(["rejected", "rejected"]);
  expect(proof.future).toContain("heartbeat timed out");
  expect(proof.guestUp).toBe(false);
  expect(proof.boot.active).toBeNull();
  expect(proof.boot.guestReady).toBe(false);
  expect(errors).toEqual([]);
});
