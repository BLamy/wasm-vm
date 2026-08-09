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

import init, {
  WasmLinux,
  overlayDbName,
  seedOverlayDelta,
  setSlirpNet,
  setSlirpRelay,
  setSlirpRelayToken,
  setSlirpTailscaleWorker,
  slirpTailscaleCommand,
  setSlirpDohEndpoint,
  setSlirpDhcpLeaseSeconds,
  setSlirpMtu,
  slirpDhcpStats,
} from "./pkg/wasm_vm_wasm.js";
import { decideBootPath, deriveBootSnapshotBaseId } from "./boot-path.js";

// Responsiveness: a near-zero-delay "yield to the main thread" for rescheduling the run loop. The VM
// runs on the main thread (a Web Worker offload is a larger follow-up), so a long synchronous run slice
// janks the page's rendering/animation. `setTimeout(tick,0)` is clamped to ~4 ms once nested, which
// forces LARGE slices to keep throughput and makes the jank worse. A MessageChannel post reschedules
// immediately AND still returns to the event loop between slices, so the browser can paint/handle input
// between short slices — smooth page, full throughput. Falls back to setTimeout where unavailable.
const _yieldChan = typeof MessageChannel !== "undefined" ? new MessageChannel() : null;
let _yieldCb = null;
if (_yieldChan) {
  _yieldChan.port1.onmessage = () => {
    const cb = _yieldCb;
    _yieldCb = null;
    if (cb) cb();
  };
  _yieldChan.port1.start?.();
}
function yieldToMain(cb) {
  // The run loop holds the single-tick invariant (`tickScheduled`), so at most one yield is ever
  // outstanding; if one somehow is, fall back to setTimeout rather than dropping the callback.
  if (_yieldChan && _yieldCb === null) {
    _yieldCb = cb;
    _yieldChan.port2.postMessage(0);
  } else {
    setTimeout(cb, 0);
  }
}

