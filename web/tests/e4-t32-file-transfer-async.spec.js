import { expect, test } from "@playwright/test";

test("folder-picker click awaits worker readiness and surfaces picker failures", async ({ page }) => {
  await page.goto("/?testHooks=1&noAutoBoot=1");
  const result = await page.evaluate(async () => {
    const { createFileTransferUI } = await import("./file-transfer.js");
    const root = document.querySelector("#file-transfer").cloneNode(true);
    root.id = "e4t32-picker-fixture";
    document.body.append(root);
    let mode = "success";
    let releaseReady;
    const readyGate = new Promise((resolve) => { releaseReady = resolve; });
    const calls = [];
    const ui = createFileTransferUI({
      root,
      FileSha256: class {},
      openDirectory: async () => {
        calls.push(["picker", mode]);
        if (mode === "error") throw new Error("injected picker failure");
        return { name: "picked-worker-folder" };
      },
    });
    ui.attachController({
      setFileDownloadReady: async (ready) => {
        calls.push(["ready-start", ready]);
        if (ready) await readyGate;
        calls.push(["ready-end", ready]);
      },
      fileTransferStatus: async () => ({ uploads: [], downloads: [], maxBuffered: 8 }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    calls.length = 0;
    root.querySelector("#file-transfer-download-folder").click();
    while (!calls.some(([kind, ready]) => kind === "ready-start" && ready)) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const beforeRelease = root.querySelector("#file-transfer-status").textContent;
    releaseReady();
    while (!root.querySelector("#file-transfer-status").textContent.includes("picked-worker-folder")) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const successStatus = root.querySelector("#file-transfer-status").textContent;

    mode = "error";
    root.querySelector("#file-transfer-download-folder").click();
    while (!root.querySelector("#file-transfer-status").textContent.includes("injected picker failure")) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const errorStatus = root.querySelector("#file-transfer-status").textContent;
    ui.stop();
    root.remove();
    return { calls, beforeRelease, successStatus, errorStatus };
  });

  expect(result.beforeRelease).not.toContain("picked-worker-folder");
  expect(result.successStatus).toContain("picked-worker-folder");
  expect(result.errorStatus).toContain("Cannot open download folder: injected picker failure");
  expect(result.calls).toEqual([
    ["picker", "success"],
    ["ready-start", true],
    ["ready-end", true],
    ["picker", "error"],
  ]);
});

test("delayed async controller is awaited and stale generations cannot create downloads", async ({ page }) => {
  await page.goto("/?testHooks=1&noAutoBoot=1");
  await page.waitForFunction(() => globalThis.__wasmVmFileTransferUI);

  const result = await page.evaluate(async () => {
    const ui = globalThis.__wasmVmFileTransferUI;
    let releaseStale;
    const staleStatus = new Promise((resolve) => { releaseStale = resolve; });
    const calls = [];
    const base = {
      setFileDownloadReady: async (ready) => calls.push(["ready", ready]),
      fileTransferReady: async () => false,
      takeFileDownloadChunk: async () => new Uint8Array(),
      cancelFileDownload: async () => true,
      finishFileDownload: async () => true,
      dismissFileDownload: async () => true,
    };
    const stale = {
      ...base,
      fileTransferStatus: async () => staleStatus,
    };
    let currentPolls = 0;
    const current = {
      ...base,
      fileTransferStatus: async () => {
        currentPolls += 1;
        return { uploads: [], downloads: [], maxBuffered: 8 };
      },
    };

    ui.setDownloadDirectory({
      name: "armed-generation-test",
      async getFileHandle() {
        return { async createWritable() { return { async write() {}, async close() {}, async abort() {} }; } };
      },
    });
    ui.attachController(stale);
    await new Promise((resolve) => setTimeout(resolve, 30));
    ui.attachController(current);
    releaseStale({
      uploads: [],
      maxBuffered: 8,
      downloads: [{ id: 99, name: "stale.bin", total: 1, buffered: 0, state: "active" }],
    });
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    return {
      snapshot: ui.snapshot(),
      currentPolls,
      calls,
      status: document.querySelector("#file-transfer-status")?.textContent,
    };
  });

  expect(result.snapshot.some((item) => item.name === "stale.bin")).toBe(false);
  expect(result.currentPolls).toBeGreaterThanOrEqual(1);
  expect(result.currentPolls).toBeLessThanOrEqual(4); // idle path is 500ms, not the old ~42/s storm
  expect(result.calls).toContainEqual(["ready", false]);
  expect(result.status).toContain("WVFT controller attached");
});

test("an idle attached controller sends no file-transfer status RPCs", async ({ page }) => {
  await page.goto("/?testHooks=1&noAutoBoot=1");
  await page.waitForFunction(() => globalThis.__wasmVmFileTransferUI);

  const polls = await page.evaluate(async () => {
    let count = 0;
    globalThis.__wasmVmFileTransferUI.attachController({
      setFileDownloadReady: async () => true,
      fileTransferStatus: async () => {
        count += 1;
        return { uploads: [], downloads: [], maxBuffered: 8 };
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    return count;
  });

  expect(polls).toBe(0);
});

test("delayed upload RPCs complete without treating Promises as ids or status records", async ({ page }) => {
  await page.goto("/?testHooks=1&noAutoBoot=1");
  await page.waitForFunction(() => globalThis.__wasmVmFileTransferUI);

  const result = await page.evaluate(async () => {
    const ui = globalThis.__wasmVmFileTransferUI;
    const uploads = new Map();
    const wait = () => new Promise((resolve) => setTimeout(resolve, 8));
    const controller = {
      setFileDownloadReady: async () => {},
      fileTransferReady: async () => { await wait(); return true; },
      beginFileUpload: async (_slot, name, total) => {
        await wait();
        uploads.set(7, { id: 7, name, total, sent: 0, buffered: 0, state: "active" });
        return 7;
      },
      fileTransferStatus: async () => {
        await wait();
        return { maxBuffered: 1024, uploads: [...uploads.values()], downloads: [] };
      },
      pushFileUpload: async (id, bytes, finished) => {
        await wait();
        const record = uploads.get(id);
        record.sent += bytes.byteLength;
        if (finished) record.state = "complete";
        return 0;
      },
      cancelFileUpload: async () => true,
      dismissFileUpload: async () => true,
      takeFileDownloadChunk: async () => new Uint8Array(),
    };
    ui.attachController(controller);
    ui.enqueueFiles([{
      name: "async.bin",
      size: 3,
      stream: () => new ReadableStream({
        start(stream) { stream.enqueue(Uint8Array.of(4, 5, 6)); stream.close(); },
      }),
    }]);
    const deadline = performance.now() + 5_000;
    while (performance.now() < deadline) {
      const item = ui.snapshot().find((entry) => entry.name === "async.bin");
      if (item?.state === "complete" || item?.state === "error") {
        return { item, sent: uploads.get(7)?.sent ?? -1 };
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("async upload did not settle");
  });

  expect(result.item.state).toBe("complete");
  expect(result.item.stream).toBe(7);
  expect(result.sent).toBe(3);
});

test("controller replacement aborts a pending writer before a reused download id can write", async ({ page }) => {
  await page.goto("/?testHooks=1&noAutoBoot=1");
  await page.waitForFunction(() => globalThis.__wasmVmFileTransferUI);

  const result = await page.evaluate(async () => {
    const ui = globalThis.__wasmVmFileTransferUI;
    const writers = [];
    ui.setDownloadDirectory({
      name: "generation-test",
      async getFileHandle(name) {
        return {
          async createWritable() {
            const writer = {
              name,
              aborted: false,
              writes: [],
              async write(bytes) { this.writes.push([...bytes]); },
              async close() {},
              async abort() { this.aborted = true; },
            };
            writers.push(writer);
            return writer;
          },
        };
      },
    });
    let releaseStale;
    const staleChunk = new Promise((resolve) => { releaseStale = resolve; });
    const base = {
      setFileDownloadReady: async () => true,
      cancelFileDownload: async () => true,
      finishFileDownload: async () => true,
      dismissFileDownload: async () => true,
    };
    const stale = {
      ...base,
      fileTransferStatus: async () => ({
        uploads: [], maxBuffered: 8,
        downloads: [{ id: 7, name: "old.bin", total: 1, buffered: 1, state: "active" }],
      }),
      takeFileDownloadChunk: async () => staleChunk,
    };
    const current = {
      ...base,
      fileTransferStatus: async () => ({
        uploads: [], maxBuffered: 8,
        downloads: [{ id: 7, name: "new.bin", total: 1, buffered: 0, state: "active" }],
      }),
      takeFileDownloadChunk: async () => new Uint8Array(),
    };

    ui.attachController(stale);
    while (writers.length < 1) await new Promise((resolve) => setTimeout(resolve, 10));
    ui.attachController(current);
    releaseStale(Uint8Array.of(99));
    const deadline = performance.now() + 2_000;
    while (writers.length < 2 && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return { writers, snapshot: ui.snapshot() };
  });

  expect(result.writers).toHaveLength(2);
  expect(result.writers[0]).toMatchObject({ name: "old.bin", aborted: true, writes: [] });
  expect(result.writers[1]).toMatchObject({ name: "new.bin", aborted: false, writes: [] });
  const oldTransfer = result.snapshot.find((item) => item.name === "old.bin");
  const newTransfer = result.snapshot.find((item) => item.name === "new.bin");
  expect(oldTransfer.state).toBe("partial");
  expect(newTransfer.state).toBe("active");
  expect(oldTransfer.key).not.toBe(newTransfer.key);
});

test("a stale generation cannot create a writable after its file-handle request resolves", async ({ page }) => {
  await page.goto("/?testHooks=1&noAutoBoot=1");
  await page.waitForFunction(() => globalThis.__wasmVmFileTransferUI);

  const result = await page.evaluate(async () => {
    const ui = globalThis.__wasmVmFileTransferUI;
    let releaseOldHandle;
    let markOldHandleStarted;
    const oldHandleGate = new Promise((resolve) => { releaseOldHandle = resolve; });
    const oldHandleStarted = new Promise((resolve) => { markOldHandleStarted = resolve; });
    let handleCalls = 0;
    let staleCreates = 0;
    let currentCreates = 0;
    ui.setDownloadDirectory({
      name: "pending-handle-race",
      async getFileHandle() {
        const call = ++handleCalls;
        if (call === 1) {
          markOldHandleStarted();
          await oldHandleGate;
          return {
            async createWritable() {
              staleCreates += 1;
              return { async write() {}, async close() {}, async abort() {} };
            },
          };
        }
        return {
          async createWritable() {
            currentCreates += 1;
            return { async write() {}, async close() {}, async abort() {} };
          },
        };
      },
    });
    const base = {
      setFileDownloadReady: async () => true,
      takeFileDownloadChunk: async () => new Uint8Array(),
      cancelFileDownload: async () => true,
      finishFileDownload: async () => true,
      dismissFileDownload: async () => true,
      fileTransferStatus: async () => ({
        uploads: [], maxBuffered: 8,
        downloads: [{ id: 7, name: "same.bin", total: 1, buffered: 0, state: "active" }],
      }),
    };
    const stale = { ...base };
    const current = { ...base };
    ui.attachController(stale);
    await oldHandleStarted;
    ui.attachController(current);
    releaseOldHandle();
    const deadline = performance.now() + 2_000;
    while (!currentCreates && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return { handleCalls, staleCreates, currentCreates };
  });

  expect(result.handleCalls).toBeGreaterThanOrEqual(2);
  expect(result.staleCreates).toBe(0);
  expect(result.currentCreates).toBe(1);
});

test("a replacement waits for an old same-destination close before committing", async ({ page }) => {
  await page.goto("/?testHooks=1&noAutoBoot=1");
  await page.waitForFunction(() => globalThis.__wasmVmFileTransferUI);

  const result = await page.evaluate(async () => {
    const ui = globalThis.__wasmVmFileTransferUI;
    let releaseOldClose;
    let markOldCloseStarted;
    const oldCloseGate = new Promise((resolve) => { releaseOldClose = resolve; });
    const oldCloseStarted = new Promise((resolve) => { markOldCloseStarted = resolve; });
    const commits = [];
    let committed = null;
    let creates = 0;
    ui.setDownloadDirectory({
      name: "close-race",
      async getFileHandle() {
        return {
          async createWritable() {
            const owner = creates++ === 0 ? "old" : "new";
            return {
              async write() {},
              async abort() {},
              async close() {
                if (owner === "old") {
                  markOldCloseStarted();
                  await oldCloseGate;
                }
                commits.push(owner);
                committed = owner;
              },
            };
          },
        };
      },
    });
    let staleFinishes = 0;
    let currentFinishes = 0;
    const status = async () => ({
      uploads: [], maxBuffered: 8,
      downloads: [{ id: 7, name: "same.bin", total: 0, buffered: 0, state: "awaiting-save" }],
    });
    const base = {
      setFileDownloadReady: async () => true,
      fileTransferStatus: status,
      takeFileDownloadChunk: async () => new Uint8Array(),
      cancelFileDownload: async () => true,
      dismissFileDownload: async () => true,
    };
    const stale = {
      ...base,
      finishFileDownload: async () => { staleFinishes += 1; return true; },
    };
    const current = {
      ...base,
      finishFileDownload: async () => { currentFinishes += 1; return true; },
    };
    ui.attachController(stale);
    await oldCloseStarted;
    ui.attachController(current);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const createsBeforeRelease = creates;
    releaseOldClose();
    const deadline = performance.now() + 2_000;
    while ((commits.length < 2 || currentFinishes < 1) && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return { createsBeforeRelease, creates, commits, committed, staleFinishes, currentFinishes };
  });

  expect(result.createsBeforeRelease).toBe(1);
  expect(result.creates).toBe(2);
  expect(result.commits).toEqual(["old", "new"]);
  expect(result.committed).toBe("new");
  expect(result.staleFinishes).toBe(0);
  expect(result.currentFinishes).toBe(1);
});

test("legacy synchronous controller throws cannot escape attach or cancellation helpers", async ({ page }) => {
  await page.goto("/?testHooks=1&noAutoBoot=1");
  await page.waitForFunction(() => globalThis.__wasmVmFileTransferUI);

  const result = await page.evaluate(() => {
    const ui = globalThis.__wasmVmFileTransferUI;
    const throwing = {
      setFileDownloadReady() { throw new Error("legacy sync throw"); },
      fileTransferStatus: async () => ({ uploads: [], downloads: [], maxBuffered: 8 }),
    };
    const errors = [];
    try { ui.attachController(throwing); } catch (error) { errors.push(error.message); }
    try { ui.setDownloadDirectory({ name: "sync-throw" }); } catch (error) { errors.push(error.message); }
    try { ui.attachController(null); } catch (error) { errors.push(error.message); }
    return errors;
  });

  expect(result).toEqual([]);
});

test("reused upload stream ids stay bound to their owning controller", async ({ page }) => {
  await page.goto("/?testHooks=1&noAutoBoot=1");
  await page.waitForFunction(() => globalThis.__wasmVmFileTransferUI);

  const result = await page.evaluate(async () => {
    const ui = globalThis.__wasmVmFileTransferUI;
    let releasePush;
    let pushStarted = false;
    let staleCancels = 0;
    let currentCancels = 0;
    const blockedPush = new Promise((resolve) => { releasePush = resolve; });
    const stale = {
      setFileDownloadReady: async () => true,
      fileTransferReady: async () => true,
      beginFileUpload: async () => 7,
      fileTransferStatus: async () => ({
        maxBuffered: 1024,
        uploads: [{ id: 7, buffered: 0, state: "active" }],
        downloads: [],
      }),
      pushFileUpload: async (_id, _bytes, finished) => {
        if (!finished) { pushStarted = true; await blockedPush; }
        return 0;
      },
      cancelFileUpload: async () => { staleCancels += 1; return true; },
      dismissFileUpload: async () => true,
    };
    const current = {
      ...stale,
      setFileDownloadReady: async () => true,
      fileTransferStatus: async () => ({ uploads: [], downloads: [], maxBuffered: 1024 }),
      cancelFileUpload: async () => { currentCancels += 1; return true; },
    };
    ui.attachController(stale);
    ui.enqueueFiles([new File([Uint8Array.of(1, 2, 3)], "owned.bin")]);
    const deadline = performance.now() + 3_000;
    while (!pushStarted && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    ui.attachController(current);
    const oldCancelVisible = Boolean(document.querySelector('[data-transfer-id="upload-1"] .transfer-cancel'));
    releasePush();
    await new Promise((resolve) => setTimeout(resolve, 100));
    return {
      oldCancelVisible,
      staleCancels,
      currentCancels,
      transfer: ui.snapshot().find((item) => item.name === "owned.bin"),
    };
  });

  expect(result.oldCancelVisible).toBe(false);
  expect(result.currentCancels).toBe(0);
  expect(result.staleCancels).toBe(1);
  expect(result.transfer.state).toBe("partial");
  expect(result.transfer.ownerGeneration).toBeGreaterThan(0);
});

test("a fresh controller gets upload workers even when both old pushes never settle", async ({ page }) => {
  await page.goto("/?testHooks=1&noAutoBoot=1");
  await page.waitForFunction(() => globalThis.__wasmVmFileTransferUI);

  const result = await page.evaluate(async () => {
    const ui = globalThis.__wasmVmFileTransferUI;
    let oldBegins = 0;
    let newBegins = 0;
    let oldPushes = 0;
    const never = new Promise(() => {});
    const old = {
      setFileDownloadReady: async () => true,
      fileTransferReady: async () => true,
      beginFileUpload: async (slot) => { oldBegins += 1; return slot + 1; },
      fileTransferStatus: async () => ({
        maxBuffered: 1024,
        uploads: [{ id: 1, buffered: 0, state: "active" }, { id: 2, buffered: 0, state: "active" }],
        downloads: [],
      }),
      pushFileUpload: async () => { oldPushes += 1; await never; },
      cancelFileUpload: async () => true,
      dismissFileUpload: async () => true,
    };
    const current = {
      ...old,
      beginFileUpload: async (slot) => { newBegins += 1; return slot + 10; },
      pushFileUpload: async () => 0,
      fileTransferStatus: async () => ({
        maxBuffered: 1024,
        uploads: [{ id: 10, buffered: 0, state: "active" }, { id: 11, buffered: 0, state: "active" }],
        downloads: [],
      }),
    };
    ui.attachController(old);
    ui.enqueueFiles([
      new File([Uint8Array.of(1)], "old-a.bin"),
      new File([Uint8Array.of(2)], "old-b.bin"),
    ]);
    const deadline = performance.now() + 3_000;
    while ((oldBegins < 2 || oldPushes < 2) && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    ui.attachController(current);
    ui.enqueueFiles([new File([Uint8Array.of(3)], "new.bin")]);
    const newDeadline = performance.now() + 500;
    while (!newBegins && performance.now() < newDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return { oldBegins, oldPushes, newBegins };
  });

  expect(result).toMatchObject({ oldBegins: 2, oldPushes: 2, newBegins: 1 });
});

test("controller replacement during an awaited download write cannot overwrite partial state", async ({ page }) => {
  await page.goto("/?testHooks=1&noAutoBoot=1");
  await page.waitForFunction(() => globalThis.__wasmVmFileTransferUI);

  const result = await page.evaluate(async () => {
    const ui = globalThis.__wasmVmFileTransferUI;
    let releaseWrite;
    let markWriteStarted;
    const writeBlocked = new Promise((resolve) => { releaseWrite = resolve; });
    const writeStarted = new Promise((resolve) => { markWriteStarted = resolve; });
    const writers = [];
    ui.setDownloadDirectory({
      name: "write-race",
      async getFileHandle(name) {
        return {
          async createWritable() {
            const writer = {
              name,
              aborted: false,
              writes: [],
              async write(bytes) {
                this.writes.push([...bytes]);
                if (name === "old-write.bin") {
                  markWriteStarted();
                  await writeBlocked;
                }
              },
              async close() {},
              async abort() { this.aborted = true; },
            };
            writers.push(writer);
            return writer;
          },
        };
      },
    });
    let staleReads = 0;
    let staleFinishes = 0;
    const base = {
      setFileDownloadReady: async () => true,
      cancelFileDownload: async () => true,
      dismissFileDownload: async () => true,
    };
    const stale = {
      ...base,
      fileTransferStatus: async () => ({
        uploads: [], maxBuffered: 8,
        downloads: [{ id: 7, name: "old-write.bin", total: 1, buffered: 1, state: "awaiting-save" }],
      }),
      takeFileDownloadChunk: async () => staleReads++ === 0 ? Uint8Array.of(9) : new Uint8Array(),
      finishFileDownload: async () => { staleFinishes += 1; return true; },
    };
    const current = {
      ...base,
      fileTransferStatus: async () => ({
        uploads: [], maxBuffered: 8,
        downloads: [{ id: 7, name: "new-write.bin", total: 1, buffered: 0, state: "active" }],
      }),
      takeFileDownloadChunk: async () => new Uint8Array(),
      finishFileDownload: async () => true,
    };
    ui.attachController(stale);
    await writeStarted;
    ui.attachController(current);
    releaseWrite();
    const deadline = performance.now() + 2_000;
    while (writers.length < 2 && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { writers, staleFinishes, snapshot: ui.snapshot() };
  });

  expect(result.writers).toHaveLength(2);
  expect(result.writers[0]).toMatchObject({ name: "old-write.bin", aborted: true, writes: [[9]] });
  expect(result.staleFinishes).toBe(0);
  expect(result.snapshot.find((item) => item.name === "old-write.bin")?.state).toBe("partial");
  expect(result.snapshot.find((item) => item.name === "new-write.bin")?.state).toBe("active");
});
