const MAX_SELECTED_FILES = 32;
const MAX_RETAINED_ROWS = 64;
const UPLOAD_WORKERS = 2;
const POLL_MS = 24;

const delay = (ms = POLL_MS) => new Promise((resolve) => setTimeout(resolve, ms));

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

function safePercent(done, total) {
  return total === 0 ? 100 : Math.min(100, Math.floor((done / total) * 100));
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
  let controller = null;
  let directory = null;
  let stopped = false;
  let nextLocalId = 0;
  let workersRunning = false;

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
      for (let slot = 0; slot < UPLOAD_WORKERS; slot += 1) {
        if (!claimedSlots.has(slot) && controller.fileTransferReady(slot)) {
          claimedSlots.add(slot);
          return slot;
        }
      }
      await delay();
    }
    throw new DOMException("Upload cancelled", "AbortError");
  }

  async function waitForUploadState(stream, signal) {
    while (!signal.aborted) {
      const current = controller.fileTransferStatus().uploads.find((item) => item.id === stream);
      if (current?.state === "complete") return current;
      if (current?.state === "partial") throw new DOMException("Upload cancelled", "AbortError");
      if (current?.state === "error") throw new Error("guest rejected the upload");
      await delay();
    }
    throw new DOMException("Upload cancelled", "AbortError");
  }

  async function uploadFile(file, transfer) {
    let slot = null;
    try {
      transfer.state = "hashing";
      transfer.label = "hashing locally";
      render();
      const sha256 = await hashFile(file, FileSha256, transfer.abort.signal);
      transfer.state = "queued";
      transfer.label = "waiting for guest agent";
      render();
      slot = await waitForSlot(transfer.abort.signal);
      transfer.state = "active";
      transfer.label = "uploading";
      transfer.stream = controller.beginFileUpload(slot, file.name, file.size, sha256);
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
            const snapshot = controller.fileTransferStatus();
            const current = snapshot.uploads.find((item) => item.id === transfer.stream);
            if (!current || current.buffered + value.byteLength <= snapshot.maxBuffered) break;
            if (current.state === "error") throw new Error("guest rejected the upload");
            await delay();
          }
          controller.pushFileUpload(transfer.stream, value, false);
          transfer.done += value.byteLength;
          render();
        }
      } finally {
        reader.releaseLock();
      }
      controller.pushFileUpload(transfer.stream, new Uint8Array(), true);
      await waitForUploadState(transfer.stream, transfer.abort.signal);
      transfer.done = transfer.total;
      transfer.state = "complete";
      transfer.label = "complete — SHA-256 verified";
      render();
    } catch (error) {
      if (transfer.stream != null) {
        try { controller?.cancelFileUpload(transfer.stream); } catch {}
      }
      fail(transfer, error);
    } finally {
      if (transfer.stream != null) {
        try { controller?.dismissFileUpload(transfer.stream); } catch {}
      }
      if (slot != null) claimedSlots.delete(slot);
    }
  }

  async function runUploadWorkers() {
    if (workersRunning) return;
    workersRunning = true;
    const worker = async () => {
      while (uploadQueue.length) {
        const item = uploadQueue.shift();
        await uploadFile(item.file, item.transfer);
      }
    };
    await Promise.all(Array.from({ length: UPLOAD_WORKERS }, worker));
    workersRunning = false;
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
      };
      transfers.set(transfer.key, transfer);
      uploadQueue.push({ file, transfer });
    }
    render();
    setStatus(`${selected.length} upload${selected.length === 1 ? "" : "s"} queued.`);
    void runUploadWorkers();
    return true;
  }

  async function openDownloadWriter(record) {
    if (downloadWriters.has(record.id) || !directory) return;
    const transfer = transfers.get(`download-${record.id}`);
    if (!transfer || transfer.state === "complete" || transfer.state === "partial" || transfer.state === "error") {
      return;
    }
    // Reserve the ID before either awaited picker call. The monitor can poll again while the
    // browser is opening the handle; without this reservation two writers can race, and the
    // empty loser may truncate a download that the winner just completed.
    downloadWriters.set(record.id, { writable: null, busy: true });
    try {
      const handle = await directory.getFileHandle(record.name, { create: true });
      const writable = await handle.createWritable();
      downloadWriters.set(record.id, { writable, busy: false });
      transfer.label = "downloading";
      render();
    } catch (error) {
      downloadWriters.delete(record.id);
      try { controller.cancelFileDownload(record.id); } catch {}
      fail(transfer, error);
    }
  }

  async function drainDownload(record) {
    const writer = downloadWriters.get(record.id);
    const transfer = transfers.get(`download-${record.id}`);
    if (!writer?.writable || writer.busy || !transfer) return;
    writer.busy = true;
    try {
      while (true) {
        const chunk = controller.takeFileDownloadChunk(record.id);
        if (!chunk.byteLength) break;
        await writer.writable.write(chunk);
        transfer.done += chunk.byteLength;
        render();
      }
      if (record.state === "awaiting-save" && record.buffered === 0) {
        await writer.writable.close();
        controller.finishFileDownload(record.id, true);
        transfer.done = transfer.total;
        transfer.state = "complete";
        transfer.label = "complete — SHA-256 verified";
        downloadWriters.delete(record.id);
        controller.dismissFileDownload(record.id);
        render();
      } else if (record.state === "partial") {
        await writer.writable.abort("guest cancelled transfer");
        downloadWriters.delete(record.id);
        transfer.state = "partial";
        transfer.label = `partial — cancelled after ${formatBytes(transfer.done)}`;
        controller.dismissFileDownload(record.id);
        render();
      }
    } catch (error) {
      try { await writer.writable.abort(error); } catch {}
      downloadWriters.delete(record.id);
      try {
        if (record.state === "awaiting-save") controller.finishFileDownload(record.id, false);
        else controller.cancelFileDownload(record.id);
      } catch {}
      try { controller.dismissFileDownload(record.id); } catch {}
      fail(transfer, error);
    } finally {
      writer.busy = false;
    }
  }

  function syncDownloads() {
    if (!controller) return;
    const snapshot = controller.fileTransferStatus();
    for (const record of snapshot.downloads) {
      const key = `download-${record.id}`;
      if (!transfers.has(key)) {
        transfers.set(key, {
          key,
          id: record.id,
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
        void openDownloadWriter(record).then(() => drainDownload(record));
      }
    }
  }

  async function poll() {
    while (!stopped) {
      try {
        syncDownloads();
        if (controller) {
          const downloads = controller.fileTransferStatus().downloads;
          await Promise.all(downloads.map(drainDownload));
        }
      } catch (error) {
        setStatus(`File transfer monitor error: ${error?.message || error}`, "error");
      }
      await delay();
    }
  }

  function cancelTransfer(transfer) {
    if (transfer.direction === "upload") {
      transfer.abort.abort();
      if (transfer.stream != null) {
        try { controller?.cancelFileUpload(transfer.stream); } catch {}
      }
    } else {
      try { controller?.cancelFileDownload(transfer.id); } catch {}
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
      controller?.setFileDownloadReady(true);
      setStatus(`Downloads stream directly into “${directory.name || "selected folder"}”.`, "ready");
      syncDownloads();
    } catch (error) {
      if (error?.name !== "AbortError") setStatus(`Cannot open download folder: ${error?.message || error}`, "error");
    }
  });

  void poll();
  return {
    attachController(next) {
      if (controller && controller !== next) {
        try { controller.setFileDownloadReady(false); } catch {}
      }
      controller = next;
      if (controller) controller.setFileDownloadReady(Boolean(directory));
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
      controller?.setFileDownloadReady(Boolean(directory));
      syncDownloads();
    },
    snapshot: () => [...transfers.values()].map(({ abort, ...transfer }) => ({ ...transfer })),
    stop() {
      stopped = true;
    },
  };
}
