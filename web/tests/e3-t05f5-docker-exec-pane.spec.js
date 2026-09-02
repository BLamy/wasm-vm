// E3.5-T05f5: the Docker Exec pane must use the real interactive wvrun stream.
import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const haveLocalAlpine = fs.existsSync(path.join(WEB, "artifacts-alpine.json")) &&
  fs.existsSync(path.join(WEB, "../releases/chunked-alpine/manifest.json"));
const shq = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

test("E3.5-T05f5: interactive exec stays inside the selected container", async ({ page }) => {
  test.skip(!haveLocalAlpine, "needs local artifacts-alpine.json and releases/chunked-alpine");
  test.setTimeout(3_600_000);
  const errors = [];
  const containerName = `t05f5-exec-${Date.now().toString(36).slice(-7)}`;
  const guestSecret = "/root/t05f5-guest-secret";
  let containerId = "";
  page.on("console", (message) => {
    if (message.type() === "error" && !message.location().url.includes("/favicon.ico")) {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

  const waitFor = (predicate, timeout = 900_000) =>
    page.waitForFunction(predicate, undefined, { timeout });
  const state = () => page.evaluate(() => window.__dockerStateForTest());
  const execState = () => page.evaluate(() => window.__dockerExecStateForTest());
  const row = () => page.locator(`#ide-dk-clist .ide-dk-ctr[data-name="${containerName}"]`);

  try {
    const query = new URLSearchParams({
      noAutoBoot: "1",
      testHooks: "1",
      nosw: "1",
      guest: "alpine",
      worker: "0",
      jit: "0",
    });
    if (process.env.E3_T05F5_ASSET_BASE) query.set("assetBase", process.env.E3_T05F5_ASSET_BASE);
    await page.goto(`/?${query}#ide`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForFunction(() => window.wvmDemo && typeof window.wvmDemo.bootAlpine === "function", null, {
      timeout: 120_000,
    });
    await page.locator("#ide-act-docker").click();
    await waitFor(() => window.__dockerStateForTest?.().alpineStatus === "present", 30_000);
    await page.locator("#ide-dk-boot-alpine").click();
    await waitFor(
      () => window.wvmDemo.isGuestReady?.() === true &&
        window.__dockerStateForTest?.().runtime === "available" &&
        window.__dockerStateForTest?.().catalogStatus === "available",
    );

    const catalog = await page.evaluate(() => window.__dockerCatalogForTest());
    const busybox = catalog.entries.find((entry) =>
      entry.repo === "busybox" || entry.repo.endsWith("/busybox") || entry.name === "busybox",
    );
    expect(busybox, "the guest catalog must contain busybox").toBeTruthy();
    const command = `wvrun run -d --name ${shq(containerName)} ${shq(busybox.bundlePath)} /bin/sh -c ${shq(
      "hostname t05f5-ctr; while :; do sleep 1; done",
    )}`;
    const started = await page.evaluate((cmd) => window.wvmDemo.run(cmd), command);
    expect(started.exit).toBe(0);
    containerId = String(started.stdout).trim().split(/\s+/).pop();
    expect(containerId).toMatch(/^[0-9a-f]{12}$/i);
    expect((await page.evaluate((file) => window.wvmDemo.run(`echo TOPSECRET_$((6*7)) > ${file}`), guestSecret)).exit)
      .toBe(0);
    await page.locator('button[data-action="refresh-containers"]').click();
    await waitFor(() => {
      const item = [...document.querySelectorAll("#ide-dk-clist .ide-dk-ctr")]
        .find((candidate) => candidate.dataset.name === containerName);
      return item && /^(running|created)$/.test(item.dataset.status || "");
    }, 120_000);

    await row().click();
    const panel = page.locator(".ide-ctr-panel.active");
    await panel.waitFor({ state: "visible", timeout: 30_000 });
    const send = async (cmd, marker) => {
      const input = panel.locator('[data-a="exec-input"]');
      if (!(await execState())[0]?.active) {
        await panel.locator('[data-a="exec-start"]').click();
        await waitFor(() => window.__dockerExecStateForTest?.()[0]?.active === true, 30_000);
      }
      await input.fill(cmd);
      await input.press("Enter");
      await waitFor(() => window.__dockerExecStateForTest?.()[0]?.active === true, 30_000);
      await waitFor(
        (expected) => window.__dockerExecStateForTest?.()[0]?.output.includes(expected),
        marker,
        120_000,
      );
    };
    await send("echo INEXEC_$((6*7))", "INEXEC_42");
    await send("hostname", "t05f5-ctr");
    await send("cat /proc/1/comm", "sh");
    await send(`cat ${guestSecret} 2>/dev/null || echo NOLEAK_$((6*7))`, "NOLEAK_42");
    let observed = (await execState())[0];
    expect(observed.output).toMatch(/t05f5-ctr/);
    expect(observed.output).toMatch(/(?:^|\n)(?:sh|busybox)(?:\n|$)/);
    expect(observed.output).toContain("INEXEC_42");
    expect(observed.output).toContain("NOLEAK_42");
    expect(observed.output).not.toContain("TOPSECRET_42");

    await panel.locator('button[data-a="exec-exit"]').click();
    await waitFor(() => window.__dockerExecStateForTest?.().length === 0, 30_000);
    const afterExit = await page.evaluate(async (id) => ({
      rpc: await window.wvmDemo.run("echo AFTER_EXEC_EXIT_$((6*7))"),
      ps: await window.wvmDemo.run("wvrun ps -a"),
      id,
    }), containerId);
    expect(afterExit.rpc.exit).toBe(0);
    expect(afterExit.rpc.stdout).toContain("AFTER_EXEC_EXIT_42");
    expect(afterExit.ps.stdout).toContain(`"id":"${containerId}"`);
    expect(afterExit.ps.stdout).toContain('"status":"running"');

    await row().click();
    await page.locator(".ide-ctr-panel.active").locator('[data-a="exec-start"]').click();
    await waitFor(() => window.__dockerExecStateForTest?.()[0]?.active === true, 30_000);
    await row().locator('button[data-action="stop-container"]').click();
    await expect(row()).toHaveAttribute("data-status", /^(exited|stopped|dead)$/, { timeout: 120_000 });
    await row().click();
    await page.locator(".ide-ctr-panel.active").locator('[data-a="exec-start"]').click();
    await waitFor(
      () => window.__dockerExecStateForTest?.()[0]?.code === "EXEC_TARGET_NOT_RUNNING",
      30_000,
    );
    observed = (await execState())[0];
    expect(observed.active).toBe(false);
    expect(observed.code).toBe("EXEC_TARGET_NOT_RUNNING");
    expect(observed.error).toMatch(/not running|exited|stopped/i);
    const afterError = await page.evaluate(() => window.wvmDemo.run("echo AFTER_EXEC_ERROR_$((6*7))"));
    expect(afterError.exit).toBe(0);
    expect(afterError.stdout).toContain("AFTER_EXEC_ERROR_42");
    expect(errors, `unexpected console errors: ${errors.join("; ")}`).toEqual([]);
    void state;
  } finally {
    if (containerId) {
      await page.evaluate(async ({ id, file }) => {
        await window.wvmDemo.run(`wvrun rm ${id}`).catch(() => {});
        await window.wvmDemo.run(`rm -f ${file}`).catch(() => {});
      }, { id: containerId, file: guestSecret }).catch(() => {});
    }
  }
});
