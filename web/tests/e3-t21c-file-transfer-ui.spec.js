import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";

const MIB = 1024 * 1024;

test("streams 100 MiB upload with bounded heap, matching SHA, empty-file and hostile-input states", async ({ page }) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) errors.push(message.text());
  });
  await page.goto("/?testHooks=1");
  await page.waitForFunction(() => globalThis.__wasmVmFileTransferUI);

  const chunk = Buffer.alloc(MIB, 0x5a);
  const expected = createHash("sha256");
  for (let index = 0; index < 100; index += 1) expected.update(chunk);
  const expectedSha = expected.digest("hex");

  const result = await page.evaluate(async ({ expectedSha, mib }) => {
    const ui = globalThis.__wasmVmFileTransferUI;
    const uploads = new Map();
    const archivedUploads = new Map();
    let nextStream = 0;
    let peakBuffered = 0;
    let active = 0;
    let peakActive = 0;
    const controller = {
      fileTransferReady: () => true,
      setFileDownloadReady: () => {},
      beginFileUpload: (slot, name, total, sha256) => {
        if (
          name.includes("/") || name.includes("\\") || name === "." || name === ".." ||
          /[\u202a-\u202e\u2066-\u2069]/u.test(name)
        ) {
          throw new Error("BadName");
        }
        const id = ++nextStream;
        uploads.set(id, { id, slot, name, total, sha256, sent: 0, buffered: 0, state: "active" });
        active += 1;
        peakActive = Math.max(peakActive, active);
        return id;
      },
      pushFileUpload: (id, bytes, finished) => {
        const upload = uploads.get(id);
        upload.sent += bytes.byteLength;
        upload.buffered = Math.min(8 * mib, upload.buffered + bytes.byteLength);
        peakBuffered = Math.max(peakBuffered, upload.buffered);
        if (finished) {
          upload.state = upload.sent === upload.total ? "complete" : "error";
          upload.buffered = 0;
          active -= 1;
        }
        return upload.buffered;
      },
      cancelFileUpload: (id) => {
        const upload = uploads.get(id);
        if (upload?.state === "active") active -= 1;
        if (upload) upload.state = "partial";
      },
      dismissFileUpload: (id) => {
        archivedUploads.set(id, uploads.get(id));
        return uploads.delete(id);
      },
      fileTransferStatus: () => {
        for (const upload of uploads.values()) upload.buffered = Math.max(0, upload.buffered - mib);
        return { maxBuffered: 8 * mib, uploads: [...uploads.values()], downloads: [] };
      },
      takeFileDownloadChunk: () => new Uint8Array(),
      dismissFileDownload: () => true,
      cancelFileDownload: () => {},
    };
    ui.attachController(controller);

    const generatedFile = (name, chunks, byte = 0x5a) => ({
      name,
      size: chunks * mib,
      stream: () => {
        let index = 0;
        return new ReadableStream({
          pull(stream) {
            if (index++ === chunks) stream.close();
            else stream.enqueue(new Uint8Array(mib).fill(byte));
          },
        });
      },
    });
    const emptyFile = {
      name: "empty.txt",
      size: 0,
      stream: () => new ReadableStream({ start(stream) { stream.close(); } }),
    };

    const baseline = performance.memory?.usedJSHeapSize ?? 0;
    let peakHeap = baseline;
    ui.enqueueFiles([generatedFile("hundred-mib.bin", 100), emptyFile]);
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error("uploads did not finish")), 120_000);
      const poll = setInterval(() => {
        peakHeap = Math.max(peakHeap, performance.memory?.usedJSHeapSize ?? baseline);
        const snapshots = ui.snapshot();
        if (snapshots.length === 2 && snapshots.every((item) => item.state === "complete")) {
          clearInterval(poll);
          clearTimeout(deadline);
          resolve();
        }
      }, 20);
    });
    const heapGrowth = performance.memory ? peakHeap - baseline : null;
    const large = [...archivedUploads.values()].find((item) => item.name === "hundred-mib.bin");
    const empty = [...archivedUploads.values()].find((item) => item.name === "empty.txt");

    ui.enqueueFiles([generatedFile("../escape", 1)]);
    ui.enqueueFiles([generatedFile("report\u202egnp.exe", 1)]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const hostile = ui.snapshot().find((item) => item.name === "../escape");
    const hostileUnicode = ui.snapshot().find((item) => item.name.includes("\u202e"));
    const drop = document.querySelector("#file-transfer-drop");
    const directoryDrop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(directoryDrop, "dataTransfer", {
      value: {
        items: [{ webkitGetAsEntry: () => ({ isDirectory: true }) }],
        files: [],
      },
    });
    drop.dispatchEvent(directoryDrop);
    const directoryMessage = document.querySelector("#file-transfer-status").textContent;
    const thousandAccepted = ui.enqueueFiles(Array.from({ length: 1000 }, (_, i) => generatedFile(`f-${i}`, 0)));
    const repeatedBatchOne = ui.enqueueFiles(Array.from({ length: 20 }, (_, i) => generatedFile(`batch-a-${i}`, 1)));
    const repeatedBatchTwo = ui.enqueueFiles(Array.from({ length: 20 }, (_, i) => generatedFile(`batch-b-${i}`, 1)));
    return {
      expectedSha,
      observedSha: large.sha256,
      bytes: large.sent,
      emptyState: empty.state,
      hostileState: hostile.state,
      hostileLabel: hostile.label,
      hostileUnicodeState: hostileUnicode.state,
      directoryMessage,
      thousandAccepted,
      repeatedBatchOne,
      repeatedBatchTwo,
      peakBuffered,
      peakActive,
      heapGrowth,
      snapshot: ui.snapshot(),
    };
  }, { expectedSha, mib: MIB });

  expect(result.observedSha).toBe(result.expectedSha);
  expect(result.bytes).toBe(100 * MIB);
  expect(result.emptyState).toBe("complete");
  expect(result.hostileState).toBe("error");
  expect(result.hostileLabel).toContain("BadName");
  expect(result.hostileUnicodeState).toBe("error");
  expect(result.directoryMessage).toContain("Directories are rejected");
  expect(result.thousandAccepted).toBe(false);
  expect(result.repeatedBatchOne).toBe(true);
  expect(result.repeatedBatchTwo).toBe(false);
  expect(result.peakBuffered).toBeLessThanOrEqual(8 * MIB);
  expect(result.peakActive).toBeLessThanOrEqual(2);
  if (result.heapGrowth != null) expect(result.heapGrowth).toBeLessThan(32 * MIB);
  expect(errors).toEqual([]);
});