/** Gunzip `bytes` (a gzip member) to a Uint8Array via the platform DecompressionStream. */
async function gunzip(bytes) {
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

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
 *   quantum       instructions per run slice (default 500_000; see the option below)
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
    // Instructions per synchronous run slice. Kept modest so a slice is only a few ms of main-thread
    // time — short enough that the browser paints/handles input between slices (smooth page/animation).
    // Combined with the no-clamp MessageChannel yield (see yieldToMain), throughput stays high. A larger
    // value trades page responsiveness for raw guest throughput (e.g. headless benches may pass more).
    quantum = 500_000,
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
    // E4 restore-on-load artifacts (busybox: bootSnapshot only; Alpine chunked: bootSnapshot RAM +
    // overlayDelta). Hoisted so both the pre-construction overlay seed and the post-construction RAM
    // restore can see them. `alpineRamBlob` is the RAM blob to restore once the chunked machine exists.
    const bootSnap = manifest.artifacts?.bootSnapshot;
    const overlayDeltaEntry = manifest.artifacts?.overlayDelta;
    let alpineRamBlob = null;

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

    // E3-net: pick the virtio-net backend for this boot BEFORE constructing WasmLinux (which reads
    // the flags). `slirpNet` → the local stack (DHCP/ARP/ICMP); `slirpRelay` additionally attaches
    // outbound TCP/UDP through WsConnector → WebSocket → wvrelay. Set both unconditionally so a prior
    // boot's choice never leaks.
    // Defensive: both setters only update boot configuration; a stray failure can fall back to the
    // default backend rather than aborting asset loading. (A pkg missing either named export fails
    // earlier at import time, not here.)
    const network = resolveSlirpProvider(opts);
    const slirpDoh = typeof opts.slirpDoh === "string" ? opts.slirpDoh.trim() : "";
    const leaseSecs = Number(opts.slirpLeaseSecs ?? 86400);
    const slirpMtu = Number(opts.slirpMtu ?? 1500);
    try {
      setSlirpRelay(network.relayUrl);
      setSlirpRelayToken(network.relayToken);
      setSlirpTailscaleWorker(
        network.workerUrl,
        network.workerConfig,
      );
      setSlirpDohEndpoint(slirpDoh);
      setSlirpDhcpLeaseSeconds(Number.isFinite(leaseSecs) ? Math.max(1, leaseSecs) : 86400);
      setSlirpMtu(Number.isFinite(slirpMtu) ? Math.min(1500, Math.max(576, slirpMtu)) : 1500);
      setSlirpNet(!!opts.slirpNet || network.provider !== "offline" || !!slirpDoh);
    } catch { /* keep the default backend */ }

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
    // E3-T10: this tab owns the disk but storage is full → refuse guest writes (disk RO) yet keep
    // retrying the parked request's unacknowledged RAM bytes if space later becomes available.
    // Distinct from lockReadOnly precisely so the pump stays alive (critic BUG-1).
    let quotaReadOnly = false;
    // E3-T10 (critic BUG-3): the quota pause is its OWN flag so visibilitychange's resume() can't
    // resume the VM behind the dialog. It gates the pump/run independently of `paused`.
    let quotaPaused = false;
    let lastPersistRetry = 0; // throttle pending-byte retries while quotaReadOnly
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
      // E4 Alpine restore-on-load (chunked/persistent path): if this manifest ships a coherent
      // build-time boot snapshot (RAM blob) + overlay-delta (the ~1 MB of post-boot-dirtied disk
      // blocks), seed the delta into the brand-new IndexedDB overlay NOW — BEFORE constructing the
      // persistent machine — so its load_blocks() picks them up and the restored guest's cache-miss
      // disk reads return post-boot content. Then (after construction) loadSnapshotBlob restores RAM,
      // landing straight at a ready, container-capable shell instead of the ~15-min cold boot.
      //
      // Writer tabs only (a read-only tab must never write IndexedDB). seedOverlayDelta is a no-op
      // (returns false) if an overlay already exists, so a user's own durable disk is never clobbered.
      // Any failure here falls through to the normal chunked cold boot — never a broken state.
      if (!lockReadOnly && bootSnap && overlayDeltaEntry && opts.bootSnapshot !== false) {
        try {
          onState("restoring");
          const dgz = await fetchWithProgress(overlayDeltaEntry.url, (l, t) => onProgress("overlayDelta", l, t));
          if ((await sha256hex(dgz)) !== overlayDeltaEntry.sha256) throw new Error("overlay delta integrity");
          const deltaBytes = await gunzip(dgz);
          const rgz = await fetchWithProgress(bootSnap.url, (l, t) => onProgress("bootSnapshot", l, t));
          if ((await sha256hex(rgz)) !== bootSnap.sha256) throw new Error("boot snapshot integrity");
          const ramBytes = await gunzip(rgz);
          const seeded = await seedOverlayDelta(imageManifestText, deltaBytes);
          // Arm the RAM restore whether we FRESHLY seeded (first visit) OR a coherent overlay already
          // exists (return visit — the post-boot disk delta is already in it, unmodified). The gate is
          // the post-construction restoreDecisionCode below: it enforces the core-hash + base +
          // overlay-generation triple, so a MODIFIED overlay (user wrote to disk) is rejected → cold
          // boot, while an unmodified one fast-restores every load instead of cold-booting.
          void seeded;
          alpineRamBlob = ramBytes;
        } catch (e) {
          console.warn("wasm-vm: Alpine overlay-delta seed failed, cold booting:", e?.message || e);
          alpineRamBlob = null;
        }
      }
      // Async: opens IndexedDB, reconciles the base binding, loads any previously persisted blocks.
      machine = await WasmLinux.newChunkedDiskPersistent(ramMib, kernel, imageManifestText, baseUrl, cacheBudgetMib, bootProfile, bootargs, lockReadOnly, (u8) => onOutput(u8));
    } else if (isChunked) {
      machine = WasmLinux.newChunkedDisk(ramMib, kernel, imageManifestText, baseUrl, cacheBudgetMib, bootProfile, bootargs, (u8) => onOutput(u8));
    } else if (mode === "disk") {
      machine = WasmLinux.newDisk(ramMib, kernel, secondaryBytes, bootargs, (u8) => onOutput(u8));
    } else {
      machine = new WasmLinux(ramMib, kernel, secondaryBytes, bootargs, (u8) => onOutput(u8));
    }

    // E4-T29 Phase 2: arm the in-wasm browser JIT on the main-thread Linux path. The demo runs
    // WasmLinux directly (not the cpu-worker), so the JIT is dark unless enabled HERE. Gate on
    // cross-origin isolation (runtime WebAssembly codegen is only sound/allowed there) exactly like
    // web/cpu-isolation.js selectJitBackend; `?jit=0` forces interpreter-only for an A/B. The
    // interpreter stays the oracle — enableJit only arms tier-up of hot blocks.
    try {
      // `?jit=0` forces interpreter-only; `?jitThreshold=N` tunes the hotness count before a block is
      // nominated for compilation (default 32). Lower = compile more aggressively (helps cold/one-shot
      // code like V8 startup at the cost of per-block compile overhead); higher = only very hot loops.
      // The experiment behind the E4-T22 finding: node -e startup is cold code the default threshold
      // never tiers up — a low threshold is the lever to test. `opts.jitThreshold` lets the worker path
      // (where loader runs off-page and location.search is empty) pass it through bootParams too.
      const _q = new URLSearchParams(location.search);
      const _jitQ = _q.get("jit");
      const _thrRaw = opts.jitThreshold ?? _q.get("jitThreshold");
      const _threshold = Math.max(1, Number(_thrRaw) || 32);
      // OPT-IN (?jit=1) for now: default-on caused a prod OOM — the browser JIT's compiled blocks
      // hold WebAssembly.Module/Instance objects in wasm-bindgen's externref table, and without
      // browser-verified cache eviction they accumulate until "RangeError: WebAssembly" in
      // addToExternrefTable0 (DevTools "potential out-of-memory crash"). Re-enable by default once
      // the E4-T20 budget/eviction path is proven in-browser (and frees its externref entries).
      const _wantJit = _jitQ === "1" && globalThis.crossOriginIsolated === true;
      if (_wantJit && typeof machine.enableJit === "function") {
        machine.enableJit(_threshold);
        try { window.__jit = { enabled: true, threshold: _threshold }; } catch { /* worker scope */ }
        console.info("wasm-vm: browser JIT enabled (crossOriginIsolated, threshold=" + _threshold + ")");
      } else {
        try { window.__jit = { enabled: false, reason: _jitQ === "0" ? "forced-off" : (globalThis.crossOriginIsolated ? "no-enableJit" : "not-cross-origin-isolated") }; } catch { /* worker scope */ }
        console.info("wasm-vm: browser JIT NOT enabled —", _jitQ === "0" ? "forced-off (?jit=0)" : (globalThis.crossOriginIsolated ? "machine has no enableJit" : "page not cross-origin isolated"));
      }
    } catch (e) {
      console.warn("wasm-vm: enableJit gate failed:", e?.message || e);
    }

    // E4-T01/T02 browser-evidence hook (additive, default-off): expose the raw WasmLinux instance
    // so a Playwright driver can pull getProfile() after boot, and — when the page is opened with
    // `?profile=1` — arm the sampled hot-PC + subsystem-time profiler from the very first
    // instruction (setProfiling injects the JsHostTimer). Inert unless the query param is present.
    try {
      window.__machine = machine;
      const wantProfile = new URLSearchParams(location.search).get("profile");
      if (wantProfile === "1" && typeof machine.setProfiling === "function") {
        machine.setProfiling(true);
        window.__profilingArmed = true;
      }
    } catch { /* non-window scope (worker) — no test hook */ }

    // E4 restore-on-first-load (busybox/initramfs path): instead of executing the ~40 s Linux boot,
    // restore a shipped, build-time boot snapshot into the just-constructed machine and go straight to
    // the run loop. The machine already cold-booted in its constructor (place_and_boot), so ANY failure
    // here — a missing/incoherent/corrupt snapshot, a network or decompression error — simply falls
    // through to that cold-booted machine: a clean full boot, never a broken state.
    //
    // Coherence is bound, not bypassed: stampBootSnapshotIdentity binds this machine to build_core_hash
    // + the kernel/initramfs base id, and restoreDecisionCode must return "resume" before we load the
    // blob. A snapshot from an older build ("foreign_build") or a different kernel ("foreign_image") is
    // rejected → cold boot. Re-seeding is automatic: the goldfish RTC (Date.now) and virtio-rng
    // (crypto.getRandomValues) are LIVE browser-backed sources read on demand, not frozen snapshot
    // state, so wall-clock time and entropy self-reseed after restore; a fresh DHCP lease is a slirp
    // (Alpine) concern, N/A for the offline busybox default.
    let restoredFromBootSnapshot = false;
    // E4 Alpine (chunked/persistent) restore: the overlay was already seeded with the post-boot disk
    // delta BEFORE construction; now restore the paired RAM blob. The persistent machine's snapshot
    // identity is already the chunk manifest's base_hash (set in newChunkedDiskPersistent), so
    // restoreDecisionCode enforces the core-hash + base + overlay-generation triple. A foreign/stale
    // RAM blob (or a generation mismatch) is rejected → the machine keeps its fresh chunked cold boot.
    if (alpineRamBlob) {
      try {
        const decision = machine.restoreDecisionCode(alpineRamBlob, machine.overlayGeneration());
        if (decision === "resume") {
          machine.loadSnapshotBlob(alpineRamBlob);
          restoredFromBootSnapshot = true;
          onState("restored");
        } else {
          console.warn(`wasm-vm: Alpine boot snapshot not coherent (${decision}) — cold booting`);
        }
      } catch (e) {
        console.warn("wasm-vm: Alpine RAM restore failed, cold booting:", e?.message || e);
        restoredFromBootSnapshot = false;
      }
    }
    if (mode === "initramfs" && bootSnap && opts.bootSnapshot !== false) {
      try {
        const baseId = await deriveBootSnapshotBaseId(km.sha256, manifest.artifacts.initramfs.sha256);
        machine.stampBootSnapshotIdentity(baseId);
        // Repeat-load fast path: a previously cached copy in the snapshot IndexedDB store (imported
        // below on first load) restores with no network fetch at all.
        let blob = null;
        const cached = await machine.readStoredSnapshot();
        if (cached && machine.restoreDecisionCode(cached, machine.overlayGeneration()) === "resume") {
          blob = cached;
        }
        // The pure 3-way decision (unit-tested): a user snapshot would win, else a coherent boot
        // snapshot restores, else cold boot. Busybox has no user snapshot, so this selects the boot
        // snapshot whenever it is coherent.
        const wantRestore = decideBootPath({
          hasUserSnapshot: false,
          bootSnapshotAvailable: true,
          bootSnapshotDecision: blob ? "resume" : "pending",
        });
        if (!blob && wantRestore !== "user_snapshot") {
          onState("restoring");
          const gz = await fetchWithProgress(bootSnap.url, (l, t) => onProgress("bootSnapshot", l, t));
          const got = await sha256hex(gz);
          if (got !== bootSnap.sha256) {
            throw new Error(`boot snapshot integrity: expected ${bootSnap.sha256}, got ${got}`);
          }
          const bytes = await gunzip(gz);
          const decision = machine.restoreDecisionCode(bytes, machine.overlayGeneration());
          if (decision === "resume") {
            blob = bytes;
            // Cache for instant repeat loads (still coherence-guarded on the next restore).
            try { await machine.importStoredSnapshot(bytes); } catch { /* cache best-effort */ }
          } else {
            console.warn(`wasm-vm: boot snapshot not coherent (${decision}) — cold booting`);
          }
        }
        if (blob) {
          machine.loadSnapshotBlob(blob);
          restoredFromBootSnapshot = true;
          onState("restored");
        }
      } catch (e) {
        // Fall back to the cold-booted machine — never a broken state.
        console.warn("wasm-vm: boot-snapshot restore failed, cold booting:", e?.message || e);
        restoredFromBootSnapshot = false;
      }
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
      yieldToMain(tick);
    };
    // E3-T10: shared handler for a persist failure on EITHER pump site. A StorageFull is
    // RECOVERABLE — the dirty blocks stay pending (persistPending never marked them). While the
    // user is in "continue read-only" mode the unacknowledged batch retries quietly (no new writes
    // arrive, so it can only shrink) WITHOUT starving guest execution; otherwise PAUSE via the
    // quota flag and raise the dialog.
    // Returns true if the caller should stop this tick.
    const handlePersistError = async (e) => {
      if (String(e?.message || e).startsWith("StorageFull")) {
        // Expected while space is still full. Keep the unacknowledged bytes pending and run the
        // guest: its next write must reach the now-read-only backend and complete with EIO. Returning
        // true here would retry persistence before every CPU slice forever, so `dd` would remain
        // frozen instead of observing the promised error and the supposedly usable guest would hang.
        if (quotaReadOnly) return false;
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
      // E3-T08/E3-T10 durability pressure, checked BEFORE the run slice:
      //  - writeWaiting: a guest WRITE has changed the synchronous overlay but is still outside
      //    the used ring. Persist NOW so the exact descriptor can complete on the next boundary.
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
          if (!throttled && (ps.writeWaiting || ps.flushWaiting || ps.pendingBytes >= maxDirtyBytes)) {
            if (quotaReadOnly) lastPersistRetry = Date.now();
            // Credit an in-flight WVFT transfer only when the flush actually persisted guest writes:
            // the guest was frozen doing real durability, so the pause must not be charged against
            // its idle-timeout budget (E3-T21d). A no-op flush (hung guest, nothing dirty) leaves the
            // idle timer running so a truly dead transfer is still reclaimed.
            if ((await machine.persistPending()) > 0) machine.noteFileTransferPersist();
          }
        } catch (e) {
          if (await handlePersistError(e)) return;
        }
        if (stopped || paused || quotaPaused) { tickScheduled = false; return; }
      }
      let res;
      try {
        // Persistent boots also pass the dirty-byte ceiling into wasm. Wasm checks it between
        // short internal instruction slices and yields early, so a high-throughput guest write
        // cannot finish an entire command inside one 2M-instruction quantum before the IDB pump
        // gets a chance to report quota exhaustion.
        res = machine.runChunk(quantum, usePersist ? maxDirtyBytes : undefined);
      } catch (e) {
        tickScheduled = false;
        onState("error");
        onError(e);
        resolveDone("error");
        return;
      }
      if (res.done) {
        tickScheduled = false;
        // Compact guest-layer evidence for long Linux runs: surface the same architectural state
        // SHA-256 contract as native boot evidence. It is printed into the terminal so the browser
        // screenshot/transcript carries a reopenable, stale-run-detecting fingerprint.
        try {
          onOutput(new TextEncoder().encode(`\r\nstate sha256=${machine.stateDigest()}\r\n`));
        } catch { /* a terminal state is still reported even if evidence formatting fails */ }
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
      // E3-T05/E3-T21d: durably flush overlay writes to IndexedDB, but only under durability pressure
      // — a parked write/flush barrier, or the dirty-byte ceiling reached. Flushing unconditionally
      // every tick froze the guest on a fresh IndexedDB transaction each quantum, throttling a large
      // streaming write (a 100 MiB file transfer) to a crawl. Batching to the existing maxDirtyBytes
      // loss-window bound keeps the guest running between flushes; an explicit persist before tab-kill
      // still flushes everything, so reboot durability is unchanged.
      if (usePersist && !lockReadOnly) {
        try {
          const ps = machine.persistStats();
          const throttled = quotaReadOnly && Date.now() - lastPersistRetry < 3000;
          if (!throttled && (ps.writeWaiting || ps.flushWaiting || ps.pendingBytes >= maxDirtyBytes)) {
            if (quotaReadOnly) lastPersistRetry = Date.now();
            // Credit any in-flight WVFT transfer only when this flush persisted real guest writes
            // (see the pre-slice flush above) (E3-T21d).
            if ((await machine.persistPending()) > 0) machine.noteFileTransferPersist();
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
      // E4: true when this boot skipped the Linux boot by restoring a shipped boot snapshot.
      restoredFromBootSnapshot: () => restoredFromBootSnapshot,
      stateDigest: () => machine.stateDigest(),
      // E3-T15 verifier evidence: production DHCP exchanges from this exact guest boot.
      dhcpStats: () => JSON.parse(slirpDhcpStats()),
      // E3-T21c: bounded browser producer/consumer queues over the VM-private WVFT endpoint.
      fileTransferReady: (slot) => machine.fileTransferReady(slot),
      setFileDownloadReady: (ready) => machine.setFileDownloadReady(ready),
      beginFileUpload: (slot, name, total, sha256) =>
        machine.beginFileUpload(slot, name, total, sha256),
      pushFileUpload: (stream, bytes, finished = false) =>
        machine.pushFileUpload(stream, bytes, finished),
      cancelFileUpload: (stream) => machine.cancelFileUpload(stream),
      dismissFileUpload: (stream) => machine.dismissFileUpload(stream),
      cancelFileDownload: (id) => machine.cancelFileDownload(id),
      finishFileDownload: (id, success = true) => machine.finishFileDownload(id, success),
      fileTransferStatus: () => JSON.parse(machine.fileTransferStatus()),
      takeFileDownloadChunk: (id) => machine.takeFileDownloadChunk(id),
      dismissFileDownload: (id) => machine.dismissFileDownload(id),
      // E3-T02: chunked-boot instrumentation — `{ fetches, bytes, error }` (bytes transferred so
      // far via lazy chunk fetch). Null for non-chunked boots. Drives the <40%-of-image acceptance.
      fetchStats: () => (isChunked ? machine.fetchStats() : null),
      // E3-T05: force a durable flush of the overlay to IndexedDB (resolves when the txn completes).
      persist: () => (usePersist && !lockReadOnly ? machine.persistPending() : Promise.resolve(0)),
      // E3-T10 proof hook: exposes whether bytes or a guest WRITE/FLUSH acknowledgement are
      // waiting on host durability. Persistent idle state must settle to all-zero/false.
      persistStats: () => machine.persistStats(),
      // E3-T09: is this boot read-only (lock not held, OR quota forced it)?
      readOnly: () => lockReadOnly || quotaReadOnly,
      // E3-T10 quota-dialog actions ------------------------------------------------------------
      // "Free browser storage & retry": clear the quota pause and resume — the still-pending
      // writes retry on the next tick (succeed once origin storage is available, else re-dialog).
      // Deleting guest files does not shrink this block overlay until discard/TRIM exists.
      resumeAfterQuota: () => { quotaPaused = false; schedule(); },
      // "Continue read-only": refuse every future guest write and resolve the ONE parked,
      // unacknowledged WRITE with EIO. The persist pump may keep retrying its RAM-only bytes after
      // space is freed, but page close is allowed to lose those bytes because the guest never saw
      // S_OK for that descriptor. Existing durable data is intact.
      continueReadOnly: () => {
        try { machine.setDiskReadOnly(); } catch {}
        quotaReadOnly = true;
        quotaPaused = false;
        lastPersistRetry = 0;
        schedule();
      },
      // E3-T10: does the overlay hold bytes that have not reached IndexedDB? A parked WRITE means
      // these are explicitly unacknowledged to the guest.
      hasUnpersisted: () => { try { return machine.hasUnpersisted(); } catch { return false; } },
      // E3-T12d: browser resume-snapshot persistence + restore selection ------------------------
      // Take a whole-machine resume snapshot and durably persist it to the snapshot IndexedDB store.
      // Resolves when the store's commit-marker meta transaction completes. No-op off the persistent
      // path (persistSnapshot returns "not_persistent"); swallowed to a rejected Promise the caller
      // handles.
      snapshotSave: () => machine.persistSnapshot(),
      // The reassembled persisted snapshot blob (Uint8Array), or null if none / non-persistent.
      snapshotRead: () => machine.readStoredSnapshot(),
      // The header-level resume-vs-cold-boot verdict for the persisted snapshot against THIS boot's
      // build identity + base binding + current overlay generation. Reads the stored blob, then asks
      // the coherence guard. One of resume/missing/corrupt/foreign_build/foreign_image/stale.
      snapshotDecision: async () => {
        const stored = await machine.readStoredSnapshot();
        return machine.restoreDecisionCode(stored ?? null, machine.overlayGeneration());
      },
      // Advance the overlay commit generation — a durable-commit event that invalidates (→ "stale")
      // any snapshot taken before it. Returns the new generation.
      snapshotAdvanceGen: () => machine.advanceOverlayGeneration(),
      // AC3 export/import: raw stored-blob bytes out, and persist an external blob into this base's
      // snapshot store (still coherence-guarded on restore).
      snapshotExport: () => machine.readStoredSnapshot(),
      snapshotImport: (bytes) => machine.importStoredSnapshot(bytes),
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

/**
 * Resolve one outbound provider without touching Worker or WebSocket APIs. Explicit selection is
 * fail-closed: a missing provider URL is a configuration error, never an invitation to silently
 * cross-fallback. The returned Tailscale config is a structured-clone value and is never encoded
 * into a URL.
 */
export function resolveSlirpProvider(opts = {}) {
  const relayUrl = typeof opts.slirpRelay === "string" ? opts.slirpRelay.trim() : "";
  const relayToken = typeof opts.slirpRelayToken === "string" ? opts.slirpRelayToken : "";
  const tailscale = opts.slirpTailscale && typeof opts.slirpTailscale === "object"
    ? opts.slirpTailscale
    : null;
  const workerUrl = typeof tailscale?.workerUrl === "string" ? tailscale.workerUrl.trim() : "";
  const requested = typeof opts.slirpProvider === "string" ? opts.slirpProvider.trim() : "";
  const provider = requested || (workerUrl ? "tailscale" : relayUrl ? "relay" : "offline");

  if (!new Set(["tailscale", "relay", "offline"]).has(provider)) {
    throw new Error(`unknown slirp provider: ${provider}`);
  }
  if (provider === "tailscale" && !workerUrl) {
    throw new Error("tailscale provider requires slirpTailscale.workerUrl");
  }
  if (provider === "relay" && !relayUrl) {
    throw new Error("relay provider requires slirpRelay");
  }

  return {
    provider,
    relayUrl: provider === "relay" ? relayUrl : "",
    relayToken: provider === "relay" ? relayToken : "",
    workerUrl: provider === "tailscale" ? workerUrl : "",
    workerConfig: provider === "tailscale" ? (tailscale?.config ?? {}) : {},
  };
}

export function tailscaleCommand(command) {
  return slirpTailscaleCommand(command);
}
