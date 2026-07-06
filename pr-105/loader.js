// E2-T21: the browser cold-start loader. Stream-fetches the boot artifacts with honest
// progress, INTEGRITY-CHECKS them against the manifest sha256 (a corrupt image must never
// boot), instantiates the WASM module, and boots unmodified Linux via `WasmLinux`, driving the
// run loop off `setTimeout` so the main thread stays responsive (workers/SAB are Epic 4).
//
// Memory discipline (32-bit wasm): streamed chunks are accumulated then concatenated once —
// a transient ~2x peak in JS heap during the concat (sweep-critic E2-T21: the old comment
// claimed a single preallocated buffer; that optimization is future work and a prerequisite
// for the deferred 512 MB single-copy audit). The result is handed to wasm by one copy in the
// `WasmLinux` constructor. No intermediate Blob/ArrayBuffer duplication beyond that.

import init, { WasmLinux, overlayDbName } from "./pkg/wasm_vm_wasm.js";

/** Fetch `url` into one preallocated buffer, reporting `(loaded, total)`; `total` is null when
 *  the server sends no Content-Length (progress must degrade to indeterminate, not lie). */
async function fetchWithProgress(url, onProgress) {
  const resp = await fetch(url, { cache: "default" });
  if (!resp.ok) throw new Error(`fetch ${url} → HTTP ${resp.status} ${resp.statusText}`);
  // A gzip TRANSFER encoding reports the compressed length or none; a gzipped *representation*
  // (Content-Encoding on a pre-gzipped file we decode ourselves) reports the stored length. We
  // only trust Content-Length as a progress hint, never for the buffer size after the fact.
  const lenHeader = resp.headers.get("Content-Length");
  const total = lenHeader ? parseInt(lenHeader, 10) : null;
  const reader = resp.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total); // total null ⇒ indeterminate
  }
  // Single concatenation into the final buffer.
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** Fetch a text resource, failing with a CLEAR message when the file is missing. A dev server that
 *  lacks the local-only Alpine assets returns its HTML 404 page; parsing that as JSON would otherwise
 *  blow up as the cryptic "Unexpected token '<', "<!DOCTYPE"...". Returns the response text. */
async function fetchAsset(url, what) {
  let resp;
  try {
    resp = await fetch(url, { cache: "default" });
  } catch (e) {
    throw new Error(`could not fetch ${what} (${url}): ${e.message || e}`);
  }
  const text = await resp.text();
  if (!resp.ok || text.trimStart().startsWith("<")) {
    throw new Error(
      `${what} not found at ${url} (HTTP ${resp.status}). The chunked Alpine boot needs local-only ` +
        `assets (web/artifacts-alpine.json + releases/chunked-alpine/) that are NOT on the public ` +
        `deploy — build the chunked image with \`wasm-vm chunk\` and serve via \`bash tools/serve-dev.sh\`.`,
    );
  }
  return text;
}

