import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIB = 1024 * 1024;
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const haveAlpine =
  fs.existsSync(path.join(WEB, "artifacts-alpine.json")) &&
  fs.existsSync(path.join(WEB, "../releases/chunked-alpine/manifest.json"));
const rows = "#term .xterm-rows";

async function bootToRoot(page) {
  await page.goto("/?persist=1&testHooks=1");
  await expect(page.locator("#boot-alpine")).toBeEnabled();
  await page.click("#boot-alpine");
  let sawOpenRC = false;
  for (let attempt = 0; attempt < 900; attempt += 1) {
    const text = await page.locator(rows).textContent().catch(() => "");
    if (/Kernel panic|Unable to mount root/.test(text)) throw new Error(text.slice(-2_000));
    if (text.includes("OpenRC")) sawOpenRC = true;
    if (sawOpenRC && text.includes("login:")) break;
    await page.waitForTimeout(1_000);
  }
  const type = (text) =>
    page.evaluate((value) => window.__term.typeBytes(new TextEncoder().encode(value)), text);
  await type("root\r");
  await page.waitForTimeout(3_000);
  await type("\r");
  await page.waitForTimeout(2_000);
  await type("echo E3T21D_SHELL_$((6*7))\r");
  await expect(page.locator(rows)).toContainText("E3T21D_SHELL_42", { timeout: 60_000 });
  await page.waitForFunction(() => window.__fileTransferReady().some(Boolean), null, {
    timeout: 300_000,
  });
  return type;
}

async function waitForTransfer(page, name, expected, timeout) {
  await page.waitForFunction(
    ({ transferName, expectedState }) => {
      const item = window.__wasmVmFileTransferUI.snapshot()
        .find((transfer) => transfer.name === transferName);
      if (item?.state === "error" || item?.state === "partial") {
        throw new Error(`${transferName} became ${item.state}: ${item.label} at ${item.done}/${item.total}`);
      }
      return item?.state === expectedState;
    },
    { transferName: name, expectedState: expected },
    { timeout },
  );
}

function repeatedDigest(byte, chunks) {
  const hash = createHash("sha256");
  for (let index = 0; index < chunks; index += 1) hash.update(Buffer.alloc(MIB, byte));
  return hash.digest("hex");
}