test("streams 100 MiB guest download with bounded heap and exposes partial cancellation", async ({ page }) => {
  await page.goto("/?testHooks=1");
  await page.waitForFunction(() => globalThis.__wasmVmFileTransferUI);
  const expected = createHash("sha256");
  for (let index = 0; index < 100; index += 1) expected.update(Buffer.alloc(MIB, 0x5a));
  const expectedSha = expected.digest("hex");
  const result = await page.evaluate(async ({ expectedSha, mib }) => {
    const ui = globalThis.__wasmVmFileTransferUI;
    const FileSha256 = globalThis.__wasmVmFileSha256;
    const hashes = new Map();
    const written = new Map();
    let cancelled = false;
    let dismissed = false;
    const records = [{
      id: 7,
      name: "hundred-mib-download.bin",
      received: 0,
      total: 100 * mib,
      buffered: 0,
      state: "active",
      remaining: 100,
    }, {
      id: 8,
      name: "partial.bin",
      received: 3,
      total: 9,
      buffered: 3,
      state: "active",
    }];
    const chunks = new Map([[7, []], [8, [new Uint8Array([7, 8, 9])]]]);
    let peakBuffered = 0;
    const durableEvents = [];
    const controller = {
      fileTransferReady: () => true,
      setFileDownloadReady: () => {},
      fileTransferStatus: () => {
        const large = records.find((item) => item.id === 7);
        const queue = chunks.get(7);
        if (large) {
          while (large.remaining > 0 && queue.length < 4) {
            queue.push(new Uint8Array(mib).fill(0x5a));
            large.remaining -= 1;
            large.received += mib;
            large.buffered += mib;
          }
          peakBuffered = Math.max(peakBuffered, large.buffered);
          if (large.remaining === 0) large.state = "awaiting-save";
        }
        return { maxBuffered: 8 * mib, uploads: [], downloads: records };
      },
      takeFileDownloadChunk: (id) => {
        const bytes = chunks.get(id)?.shift() || new Uint8Array();
        const record = records.find((item) => item.id === id);
        if (record) record.buffered = Math.max(0, record.buffered - bytes.byteLength);
        return bytes;
      },
      dismissFileDownload: (id) => {
        if (id === 7) dismissed = true;
        const index = records.findIndex((item) => item.id === id);
        if (index >= 0) records.splice(index, 1);
        return true;
      },
      cancelFileDownload: (id) => {
        if (id === 8) {
          cancelled = true;
          const record = records.find((item) => item.id === id);
          record.state = "partial";
          record.buffered = 0;
        }
      },
      finishFileDownload: (id, success) => {
        const record = records.find((item) => item.id === id);
        durableEvents.push(["finish", id, success]);
        if (record && success) record.state = "complete";
      },
    };
    const baseline = performance.memory?.usedJSHeapSize ?? 0;
    let peakHeap = baseline;
    ui.setDownloadDirectory({
      name: "test-downloads",
      getFileHandle: async (name) => ({
        createWritable: async () => {
          const hasher = new FileSha256();
          hashes.set(name, hasher);
          written.set(name, 0);
          return {
          write: async (bytes) => {
            hasher.update(bytes);
            written.set(name, written.get(name) + bytes.byteLength);
          },
          close: async () => {
            durableEvents.push(["close", name]);
            hashes.set(name, hasher.finish());
          },
          abort: async () => {},
        };
        },
      }),
    });
    ui.attachController(controller);
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error("download did not finish")), 120_000);
      const poll = setInterval(() => {
        peakHeap = Math.max(peakHeap, performance.memory?.usedJSHeapSize ?? baseline);
        if (ui.snapshot().find((item) => item.name === "hundred-mib-download.bin")?.state === "complete") {
          clearInterval(poll);
          clearTimeout(deadline);
          resolve();
        }
      }, 20);
    });
    const cancel = [...document.querySelectorAll(".transfer-cancel")]
      .find((button) => button.getAttribute("aria-label") === "Cancel partial.bin");
    cancel.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    return {
      expectedSha,
      observedSha: hashes.get("hundred-mib-download.bin"),
      bytes: written.get("hundred-mib-download.bin"),
      cancelled,
      dismissed,
      peakBuffered,
      durableEvents,
      heapGrowth: performance.memory ? peakHeap - baseline : null,
      snapshot: ui.snapshot(),
    };
  }, { expectedSha, mib: MIB });

  expect(result.observedSha).toBe(result.expectedSha);
  expect(result.bytes).toBe(100 * MIB);
  expect(result.peakBuffered).toBeLessThanOrEqual(8 * MIB);
  expect(result.durableEvents.findIndex(([event]) => event === "close"))
    .toBeLessThan(result.durableEvents.findIndex(([event]) => event === "finish"));
  if (result.heapGrowth != null) expect(result.heapGrowth).toBeLessThan(32 * MIB);
  expect(result.cancelled).toBe(true);
  expect(result.dismissed).toBe(true);
  expect(result.snapshot.find((item) => item.name === "partial.bin").state).toBe("partial");
  await expect(page.locator('[data-transfer-id="download-8"]')).toContainText("partial");
});