/** Fetch + parse a JSON manifest with the clear-error handling of `fetchAsset`. */
async function fetchJsonAsset(url, what) {
  const text = await fetchAsset(url, what);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${what} at ${url} is not valid JSON.`);
  }
}

/** Lowercase hex SHA-256 of `bytes` (WebCrypto). */
async function sha256hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Cold-load and boot. `opts`:
 *   manifestUrl   URL of web/artifacts.json (default "./artifacts.json")
 *   ramMib        guest RAM (default 256)
 *   bootargs      kernel cmdline (default the busybox console line)
 *   onState(s)    "fetching" | "verifying" | "instantiating" | "booting" | "done" | "error"
 *   onProgress(role, loaded, total)   per-artifact bytes
 *   onOutput(u8)  console bytes (feed to the terminal)
 *   onError(err)  a specific, surfaced failure (HTTP status / hash mismatch / boot error)
 *   quantum       instructions per run tick (default 2_000_000)
 * Returns a controller: { sendInput(bytes), stop(), whenDone: Promise<string> }.
 */
// E3-T10: "reset disk" — delete THIS image's durable overlay (its own IndexedDB database),
// scoped by the manifest's base hash so a second image's overlay survives. Returns true if a
// database was deleted. The caller must ensure no tab is booted rw against it (the writer lock
// makes a live wipe race impossible — a running writer holds the lock; reset from a fresh page).
export async function resetDisk(manifestUrl = "./releases/chunked-alpine/manifest.json") {
  await init();
  const text = await (await fetch(manifestUrl, { cache: "no-store" })).text();
  const name = overlayDbName(text);
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    let blocked = false;
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error("deleteDatabase failed"));
    // E3-T10 (critic BUG-4): a blocked delete has NOT deleted — an open connection is holding it.
    // Do NOT resolve as success. The caller must close its connection first (closeStorage); the
    // versionchange handler in IdbStore then closes it and onsuccess fires. If we're still blocked
    // after a grace period, report failure rather than claim a phantom reset.
    req.onblocked = () => { blocked = true; };
    setTimeout(() => {
      if (blocked) reject(new Error("reset blocked: a tab still has the disk open — close other tabs"));
    }, 3000);
  });
  return name;
}

export async function startLinuxBoot(opts = {}) {
  const {
    manifestUrl = "./artifacts.json",
    // "initramfs" = busybox (the gh-pages default); "disk" = Alpine ext4 over virtio-blk (the whole
    // 512 MB image is downloaded up front); "chunked" = the SAME Alpine image but fetched lazily,
    // one E3-T01 chunk at a time over HTTP, so boot touches only a fraction of the image. Both disk
    // modes are local-only (served by tools/serve-dev.sh) — too big for gh-pages.
    mode = "initramfs",
    // E3-T02 chunked mode: URL of the image manifest.json produced by `wasm-vm chunk`. `baseUrl`
    // (the directory chunks live under) defaults to the manifest's directory.
    imageManifestUrl = "./releases/chunked-alpine/manifest.json",
    // E3-T03 boot-profile URL (ordered chunk indices to prefetch up front); missing → readahead-only.
    bootProfileUrl = "./releases/chunked-alpine/boot-profile.json",
    // E3-T03 block-cache byte budget in MiB (0 → 256 MiB default). Set low to exercise eviction.
    cacheBudgetMib = 0,
    // E3-T05: persist the copy-on-write overlay to IndexedDB (writes survive a tab reload). Only
    // meaningful in "chunked" mode; the driver flushes via machine.persistPending() each tick.
    persist = false,
    ramMib = 256,
    onState = () => {},
    onProgress = () => {},
    onOutput = () => {},
    onError = () => {},
    // E3-T09: called with { readOnly: bool } once the writer Web Lock is resolved for a
    // persistent boot — the UI shows the RO banner / retry-as-writer affordance on it.
    onWriterStatus = () => {},
    // E3-T10: called with { usage, quota, granted } once at boot (persistent boots) so the UI
    // can show the storage indicator; `granted` is the navigator.storage.persist() result.
    onStorage = () => {},
    // E3-T10: called with { usage, quota } when a durable write hits the storage quota — the VM
    // is PAUSED before returning; the UI shows the dialog and calls the returned controller's
    // resumeAfterQuota()/continueReadOnly()/resetDisk() to act.
    onQuota = () => {},
    quantum = 2_000_000,
  } = opts;
  // E3-T09 (critic BUG-1): hoisted ABOVE the try so the catch can release a granted writer
  // lock when boot fails AFTER acquisition — otherwise a banner-less zombie tab strands the
  // lock until close and every other tab silently boots read-only.
  let releaseLock = null;
  const isChunked = mode === "chunked";
  // Disk/chunked modes leave bootargs empty so WasmLinux supplies `root=/dev/vda rw …`.
  const bootargs = opts.bootargs ?? (mode === "initramfs" ? "console=ttyS0 earlycon=sbi" : "");
  const role = mode === "disk" ? "rootfs" : "initramfs";
  const baseUrl = opts.baseUrl ?? imageManifestUrl.replace(/[^/]*$/, "");

  try {
    const manifest = await fetchJsonAsset(manifestUrl, "boot manifest");
    const km = manifest.artifacts.kernel;

    onState("fetching");
    // The kernel is always fetched whole (small). The rootfs is fetched whole for disk/initramfs
    // modes; in chunked mode it is NOT — only the image manifest is fetched now, and its chunks are
    // pulled lazily during boot by WasmLinux.fetchPending.
    const kernel = await fetchWithProgress(km.url, (l, t) => onProgress("kernel", l, t));
    let secondaryBytes = null;
    let imageManifestText = null;
    let bootProfile = new Uint32Array(0);
    if (isChunked) {
      // The chunked image manifest (JSON text handed to wasm as-is). Clear error if the local-only
      // asset is missing rather than a cryptic parse failure later.
      imageManifestText = await fetchAsset(imageManifestUrl, "chunked image manifest");
      // E3-T03: an optional boot-profile.json (ordered chunk indices) prefetched up front. Best-
      // effort — a missing profile just means no boot-profile prefetch (readahead still applies).
      try {
        const pr = await fetch(bootProfileUrl, { cache: "default" });
        if (pr.ok) {
          const arr = await pr.json();
          if (Array.isArray(arr)) bootProfile = Uint32Array.from(arr.filter((n) => Number.isInteger(n) && n >= 0));
        }
      } catch { /* no profile → readahead-only */ }
    } else {
      const secondary = manifest.artifacts[role];
      if (!secondary) throw new Error(`manifest has no '${role}' artifact for boot mode '${mode}'`);
      secondaryBytes = await fetchWithProgress(secondary.url, (l, t) => onProgress(role, l, t));
      onState("verifying");
      for (const [name, bytes, want] of [
        ["kernel", kernel, km.sha256],
        [role, secondaryBytes, secondary.sha256],
      ]) {
        const got = await sha256hex(bytes);
        if (got !== want) {
          throw new Error(`integrity check failed for ${name}: expected ${want}, got ${got} — refusing to boot corrupt bytes`);
        }
      }
    }
    // Chunked mode verifies the kernel (small) but defers rootfs integrity to per-chunk hash checks
    // inside wasm (ChunkStore verify-on-insert) — the whole point is never downloading it whole.
    if (isChunked) {
      const got = await sha256hex(kernel);
      if (got !== km.sha256) {
        throw new Error(`integrity check failed for kernel: expected ${km.sha256}, got ${got}`);
      }
    }

    onState("instantiating");
    await init(); // WebAssembly.instantiateStreaming under the hood (wasm-pack --target web)

    onState("booting");
    // disk → in-memory virtio-blk backend (whole image); chunked → a ChunkedBackend that lazily
    // HTTP-fetches chunks under baseUrl (+ E3-T05 persist: writes survive reload via IndexedDB);
    // initramfs → the image as the initrd.
    const usePersist = isChunked && persist;
    // E3-T08: dirty-bytes threshold that forces a drain before more guest work (default 16 MiB;
    // tests set it tiny via the persistMax option to prove the backpressure path).
    const maxDirtyBytes = opts.persistMax ?? 16 * 1024 * 1024;
    let machine;
    // E3-T09: the disk is owned by ANOTHER tab (Web Lock not held) → never persist, disk RO.
    let lockReadOnly = false;
    // E3-T10: this tab owns the disk but storage is full → refuse NEW guest writes (disk RO) yet
    // KEEP draining the pending backlog (it can only shrink; blocks persist once space frees).
    // Distinct from lockReadOnly precisely so the pump stays alive (critic BUG-1).
    let quotaReadOnly = false;
    // E3-T10 (critic BUG-3): the quota pause is its OWN flag so visibilitychange's resume() can't
    // resume the VM behind the dialog. It gates the pump/run independently of `paused`.
    let quotaPaused = false;
    let lastPersistRetry = 0; // throttle backlog retries while quotaReadOnly (BUG-1 dialog storm)
    if (usePersist) {
      // E3-T09 single-writer discipline: exactly one tab may open the overlay writable. The
      // exclusive Web Lock (auto-released on tab close/crash — no heartbeats) is acquired
      // BEFORE the writable store opens; a second tab probes with ifAvailable (queueing would
      // hang its boot) and falls back to a read-only boot: writes rejected at the backend
      // seam, VIRTIO_BLK_F_RO advertised, guest mounts `/` ro, NO persist pump.
      // E3-T09 (critic BUG-3): key the lock on the MANIFEST CONTENT digest, not the URL
      // string — the IndexedDB name is keyed on the base hash, so two URL spellings of the
      // same image must contend for the SAME lock.
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(imageManifestText));
      const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      const lockName = `wasm-vm-disk-${hex}`;
      if (navigator.locks) {
        const granted = await new Promise((resolve) => {
          navigator.locks
            .request(lockName, { ifAvailable: true }, (lock) => {
              if (lock === null) {
                resolve(false);
                return; // not held; the request callback ends immediately
              }
              resolve(true);
              // Hold the lock for the tab's lifetime: the callback's promise resolving is
              // what releases it, so we park it on a promise `stop()`/takeover resolves.
              return new Promise((release) => {
                releaseLock = release;
              });
            })
            .catch(() => resolve(false));
        });
        lockReadOnly = !granted;
      } else {
        // E3-T09 (critic BUG-2): without the Web Locks API there is NO single-writer
        // guarantee — fail CLOSED (read-only) rather than silently risking a double writer
        // against the shared IndexedDB.
        console.warn("wasm-vm: Web Locks API unavailable — persistent boot forced read-only");
        lockReadOnly = true;
      }
      onWriterStatus({ readOnly: lockReadOnly });
      // E3-T10: request durable (non-best-effort) storage ONCE so eviction-under-pressure can't
      // silently delete the disk, and report usage/quota. RO tabs skip persist() (they don't own
      // the disk). Failures here are non-fatal — the boot proceeds either way.
      try {
        let granted = false;
        if (!lockReadOnly && navigator.storage?.persist) granted = await navigator.storage.persist();
        const est = navigator.storage?.estimate ? await navigator.storage.estimate() : {};
        onStorage({ usage: est.usage ?? null, quota: est.quota ?? null, granted });
      } catch { /* storage API absent → no indicator */ }
      // Async: opens IndexedDB, reconciles the base binding, loads any previously persisted blocks.
      machine = await WasmLinux.newChunkedDiskPersistent(ramMib, kernel, imageManifestText, baseUrl, cacheBudgetMib, bootProfile, bootargs, lockReadOnly, (u8) => onOutput(u8));
    } else if (isChunked) {
      machine = WasmLinux.newChunkedDisk(ramMib, kernel, imageManifestText, baseUrl, cacheBudgetMib, bootProfile, bootargs, (u8) => onOutput(u8));
    } else if (mode === "disk") {
      machine = WasmLinux.newDisk(ramMib, kernel, secondaryBytes, bootargs, (u8) => onOutput(u8));
    } else {
      machine = new WasmLinux(ramMib, kernel, secondaryBytes, bootargs, (u8) => onOutput(u8));
    }

    let stopped = false;
    let paused = false;
    // Exactly one `tick` may be pending at a time. `resume()` guarding only on `paused` is not
    // enough: a rapid pause→resume while a tick is already pending would schedule a SECOND chain,
    // and both would then self-perpetuate (two concurrent loops, double CPU). This flag makes
    // scheduling idempotent so there is always at most one pending tick. (E2-T23 critic C3.)
    let tickScheduled = false;
    let resolveDone;
    const whenDone = new Promise((r) => (resolveDone = r));
    const schedule = () => {
      if (tickScheduled || stopped || paused || quotaPaused) return;
      tickScheduled = true;
      setTimeout(tick, 0);
    };
    // E3-T10: shared handler for a persist failure on EITHER pump site. A StorageFull is
    // RECOVERABLE — the dirty blocks stay pending (persistPending never marked them). While the
    // user is in "continue read-only" mode the backlog just keeps retrying quietly (no new writes
    // arrive, so it can only shrink); otherwise PAUSE via the quota flag and raise the dialog.
    // Returns true if the caller should stop this tick.
    const handlePersistError = async (e) => {
      if (String(e?.message || e).startsWith("StorageFull")) {
        if (quotaReadOnly) return true; // expected while space is full; retry next throttled tick
        quotaPaused = true;
        tickScheduled = false;
        let est = {};
        try { est = navigator.storage?.estimate ? await navigator.storage.estimate() : {}; } catch {}
        let unsaved = false;
        try { unsaved = machine.hasUnpersisted(); } catch {}
        onQuota({ usage: est.usage ?? null, quota: est.quota ?? null, unsaved });
        return true;
      }
      tickScheduled = false;
      onState("error");
      onError(e);
      resolveDone("error");
      return true;
    };
    // `tick` is async so chunked mode can `await` the lazy chunk fetch between run quanta. To keep
    // the E2-T23 C3 single-tick invariant across the await, `tickScheduled` stays TRUE for the whole
    // duration of a tick (run + fetch) and is cleared only at the end — so any `schedule()` during
    // the fetch is a no-op and no second loop can start.
    const tick = async () => {
      if (stopped || paused || quotaPaused) { tickScheduled = false; return; }
      // E3-T08 durability pressure, checked BEFORE the run slice:
      //  - flushWaiting: a guest FLUSH is parked on the durable-commit barrier — persist NOW so
      //    the barrier clears at the very next boundary (the guest's `sync` is blocked on it).
      //  - pendingBytes > maxDirtyBytes: backpressure — drain before running more guest work, so
      //    an unflushed session cannot accumulate unbounded dirty state (bounded loss window).
      if (usePersist && !lockReadOnly) {
        try {
          const ps = machine.persistStats();
          // While quotaReadOnly, no new writes arrive — retry the backlog at most every ~3s so a
          // still-full quota doesn't hammer IndexedDB every quantum (critic BUG-1 storm).
          const throttled = quotaReadOnly && Date.now() - lastPersistRetry < 3000;
          if (!throttled && (ps.flushWaiting || ps.pendingBytes > maxDirtyBytes)) {
            if (quotaReadOnly) lastPersistRetry = Date.now();
            await machine.persistPending();
          }
        } catch (e) {
          if (await handlePersistError(e)) return;
        }
        if (stopped || paused || quotaPaused) { tickScheduled = false; return; }
      }
      let res;
      try {
        res = machine.runChunk(quantum);
      } catch (e) {
        tickScheduled = false;
        onState("error");
        onError(e);
        resolveDone("error");
        return;
      }
      if (res.done) {
        tickScheduled = false;
        onState("done");
        resolveDone(res.state);
        return;
      }
      // E3-T02 chunked boot: a guest disk read may have parked awaiting a chunk. Fetch every parked
      // chunk (hash-verified in wasm) before the next quantum, or the parked reads never complete.
      if (isChunked) {
        try {
          if (machine.pendingChunks().length > 0) await machine.fetchPending();
        } catch (e) {
          tickScheduled = false;
          onState("error");
          onError(e);
          resolveDone("error");
          return;
        }
        if (stopped || paused) { tickScheduled = false; return; }
      }
      // E3-T05: durably flush any overlay writes to IndexedDB (cheap no-op when nothing is pending;
      // resolves on the IndexedDB transaction complete, so a flush before reload survives it).
      if (usePersist && !lockReadOnly) {
        try {
          const throttled = quotaReadOnly && Date.now() - lastPersistRetry < 3000;
          if (!throttled) {
            if (quotaReadOnly) lastPersistRetry = Date.now();
            await machine.persistPending();
          }
        } catch (e) {
          if (await handlePersistError(e)) return;
        }
        if (stopped || paused || quotaPaused) { tickScheduled = false; return; }
      }
      // Yield to the event loop so the page stays responsive (no main-thread freeze).
      tickScheduled = false;
      schedule();
    };
    schedule();

    return {
      sendInput: (bytes) => {
        if (!stopped) machine.sendInput(bytes);
      },
      stop: () => {
        stopped = true;
        resolveDone("stopped");
      },
      // E2-T23: pause/resume the executor. Because guest `mtime` is a DETERMINISTIC retire-count
      // clock (not a wall clock), pausing simply stops retiring instructions → guest monotonic
      // time freezes and continues seamlessly on resume. No slew clamp, catch-up storm, or
      // deadline reconciliation is possible — the "giant jump on resume" that wall-clock designs
      // fear cannot occur here. The goldfish RTC (Date.now) keeps true wall time across the pause,
      // so on resume `date` is correct while `uptime` reflects only executed time. See
      // docs/timekeeping.md. main.js drives these from `visibilitychange` to idle a hidden tab.
      pause: () => { paused = true; },
      resume: () => {
        if (paused && !stopped) {
          paused = false;
          schedule(); // idempotent — never spawns a second loop even if a tick is still pending
        }
      },
      isPaused: () => paused,
      // E3-T02: chunked-boot instrumentation — `{ fetches, bytes, error }` (bytes transferred so
      // far via lazy chunk fetch). Null for non-chunked boots. Drives the <40%-of-image acceptance.
      fetchStats: () => (isChunked ? machine.fetchStats() : null),
      // E3-T05: force a durable flush of the overlay to IndexedDB (resolves when the txn completes).
      persist: () => (usePersist && !lockReadOnly ? machine.persistPending() : Promise.resolve(0)),
      // E3-T09: is this boot read-only (lock not held, OR quota forced it)?
      readOnly: () => lockReadOnly || quotaReadOnly,
      // E3-T10 quota-dialog actions ------------------------------------------------------------
      // "Free space in guest & retry": clear the quota pause and resume — the still-pending
      // writes retry on the next tick (succeed once the guest freed origin space, else re-dialog).
      resumeAfterQuota: () => { quotaPaused = false; schedule(); },
      // "Continue read-only": refuse NEW guest writes (disk RO → EIO) but KEEP the persist pump
      // alive so the already-acked pending backlog still drains when space frees (critic BUG-1:
      // must NOT strand acked writes). Existing durable data is intact.
      continueReadOnly: () => {
        try { machine.setDiskReadOnly(); } catch {}
        quotaReadOnly = true;
        quotaPaused = false;
        lastPersistRetry = 0;
        schedule();
      },
      // E3-T10: does the overlay still hold acked-but-unpersisted blocks? (dialog copy uses it)
      hasUnpersisted: () => { try { return machine.hasUnpersisted(); } catch { return false; } },
      // Current {usage, quota} for the storage indicator.
      storageEstimate: () => (navigator.storage?.estimate ? navigator.storage.estimate() : Promise.resolve({})),
      // E3-T10 (critic BUG-4): close the IndexedDB connection so reset-disk's deleteDatabase can
      // actually delete (our open handle would otherwise block it forever). Call before wiping.
      closeStorage: () => { try { machine.closeStorage(); } catch {} },
      // E3-T09: explicitly release the writer lock (poweroff/stop paths; close/crash releases
      // it automatically via Web Locks semantics).
      releaseWriterLock: () => {
        if (releaseLock) {
          releaseLock();
          releaseLock = null;
        }
      },
      whenDone,
    };
  } catch (e) {
    // E3-T09 (critic BUG-1): a granted writer lock must not outlive a failed boot.
    if (releaseLock) {
      releaseLock();
      releaseLock = null;
    }
    onState("error");
    onError(e);
    throw e;
  }
}
