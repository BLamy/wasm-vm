const MAX_SELECTED_FILES = 32;
const MAX_RETAINED_ROWS = 64;
const UPLOAD_WORKERS = 2;
const POLL_MS = 24;

const delay = (ms = POLL_MS) => new Promise((resolve) => setTimeout(resolve, ms));
const ignoreRejection = (operation) => {
  try {
    const value = typeof operation === "function" ? operation() : operation;
    void Promise.resolve(value).catch(() => {});
  } catch { /* legacy synchronous controller parity */ }
};

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

function safePercent(done, total) {
  return total === 0 ? 100 : Math.min(100, Math.floor((done / total) * 100));
}

function terminalUploadError(record) {
  const terminal = record?.diagnostic?.terminal;
  const code = record?.error || terminal?.error || "Unknown";
  const transition = terminal?.transition ? ` during ${terminal.transition}` : "";
  const error = new Error(`guest upload ${code}${transition}`);
  error.diagnostic = record?.diagnostic ?? null;
  return error;
}

async function hashFile(file, FileSha256, signal) {
  const hasher = new FileSha256();
  const reader = file.stream().getReader();
  try {
    while (true) {
      if (signal.aborted) throw new DOMException("Upload cancelled", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      hasher.update(value);
    }
    return hasher.finish();
  } finally {
    reader.releaseLock();
    hasher.free?.();
  }
}

function transferRow(document, transfer, cancel) {
  const row = document.createElement("li");
  row.className = `transfer-row ${transfer.state}`;
  row.dataset.transferId = transfer.key;

  const head = document.createElement("div");
  head.className = "transfer-row-head";
  const name = document.createElement("strong");
  name.textContent = transfer.name;
  const state = document.createElement("span");
  state.className = "transfer-state";
  state.textContent = transfer.label;
  head.append(name, state);

  const progress = document.createElement("progress");
  progress.max = Math.max(1, transfer.total);
  progress.value = transfer.total === 0 ? 1 : transfer.done;
  progress.setAttribute("aria-label", `${transfer.name}: ${transfer.label}`);

  const detail = document.createElement("div");
  detail.className = "transfer-detail";
  detail.textContent =
    `${transfer.direction} · ${formatBytes(transfer.done)} / ${formatBytes(transfer.total)} · ${safePercent(transfer.done, transfer.total)}%`;

  row.append(head, progress, detail);
  if (transfer.state === "hashing" || transfer.state === "queued" || transfer.state === "active") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "transfer-cancel";
    button.textContent = "Cancel";
    button.setAttribute("aria-label", `Cancel ${transfer.name}`);
    button.addEventListener("click", cancel);
    row.append(button);
  }
  return row;
}