test("writer close failure is reported before WVFT completion", async ({ page }) => {
  await page.goto("/?testHooks=1");
  await page.waitForFunction(() => globalThis.__wasmVmFileTransferUI);
  const result = await page.evaluate(async () => {
    const ui = globalThis.__wasmVmFileTransferUI;
    const finishes = [];
    let opens = 0;
    let dismisses = 0;
    const record = {
      id: 11,
      name: "close-fails.bin",
      received: 0,
      total: 0,
      buffered: 0,
      state: "awaiting-save",
    };
    const controller = {
      setFileDownloadReady: () => {},
      fileTransferStatus: () => ({
        maxBuffered: 8 * 1024 * 1024,
        uploads: [],
        downloads: [record],
      }),
      takeFileDownloadChunk: () => new Uint8Array(),
      finishFileDownload: (id, success) => {
        finishes.push([id, success]);
        if (success) record.state = "complete";
        else record.state = "partial";
      },
      cancelFileDownload: () => {},
      dismissFileDownload: () => {
        dismisses += 1;
        return false;
      },
    };
    ui.setDownloadDirectory({
      name: "failure-test",
      getFileHandle: async () => ({
        createWritable: async () => {
          opens += 1;
          return {
            write: async () => {},
            close: async () => { throw new Error("disk full during close"); },
            abort: async () => {},
          };
        },
      }),
    });
    ui.attachController(controller);
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error("close failure was not surfaced")), 5_000);
      const poll = setInterval(() => {
        const transfer = ui.snapshot().find((item) => item.name === "close-fails.bin");
        if (transfer?.state === "error") {
          clearInterval(poll);
          clearTimeout(deadline);
          resolve();
        }
      }, 20);
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    return {
      finishes,
      opens,
      dismisses,
      transfer: ui.snapshot().find((item) => item.name === "close-fails.bin"),
    };
  });

  expect(result.finishes).toEqual([[11, false]]);
  expect(result.opens).toBe(1);
  expect(result.dismisses).toBe(1);
  expect(result.transfer.state).toBe("error");
  expect(result.transfer.label).toContain("disk full during close");
});