test("frozen Alpine round trip survives interruption, tab kill, and reboot", async ({ context }) => {
  test.skip(!haveAlpine, "needs the local agent-bearing Alpine chunk image");
  test.setTimeout(3_600_000);

  const suffix = Date.now().toString(36);
  const largeName = `e3t21d-${suffix}-100m.bin`;
  const interruptedName = `e3t21d-${suffix}-interrupted.bin`;
  const pair = [`e3t21d-${suffix}-a.txt`, `e3t21d-${suffix}-b.txt`];
  const largeSha = repeatedDigest(0x5a, 100);
  const errors = [];
  let page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(message.text());
    }
  });
  let type = await bootToRoot(page);

  await page.evaluate(({ name, mib }) => {
    const generated = {
      name,
      size: 100 * mib,
      stream: () => {
        let remaining = 100;
        return new ReadableStream({
          pull(controller) {
            if (remaining-- === 0) controller.close();
            else controller.enqueue(new Uint8Array(mib).fill(0x5a));
          },
        });
      },
    };
    window.__wasmVmFileTransferUI.enqueueFiles([generated]);
  }, { name: largeName, mib: MIB });
  await waitForTransfer(page, largeName, "complete", 900_000);
  await type(`sha256sum /var/lib/wasm-vm/transfer/inbox/${largeName}\r`);
  await expect(page.locator(rows)).toContainText(largeSha, { timeout: 120_000 });

  await page.setInputFiles("#file-transfer-input", pair.map((name, index) => ({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(`concurrent-${index}-${suffix}`),
  })));
  await page.waitForFunction(
    (names) => names.every((name) => window.__wasmVmFileTransferUI.snapshot()
      .some((item) => item.name === name && item.state === "complete")),
    pair,
    { timeout: 300_000 },
  );

  await page.evaluate(({ name, mib }) => {
    const interrupted = {
      name,
      size: 100 * mib,
      stream: () => {
        let remaining = 100;
        return new ReadableStream({
          async pull(controller) {
            if (remaining-- === 0) return controller.close();
            controller.enqueue(new Uint8Array(mib).fill(0xa5));
            await new Promise((resolve) => setTimeout(resolve, 8));
          },
        });
      },
    };
    window.__wasmVmFileTransferUI.enqueueFiles([interrupted]);
  }, { name: interruptedName, mib: MIB });
  await page.waitForFunction(
    ({ name, half }) => window.__wasmVmFileTransferUI.snapshot()
      .some((item) => item.name === name && item.state === "active" && item.done >= half),
    { name: interruptedName, half: 50 * MIB },
    { timeout: 600_000 },
  );
  await page.getByRole("button", { name: `Cancel ${interruptedName}` }).click();
  await page.waitForFunction(
    (name) => window.__wasmVmFileTransferUI.snapshot()
      .some((item) => item.name === name && item.state === "partial"),
    interruptedName,
  );

  await page.evaluate(() => window.__wasmVmFileTransferUI.enqueueFiles([{
    name: "../escape",
    size: 1,
    stream: () => new Blob(["x"]).stream(),
  }]));
  await page.waitForFunction(() => window.__wasmVmFileTransferUI.snapshot()
    .some((item) => item.name === "../escape" && item.state === "error"));

  await type(
    `test ! -e /var/lib/wasm-vm/transfer/inbox/${interruptedName} && ` +
    "test \"$(find /var/lib/wasm-vm/transfer/inbox -name '.wvft-*.part' | wc -l)\" -ge 1 && " +
    "echo E3T21D_PART_$((6*7))_OK\r",
  );
  await expect(page.locator(rows)).toContainText("E3T21D_PART_42_OK", { timeout: 120_000 });

  await page.evaluate(() => {
    window.__e3t21dDownload = { bytes: 0, hash: new window.__wasmVmFileSha256() };
    window.__wasmVmFileTransferUI.setDownloadDirectory({
      name: "e3t21d-downloads",
      getFileHandle: async () => ({
        createWritable: async () => ({
          write: async (bytes) => {
            window.__e3t21dDownload.bytes += bytes.byteLength;
            window.__e3t21dDownload.hash.update(bytes);
          },
          close: async () => {
            window.__e3t21dDownload.digest = window.__e3t21dDownload.hash.finish();
          },
          abort: async () => {},
        }),
      }),
    });
  });
  await type(`vm-download ${largeName}; echo E3T21D_DOWNLOAD_RC=$?\r`);
  await expect(page.locator(rows)).toContainText("E3T21D_DOWNLOAD_RC=0", { timeout: 900_000 });
  expect(await page.evaluate(() => ({
    bytes: window.__e3t21dDownload.bytes,
    digest: window.__e3t21dDownload.digest,
  }))).toEqual({ bytes: 100 * MIB, digest: largeSha });

  await type("sync; echo E3T21D_SYNC_$((6*7))_OK\r");
  await expect(page.locator(rows)).toContainText("E3T21D_SYNC_42_OK", { timeout: 180_000 });
  await page.evaluate(() => window.__persist());
  await page.close({ runBeforeUnload: false });
  expect(context.pages()).toHaveLength(0);

  page = await context.newPage();
  type = await bootToRoot(page);
  await type(
    `sha256sum /var/lib/wasm-vm/transfer/inbox/${largeName}; ` +
    `test -f /var/lib/wasm-vm/transfer/inbox/${pair[0]} && ` +
    `test -f /var/lib/wasm-vm/transfer/inbox/${pair[1]} && ` +
    `test ! -e /var/lib/wasm-vm/transfer/inbox/${interruptedName} && ` +
    "test \"$(find /var/lib/wasm-vm/transfer/inbox -name '.wvft-*.part' | wc -l)\" -ge 1 && " +
    "echo E3T21D_REBOOT_$((6*7))_OK\r",
  );
  await expect(page.locator(rows)).toContainText(largeSha, { timeout: 120_000 });
  await expect(page.locator(rows)).toContainText("E3T21D_REBOOT_42_OK", { timeout: 120_000 });
  expect(errors).toEqual([]);
});