export function createFileTransferUI({
  root,
  FileSha256,
  openDirectory = () => globalThis.showDirectoryPicker(),
}) {
  if (!root) throw new Error("file-transfer root is required");
  const document = root.ownerDocument;
  const drop = root.querySelector("#file-transfer-drop");
  const input = root.querySelector("#file-transfer-input");
  const choose = root.querySelector("#file-transfer-choose");
  const chooseDownload = root.querySelector("#file-transfer-download-folder");
  const status = root.querySelector("#file-transfer-status");
  const list = root.querySelector("#file-transfer-list");
  const transfers = new Map();
  const uploadQueue = [];
  const claimedSlots = new Set();
  const downloadWriters = new Map();
  const downloadDestinationTails = new Map();
  const directoryIds = new WeakMap();
  let controller = null;
  let directory = null;
  let stopped = false;
  let nextLocalId = 0;
  let nextDirectoryId = 0;
  let workersRunningGeneration = null;
  let controllerGeneration = 0;
  let pollWake = null;
  const downloadKey = (generation, id) => `download-${generation}-${id}`;
  const slotKey = (generation, slot) => `${generation}:${slot}`;
  const destinationKey = (targetDirectory, name) => {
    if ((typeof targetDirectory === "object" && targetDirectory) || typeof targetDirectory === "function") {
      if (!directoryIds.has(targetDirectory)) directoryIds.set(targetDirectory, ++nextDirectoryId);
      return `${directoryIds.get(targetDirectory)}:${name}`;
    }
    return `unknown:${name}`;
  };
  const wakePoll = () => {
    const wake = pollWake;
    pollWake = null;
    wake?.();
  };
  const hasActiveTransfers = () => uploadQueue.length > 0 ||
    [...transfers.values()].some((transfer) =>
      transfer.state === "queued" || transfer.state === "hashing" || transfer.state === "active");
  const pollIsArmed = () => Boolean(directory) || hasActiveTransfers();

  // FileSystemWritableFileStream commits its replacement on close. Two generations closing the
  // same destination out of order can therefore let an old download overwrite a newer one even if
  // every RPC/UI mutation is generation-guarded. Reserve a destination before createWritable and
  // hold it through the writer's terminal close/abort operation.
  async function acquireDownloadDestination(targetDirectory, name) {
    const key = destinationKey(targetDirectory, name);
    const previous = downloadDestinationTails.get(key) ?? Promise.resolve();
    let releasePromise;
    const released = new Promise((resolve) => { releasePromise = resolve; });
    const tail = previous.catch(() => {}).then(() => released);
    downloadDestinationTails.set(key, tail);
    await previous.catch(() => {});
    let didRelease = false;
    return () => {
      if (didRelease) return;
      didRelease = true;
      releasePromise();
      void tail.then(() => {
        if (downloadDestinationTails.get(key) === tail) downloadDestinationTails.delete(key);
      });
    };
  }

  async function runDownloadWriterOperation(writer, operation) {
    if (writer.terminalPromise) throw new Error("download writer is already settling");
    const active = Promise.resolve().then(operation);
    writer.operationPromise = active;
    try {
      return await active;
    } finally {
      if (writer.operationPromise === active) writer.operationPromise = null;
    }
  }

  function settleDownloadWriter(writer, method, reason) {
    if (writer.terminalPromise) return writer.terminalPromise;
    const prior = writer.operationPromise ?? Promise.resolve();
    writer.terminalPromise = prior.catch(() => {}).then(() => {
      const operation = writer.writable?.[method];
      if (typeof operation === "function") return operation.call(writer.writable, reason);
      return undefined;
    }).finally(() => {
      const release = writer.releaseDestination;
      writer.releaseDestination = null;
      release?.();
    });
    return writer.terminalPromise;
  }

  const render = () => {
    list.replaceChildren(
      ...[...transfers.values()].map((transfer) =>
        transferRow(document, transfer, () => cancelTransfer(transfer))),
    );
  };

  const setStatus = (message, state = "") => {
    status.textContent = message;
    status.dataset.state = state;
  };

  const fail = (transfer, error) => {
    transfer.state = error?.name === "AbortError" ? "partial" : "error";
    transfer.label = transfer.state === "partial"
      ? `partial — cancelled after ${formatBytes(transfer.done)}`
      : `error — ${error?.message || error}`;
    render();
  };

  const pruneHistory = (incoming) => {
    const target = Math.max(0, MAX_RETAINED_ROWS - incoming);
    for (const [key, transfer] of transfers) {
      if (transfers.size <= target) break;
      if (transfer.state === "complete" || transfer.state === "partial" || transfer.state === "error") {
        transfers.delete(key);
      }
    }
  };

  async function waitForSlot(signal) {
    while (!signal.aborted) {
      if (!controller) throw new Error("Boot Alpine before uploading files");
      const currentController = controller;
      const generation = controllerGeneration;
      for (let slot = 0; slot < UPLOAD_WORKERS; slot += 1) {
        const claim = slotKey(generation, slot);
        const ready = !claimedSlots.has(claim) && await currentController.fileTransferReady(slot);
        if (currentController !== controller || generation !== controllerGeneration) break;
        if (ready) {
          claimedSlots.add(claim);
          return { slot, claim, currentController, generation };
        }
      }
      await delay();
    }
    throw new DOMException("Upload cancelled", "AbortError");
  }

  async function waitForUploadState(currentController, generation, stream, signal) {
    while (!signal.aborted) {
      const snapshot = await currentController.fileTransferStatus();
      if (currentController !== controller || generation !== controllerGeneration) {
        throw new Error("file-transfer controller changed during upload");
      }
      const current = snapshot.uploads.find((item) => item.id === stream);
      if (current?.state === "complete") return current;
      if (current?.state === "partial") throw new DOMException("Upload cancelled", "AbortError");
      if (current?.state === "error") throw terminalUploadError(current);
      await delay();
    }
    throw new DOMException("Upload cancelled", "AbortError");
  }

  async function uploadFile(file, transfer) {
    let slot = null;
    let slotClaim = null;
    let currentController = null;
    let generation = 0;
    try {
      transfer.state = "hashing";
      transfer.label = "hashing locally";
      render();
      const sha256 = await hashFile(file, FileSha256, transfer.abort.signal);
      transfer.state = "queued";
      transfer.label = "waiting for guest agent";
      render();
      ({ slot, claim: slotClaim, currentController, generation } = await waitForSlot(transfer.abort.signal));
      transfer.ownerController = currentController;
      transfer.ownerGeneration = generation;
      transfer.state = "active";
      transfer.label = "uploading";
      transfer.stream = await currentController.beginFileUpload(slot, file.name, file.size, sha256);
      if (currentController !== controller || generation !== controllerGeneration) {
        throw new Error("file-transfer controller changed during upload");
      }
      render();

      const reader = file.stream().getReader();
      try {
        while (true) {
          if (transfer.abort.signal.aborted) {
            throw new DOMException("Upload cancelled", "AbortError");
          }
          const { done, value } = await reader.read();
          if (done) break;
          while (true) {
            const snapshot = await currentController.fileTransferStatus();
            if (currentController !== controller || generation !== controllerGeneration) {
              throw new Error("file-transfer controller changed during upload");
            }
            const current = snapshot.uploads.find((item) => item.id === transfer.stream);
            if (!current || current.buffered + value.byteLength <= snapshot.maxBuffered) break;
            if (current.state === "error") throw terminalUploadError(current);
            await delay();
          }
          await currentController.pushFileUpload(transfer.stream, value, false);
          if (transfer.abort.signal.aborted) throw new DOMException("Upload cancelled", "AbortError");
          if (currentController !== controller || generation !== controllerGeneration) {
            throw new Error("file-transfer controller changed during upload");
          }
          transfer.done += value.byteLength;
          render();
        }
      } finally {
        reader.releaseLock();
      }
      await currentController.pushFileUpload(transfer.stream, new Uint8Array(), true);
      await waitForUploadState(currentController, generation, transfer.stream, transfer.abort.signal);
      transfer.done = transfer.total;
      transfer.state = "complete";
      transfer.label = "complete — SHA-256 verified";
      render();
    } catch (caught) {
      let error = caught;
      if (transfer.stream != null && currentController) {
        try {
          const terminal = (await currentController.fileTransferStatus()).uploads
            .find((item) => item.id === transfer.stream);
          if (terminal?.diagnostic) {
            transfer.diagnostic = terminal.diagnostic;
            if (caught?.name !== "AbortError") error = terminalUploadError(terminal);
          }
        } catch {}
      }
      if (transfer.stream != null) {
        try { await currentController?.cancelFileUpload(transfer.stream); } catch {}
      }
      fail(transfer, error);
    } finally {
      if (transfer.stream != null) {
        try { await currentController?.dismissFileUpload(transfer.stream); } catch {}
      }
      if (slotClaim != null) claimedSlots.delete(slotClaim);
    }
  }

  async function runUploadWorkers() {
    const poolGeneration = controllerGeneration;
    if (workersRunningGeneration === poolGeneration) return;
    workersRunningGeneration = poolGeneration;
    const worker = async () => {
      while (uploadQueue.length) {
        const item = uploadQueue.shift();
        await uploadFile(item.file, item.transfer);
      }
    };
    await Promise.all(Array.from({ length: UPLOAD_WORKERS }, worker));
    if (workersRunningGeneration === poolGeneration) workersRunningGeneration = null;
    if (uploadQueue.length) void runUploadWorkers();
  }

  function enqueueFiles(files) {
    const selected = [...files];
    const outstanding = [...transfers.values()].filter(
      (transfer) =>
        transfer.direction === "upload" &&
        (transfer.state === "queued" || transfer.state === "hashing" || transfer.state === "active"),
    ).length;
    if (selected.length > MAX_SELECTED_FILES || outstanding + selected.length > MAX_SELECTED_FILES) {
      setStatus(
        `Selection rejected: ${outstanding + selected.length} outstanding files exceeds the ${MAX_SELECTED_FILES}-file bounded queue.`,
        "error",
      );
      return false;
    }
    pruneHistory(selected.length);
    for (const file of selected) {
      const transfer = {
        key: `upload-${++nextLocalId}`,
        direction: "upload",
        name: file.name,
        total: file.size,
        done: 0,
        state: "queued",
        label: "queued",
        abort: new AbortController(),
        stream: null,
        ownerController: null,
        ownerGeneration: 0,
      };
      transfers.set(transfer.key, transfer);
      uploadQueue.push({ file, transfer });
    }
    render();
    setStatus(`${selected.length} upload${selected.length === 1 ? "" : "s"} queued.`);
    wakePoll();
    void runUploadWorkers();
    return true;
  }

  async function openDownloadWriter(record, currentController, generation) {
    const key = downloadKey(generation, record.id);
    const targetDirectory = directory;
    if (downloadWriters.has(key) || !targetDirectory) return;
    const transfer = transfers.get(key);
    if (!transfer || transfer.state === "complete" || transfer.state === "partial" || transfer.state === "error") {
      return;
    }
    // Reserve the ID before either awaited picker call. The monitor can poll again while the
    // browser is opening the handle; without this reservation two writers can race, and the
    // empty loser may truncate a download that the winner just completed.
    const reservation = {
      writable: null,
      busy: true,
      operationPromise: null,
      terminalPromise: null,
      releaseDestination: null,
    };
    downloadWriters.set(key, reservation);
    try {
      const handle = await targetDirectory.getFileHandle(record.name, { create: true });
      if (
        currentController !== controller ||
        generation !== controllerGeneration ||
        downloadWriters.get(key) !== reservation
      ) return;
      reservation.releaseDestination = await acquireDownloadDestination(targetDirectory, record.name);
      if (
        currentController !== controller ||
        generation !== controllerGeneration ||
        downloadWriters.get(key) !== reservation
      ) {
        reservation.releaseDestination();
        reservation.releaseDestination = null;
        return;
      }
      const writable = await handle.createWritable();
      reservation.writable = writable;
      if (
        currentController !== controller ||
        generation !== controllerGeneration ||
        downloadWriters.get(key) !== reservation
      ) {
        await settleDownloadWriter(reservation, "abort", "file-transfer controller changed");
        return;
      }
      reservation.busy = false;
      transfer.label = "downloading";
      render();
    } catch (error) {
      if (reservation.writable) {
        try { await settleDownloadWriter(reservation, "abort", error); } catch {}
      } else if (reservation.releaseDestination) {
        reservation.releaseDestination();
        reservation.releaseDestination = null;
      }
      if (downloadWriters.get(key) === reservation) downloadWriters.delete(key);
      if (currentController !== controller || generation !== controllerGeneration) return;
      try { await currentController.cancelFileDownload(record.id); } catch {}
      fail(transfer, error);
    }
  }

  async function drainDownload(record, currentController, generation) {
    const key = downloadKey(generation, record.id);
    const writer = downloadWriters.get(key);
    const transfer = transfers.get(key);
    if (!writer?.writable || writer.busy || !transfer) return;
    const stale = () => currentController !== controller || generation !== controllerGeneration;
    writer.busy = true;
    try {
      while (true) {
        const chunk = await currentController.takeFileDownloadChunk(record.id);
        if (stale()) return;
        if (!chunk.byteLength) break;
        await runDownloadWriterOperation(writer, () => writer.writable.write(chunk));
        if (stale()) return;
        transfer.done += chunk.byteLength;
        render();
      }
      if (record.state === "awaiting-save" && record.buffered === 0) {
        await settleDownloadWriter(writer, "close");
        if (stale()) return;
        await currentController.finishFileDownload(record.id, true);
        if (stale()) return;
        await currentController.dismissFileDownload(record.id);
        if (stale()) return;
        transfer.done = transfer.total;
        transfer.state = "complete";
        transfer.label = "complete — SHA-256 verified";
        downloadWriters.delete(key);
        render();
      } else if (record.state === "partial") {
        await settleDownloadWriter(writer, "abort", "guest cancelled transfer");
        if (stale()) return;
        await currentController.dismissFileDownload(record.id);
        if (stale()) return;
        downloadWriters.delete(key);
        transfer.state = "partial";
        transfer.label = `partial — cancelled after ${formatBytes(transfer.done)}`;
        render();
      }
    } catch (error) {
      if (stale()) return;
      try { await settleDownloadWriter(writer, "abort", error); } catch {}
      if (stale()) return;
      downloadWriters.delete(key);
      try {
        if (record.state === "awaiting-save") await currentController.finishFileDownload(record.id, false);
        else await currentController.cancelFileDownload(record.id);
      } catch {}
      if (stale()) return;
      try { await currentController.dismissFileDownload(record.id); } catch {}
      if (stale()) return;
      fail(transfer, error);
    } finally {
      writer.busy = false;
    }
  }

  function syncDownloads(snapshot, currentController, generation) {
    for (const record of snapshot.downloads) {
      const key = downloadKey(generation, record.id);
      if (!transfers.has(key)) {
        transfers.set(key, {
          key,
          id: record.id,
          generation,
          direction: "download",
          name: record.name,
          total: record.total,
          done: 0,
          state: "active",
          label: directory ? "starting download" : "waiting for download folder",
        });
        render();
      }
      const transfer = transfers.get(key);
      if (
        directory &&
        transfer.state !== "complete" &&
        transfer.state !== "partial" &&
        transfer.state !== "error"
      ) {
        void openDownloadWriter(record, currentController, generation)
          .then(() => drainDownload(record, currentController, generation));
      }
    }
  }

  async function poll() {
    while (!stopped) {
      // An attached controller alone is idle: do not serialize status and enqueue a Worker RPC
      // forever when the user never enabled downloads or queued an upload. Choosing a destination
      // arms guest-initiated download discovery; an upload/active transfer also wakes the monitor.
      if (!pollIsArmed()) {
        await new Promise((resolve) => { pollWake = resolve; });
        continue;
      }
      try {
        if (controller) {
          const currentController = controller;
          const generation = controllerGeneration;
          const snapshot = await currentController.fileTransferStatus();
          if (currentController !== controller || generation !== controllerGeneration) continue;
          syncDownloads(snapshot, currentController, generation);
          await Promise.all(snapshot.downloads.map((record) =>
            drainDownload(record, currentController, generation)));
        }
      } catch (error) {
        setStatus(`File transfer monitor error: ${error?.message || error}`, "error");
      }
      const active = hasActiveTransfers();
      await delay(active ? POLL_MS : 500);
    }
  }

  function cancelTransfer(transfer) {
    if (transfer.direction === "upload") {
      transfer.abort.abort();
      if (transfer.stream != null) {
        const owner = transfer.ownerController;
        ignoreRejection(() => owner?.cancelFileUpload(transfer.stream));
      }
    } else {
      ignoreRejection(() => controller?.cancelFileDownload(transfer.id));
    }
    transfer.state = "partial";
    transfer.label = `partial — cancelled after ${formatBytes(transfer.done)}`;
    render();
  }

  function containsDirectory(dataTransfer) {
    return [...(dataTransfer?.items || [])].some((item) => item.webkitGetAsEntry?.()?.isDirectory);
  }

  choose.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    enqueueFiles(input.files || []);
    input.value = "";
  });
  for (const type of ["dragenter", "dragover"]) {
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.add("dragging");
    });
  }
  for (const type of ["dragleave", "drop"]) {
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.remove("dragging");
    });
  }
  drop.addEventListener("drop", (event) => {
    if (containsDirectory(event.dataTransfer)) {
      setStatus("Directories are rejected; select files only.", "error");
      return;
    }
    enqueueFiles(event.dataTransfer?.files || []);
  });
  drop.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.click();
    }
  });
  chooseDownload.addEventListener("click", async () => {
    try {
      directory = await openDirectory();
      await controller?.setFileDownloadReady(true);
      wakePoll();
      setStatus(`Downloads stream directly into “${directory.name || "selected folder"}”.`, "ready");
    } catch (error) {
      if (error?.name !== "AbortError") setStatus(`Cannot open download folder: ${error?.message || error}`, "error");
    }
  });

  void poll();
  return {
    attachController(next) {
      const previous = controller;
      if (previous !== next) {
        controllerGeneration += 1;
        if (previous) ignoreRejection(() => previous.setFileDownloadReady(false));
        for (const writer of downloadWriters.values()) {
          if (writer.writable) {
            ignoreRejection(() => settleDownloadWriter(
              writer,
              "abort",
              "file-transfer controller changed",
            ));
          }
        }
        downloadWriters.clear();
        let changed = false;
        for (const transfer of transfers.values()) {
          if (transfer.direction === "upload" &&
              (transfer.state === "queued" || transfer.state === "hashing" || transfer.state === "active")) {
            transfer.abort.abort();
            transfer.state = "partial";
            transfer.label = `partial — controller changed after ${formatBytes(transfer.done)}`;
            changed = true;
          }
          if (transfer.direction === "download" && transfer.state === "active") {
            transfer.state = "partial";
            transfer.label = `partial — controller changed after ${formatBytes(transfer.done)}`;
            changed = true;
          }
        }
        if (changed) render();
      }
      controller = next;
      // Old-generation workers may be stuck inside an uncooperative controller Promise even after
      // their AbortSignal fires. A generation-owned pool lets fresh uploads start immediately; late
      // old finally blocks release only their generation-qualified slot claims.
      if (uploadQueue.length) void runUploadWorkers();
      if (controller) ignoreRejection(() => controller.setFileDownloadReady(Boolean(directory)));
      setStatus(
        next
          ? "WVFT controller attached; uploads wait for two bounded guest-agent connections."
          : "Boot Alpine to enable WVFT.",
        next ? "ready" : "",
      );
    },
    enqueueFiles,
    setDownloadDirectory(next) {
      directory = next;
      ignoreRejection(() => controller?.setFileDownloadReady(Boolean(directory)));
      if (directory) wakePoll();
    },
    snapshot: () => [...transfers.values()].map(({ abort, ownerController, ...transfer }) => ({ ...transfer })),
    stop() {
      stopped = true;
      wakePoll();
    },
  };
}
