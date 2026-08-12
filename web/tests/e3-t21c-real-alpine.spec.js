import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const haveAlpine =
  fs.existsSync(path.join(WEB, "artifacts-alpine.json")) &&
  fs.existsSync(path.join(WEB, "../releases/chunked-alpine/manifest.json"));
const rows = "#term .xterm-rows";

test("real Wasm incremental SHA-256 accepts a browser File stream", async ({ page }) => {
  await page.goto("/?testHooks=1&noAutoBoot=1");
  const digest = await page.evaluate(async () => {
    const file = new File(["real browser to guest"], "real-upload.txt");
    const hasher = new window.__wasmVmFileSha256();
    const reader = file.stream().getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hasher.update(value);
    }
    return hasher.finish();
  });
  expect(digest).toBe(createHash("sha256").update("real browser to guest").digest("hex"));
});

test("real Alpine agent defers guest COMPLETE until browser close", async ({ page }) => {
  test.skip(!haveAlpine, "needs the local E3-T21b2c Alpine chunk image");
  test.setTimeout(1_800_000);

  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) errors.push(message.text());
  });
  await page.goto("/?testHooks=1&noAutoBoot=1");
  await expect(page.locator("#boot-alpine")).toBeEnabled();
  await page.click("#boot-alpine");
  let sawOpenRC = false;
  let loggedIn = false;
  for (let i = 0; i < 900; i += 1) {
    const text = await page.locator(rows).textContent().catch(() => "");
    if (/Kernel panic|Unable to mount root/.test(text)) {
      throw new Error(`Alpine boot failed: ${text.slice(-2_000)}`);
    }
    if (text.includes("OpenRC")) sawOpenRC = true;
    if (sawOpenRC && text.includes("login:")) {
      loggedIn = true;
      break;
    }
    await page.waitForTimeout(1_000);
  }
  expect(loggedIn, "reached the post-OpenRC login prompt").toBe(true);

  const type = (text) =>
    page.evaluate((value) => window.__term.typeBytes(new TextEncoder().encode(value)), text);
  await type("root\r");
  await page.waitForTimeout(3_000);
  await type("\r");
  await page.waitForTimeout(2_000);
  await type("echo WVFT_SHELL_READY\r");
  await expect(page.locator(rows)).toContainText("WVFT_SHELL_READY", { timeout: 60_000 });
  await type("rc-service wasm-vm-file-agent status; echo WVFT_AGENT_STATUS=$?\r");
  await expect(page.locator(rows)).toContainText("WVFT_AGENT_STATUS=0", { timeout: 120_000 });
  await page.waitForFunction(
    async () => (await window.__fileTransferReady()).some(Boolean),
    null,
    { timeout: 300_000 },
  );

  const uploadBytes = "real browser to guest";
  const uploadSha = createHash("sha256").update(uploadBytes).digest("hex");
  await page.setInputFiles("#file-transfer-input", {
    name: "real-upload.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(uploadBytes),
  });
  await page.waitForFunction(
    () => window.__wasmVmFileTransferUI.snapshot().some(
      (item) =>
        item.name === "real-upload.txt" &&
        (item.state === "complete" || item.state === "error" || item.state === "partial"),
    ),
    null,
    { timeout: 300_000 },
  );
  const upload = await page.evaluate(() =>
    window.__wasmVmFileTransferUI.snapshot().find((item) => item.name === "real-upload.txt"));
  expect(upload, JSON.stringify(upload)).toMatchObject({ state: "complete" });
  await type("sha256sum /var/lib/wasm-vm/transfer/inbox/real-upload.txt\r");
  await expect(page.locator(rows)).toContainText(uploadSha, { timeout: 60_000 });

  await page.evaluate(() => {
    window.__downloadedBytes = [];
    window.__closeStarted = false;
    window.__releaseDurableClose = null;
    window.__wasmVmFileTransferUI.setDownloadDirectory({
      name: "real-test-downloads",
      getFileHandle: async () => ({
        createWritable: async () => ({
          write: async (bytes) => window.__downloadedBytes.push(...bytes),
          close: async () => {
            window.__closeStarted = true;
            await new Promise((resolve) => { window.__releaseDurableClose = resolve; });
          },
          abort: async () => {},
        }),
      }),
    });
  });
  const downloadBytes = "real guest to browser";
  const downloadSha = createHash("sha256").update(downloadBytes).digest("hex");
  await type("stty -echo\r");
  await page.waitForTimeout(1_000);
  await type(
    `printf '${downloadBytes}' > /var/lib/wasm-vm/transfer/outbox/real-download.txt; ` +
    "vm-download real-download.txt; result=$?; stty echo; echo WVFT_DOWNLOAD_RC=$result\r",
  );
  await page.waitForFunction(() => window.__closeStarted === true, null, { timeout: 180_000 });
  expect(await page.locator(rows).textContent()).not.toContain("WVFT_DOWNLOAD_RC=");
  await page.evaluate(() => window.__releaseDurableClose());
  await expect(page.locator(rows)).toContainText("WVFT_DOWNLOAD_RC=0", { timeout: 60_000 });
  await page.waitForFunction(
    () => window.__wasmVmFileTransferUI.snapshot()
      .some((item) => item.name === "real-download.txt" && item.state === "complete"),
    null,
    { timeout: 60_000 },
  );

  const observed = await page.evaluate(() => Array.from(window.__downloadedBytes));
  expect(createHash("sha256").update(Buffer.from(observed)).digest("hex")).toBe(downloadSha);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: path.join(
      WEB,
      "../tasks/epic-3-civilization/e3-t21c-real-alpine-file-transfer.png",
    ),
    fullPage: true,
  });
});
