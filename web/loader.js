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
import { deriveOverlaySeedIdentity } from "./overlay-seed-identity.js";
import { createTaskQuiescence } from "./task-quiescence.js";
import { validateGuestClock, createGuestClockLifecycle } from "./guest-clock.js";

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
// E3-T10: "reset disk" — delete THIS image/release's durable overlay (its own IndexedDB database),
// scoped by the manifest's base hash and optional exact warm-seed identity so a second image, the
// legacy DB, and older warm releases survive. Returns true if a database was deleted. The caller
// must ensure no tab is booted rw against it (the writer lock makes a live wipe race impossible).
export async function resetDisk(
  manifestUrl = "./releases/chunked-alpine/manifest.json",
  seedIdentity = null,
) {
  await init();
  const text = await (await fetch(manifestUrl, { cache: "no-store" })).text();
  const name = overlayDbName(text, seedIdentity);
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
    // E4-T28e: optional fully resident read-only secondary virtio-blk image. Production Alpine
    // boots leave this unset; the browser GCC proof supplies the pinned local overlay explicitly.
    extraDiskUrl = null,
    extraDiskSha256 = null,
    // E3-T05: persist the copy-on-write overlay to IndexedDB (writes survive a tab reload). Only
    // meaningful in "chunked" mode; the driver flushes via machine.persistPending() each tick.
    persist = false,
    ramMib = 256,
    onState = () => {},
    onProgress = () => {},
    onOutput = () => {},
    // E5-T26f: guest-to-host frames from the named virtio-console agent port. The callback is
    // page-owned on direct boots and copied through the whole-machine worker protocol otherwise.
    onAgentOutput = () => {},
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
    // E5-T21d: emitted once per successful guest capture PCM_START edge. The page owns the
    // permission adapter; this callback is only a lifecycle notification and never opens media.
    onCaptureStart = () => {},
    // E5-T06d: synchronous virtio-gpu FrameSink projection. The callback must copy the temporary
    // pixels view before returning; the page PresentationController owns that copy/replay policy.
    onDisplayFrame = null,
    // E5-T15c: cursor-plane callbacks share the synchronous GPU seam but are dispatched separately
    // so MOVE_CURSOR never enters the framebuffer presentation scheduler.
    onCursorState = null,
    // Instructions per synchronous run slice. Kept modest so a slice is only a few ms of main-thread
    // time — short enough that the browser paints/handles input between slices (smooth page/animation).
    // Combined with the no-clamp MessageChannel yield (see yieldToMain), throughput stays high. A larger
    // value trades page responsiveness for raw guest throughput (e.g. headless benches may pass more).
    quantum = 500_000,
    // E4-T30: the production interpreter uses the predecoded entry cache plus bounded (<=128 retire)
    // interrupt/device batching. `false` is the byte-identical legacy A/B path for diagnosis.
    fastInterpreter = true,
    // E5-T26i: explicit experiment; deterministic instruction time remains the default.
    guestClock = "icount",
    // E4-T32: policy is selected by the page and passed as data to a whole-machine worker. Undefined
    // preserves direct-loader compatibility; the page makes the production default explicit.
    jit = undefined,
    jitThreshold = undefined,
    // E4-T39: independent entry-path controls. `jitJalr=false` disables generated dynamic-return
    // probes; `jitRegion=false` returns after each compiled block while retaining JIT translation.
    jitJalr = undefined,
    jitRegion = undefined,
    // E4-T38: one explicit live-module screen per boot. `repack-off` is the current conservative
    // single-pass batcher; the cap variants change only the live batch budget.
    jitResidency = undefined,
    profile = undefined,
    // Deterministic parity/test seam: restore the machine but do not execute the first scheduler
    // slice until the owner explicitly resumes it. Production callers leave this false.
    startPaused = false,
    // Dedicated workers use timer tasks between slices so Worker "message" tasks (input/RPC/fetch
    // completions) cannot be starved by a self-perpetuating MessageChannel task source.
    workerMode = false,
    // E5-T20e: the page-owned AudioWorklet ring and render clock are transferred into the guest
    // before its first run slice. Null keeps direct-loader/headless callers on the NullSink path.
    audioSharedBuffer = null,
    audioClockBuffer = null,
    audioCapacityFrames = 0,
    audioSampleRateHz = 0,
    // E5-T21d: the reversed capture SAB is attached before the first guest run slice. It carries
    // PCM only; getUserMedia remains page-owned and is requested lazily from onCaptureStart.
    captureSharedBuffer = null,
    captureCapacityFrames = 0,
    captureSampleRateHz = 0,
    // E5-T21b: opt into the guest-visible input PCM stream at VM creation time. This flag only
    // changes device configuration; permission and host capture belong to later slices.
    enableMic = false,
  } = opts;
  let outputCalls = 0;
  let outputBytes = 0;
  const emitOutput = (bytes) => {
    outputCalls += 1;
    outputBytes += bytes?.byteLength ?? bytes?.length ?? 0;
    onOutput(bytes);
  };
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
    validateGuestClock(guestClock);
    const manifest = await fetchJsonAsset(manifestUrl, "boot manifest");
    const km = manifest.artifacts.kernel;
    // E4 restore-on-load artifacts (busybox: bootSnapshot only; Alpine chunked: bootSnapshot RAM +
    // overlayDelta). Hoisted so both the pre-construction overlay seed and the post-construction RAM
    // restore can see them. `alpineRamBlob` is fetched only after a durable user snapshot gets a
    // chance to restore, so a reload never holds both whole snapshot representations needlessly.
    const bootSnap = manifest.artifacts?.bootSnapshot;
    const overlayDeltaEntry = manifest.artifacts?.overlayDelta;
    // The exact RAM+disk pair identity is also the durable-overlay namespace. This keeps a new
    // shipped warm image independent from the legacy per-base DB (and every older snapshot), even
    // when a RAM-only release changes while its disk delta happens to remain byte-identical.
    const overlaySeedIdentity = bootSnap && overlayDeltaEntry && opts.bootSnapshot !== false
      ? await deriveOverlaySeedIdentity(bootSnap.sha256, overlayDeltaEntry.sha256)
      : null;
    let alpineRamBlob = null;
    let alpineOverlaySeeded = false;

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
      if (bootProfileUrl) {
        try {
          const pr = await fetch(bootProfileUrl, { cache: "default" });
          if (pr.ok) {
            const arr = await pr.json();
            if (Array.isArray(arr)) bootProfile = Uint32Array.from(arr.filter((n) => Number.isInteger(n) && n >= 0));
          }
        } catch { /* no profile → readahead-only */ }
      }
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
    let extraDiskBytes = null;
    if (extraDiskUrl) {
      extraDiskBytes = await fetchWithProgress(extraDiskUrl, (l, t) => onProgress("extraDisk", l, t));
      if (extraDiskSha256) {
        const got = await sha256hex(extraDiskBytes);
        if (got !== extraDiskSha256) {
          throw new Error(
            `integrity check failed for extra disk: expected ${extraDiskSha256}, got ${got}`,
          );
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

    // disk → in-memory virtio-blk backend (whole image); chunked → a ChunkedBackend that lazily
    // HTTP-fetches chunks under baseUrl (+ E3-T05 persist: writes survive reload via IndexedDB);
    // initramfs → the image as the initrd.
    const usePersist = isChunked && persist;
    // A persistent boot may resume a whole-machine snapshot immediately after the machine is
    // constructed. Do not label that path as a fresh guest boot; the state is emitted below only
    // after the stored/build-time resume candidates have been rejected. This makes the browser
    // evidence distinguish construction of the host wrapper from Linux actually executing its
    // cold probe sequence.
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
      // E3-T09 (critic BUG-3): derive the lock from the exact active IndexedDB name, not the URL or
      // raw manifest text. Two semantically identical manifests may have different whitespace/key
      // order but the same base binding and DB, so only this makes lock ownership exactly match.
      const lockName = `wasm-vm-disk-${overlayDbName(imageManifestText, overlaySeedIdentity)}`;
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
      // Writer tabs only (a read-only tab must never write IndexedDB). The exact release namespace
      // normally starts fresh; repeated visits reuse it only when valid meta + the complete block set
      // byte-match the shipped delta. User changes in that namespace return false without writes and
      // force a coherent cold boot. Legacy and older-release DBs are never opened here.
      if (!lockReadOnly && bootSnap && overlayDeltaEntry && opts.bootSnapshot !== false) {
        try {
          onState("restoring");
          const dgz = await fetchWithProgress(overlayDeltaEntry.url, (l, t) => onProgress("overlayDelta", l, t));
          if ((await sha256hex(dgz)) !== overlayDeltaEntry.sha256) throw new Error("overlay delta integrity");
          const deltaBytes = await gunzip(dgz);
          const seeded = await seedOverlayDelta(imageManifestText, deltaBytes, overlaySeedIdentity);
          // Arm the shipped RAM fallback only after the persistent machine has had a chance to
          // restore a user snapshot directly from IndexedDB. The post-construction coherence guard
          // remains independent of this disk-equality check.
          alpineOverlaySeeded = seeded;
          if (!seeded) {
            console.warn(
              "wasm-vm: active warm-release disk has user changes; preserving it and cold booting",
            );
            onState("booting");
          }
        } catch (e) {
          console.warn("wasm-vm: Alpine overlay-delta seed failed, cold booting:", e?.message || e);
          alpineOverlaySeeded = false;
          alpineRamBlob = null;
          onState("booting");
        }
      }
      // Async: opens IndexedDB, reconciles the base binding, loads any previously persisted blocks.
      machine = await WasmLinux.newChunkedDiskPersistent(ramMib, kernel, imageManifestText, baseUrl, cacheBudgetMib, bootProfile, bootargs, lockReadOnly, emitOutput, overlaySeedIdentity, enableMic);
    } else if (isChunked) {
      if (extraDiskBytes) {
        if (typeof WasmLinux.newChunkedDiskWithExtra !== "function") {
          throw new Error("browser wasm build lacks E4-T28e secondary-drive support");
        }
        machine = WasmLinux.newChunkedDiskWithExtra(
          ramMib,
          kernel,
          imageManifestText,
          baseUrl,
          cacheBudgetMib,
          bootProfile,
          extraDiskBytes,
          bootargs,
          emitOutput,
          enableMic,
        );
      } else {
        machine = WasmLinux.newChunkedDisk(ramMib, kernel, imageManifestText, baseUrl, cacheBudgetMib, bootProfile, bootargs, emitOutput, enableMic);
      }
    } else if (mode === "disk") {
      machine = WasmLinux.newDisk(ramMib, kernel, secondaryBytes, bootargs, emitOutput, enableMic);
    } else {
      machine = new WasmLinux(ramMib, kernel, secondaryBytes, bootargs, emitOutput, enableMic);
    }

    // E5-T06d: attach the page-owned display sink only after the complete machine exists. This
    // leaves the core's headless NullSink as the safe constructor default and keeps the same
    // callback seam available to direct and whole-machine-worker boot paths.
    if ((typeof onDisplayFrame === "function" || typeof onCursorState === "function")
        && typeof machine.attachDisplay === "function") {
      // Older/custom device layouts may have consumed both optional virtio slots. The display is
      // an enhancement in that case; preserve boot and the guest queue instead of turning an
      // unavailable optional sink into a machine-fatal attach error.
      machine.attachDisplay((frame) => {
        const type = frame?.type;
        if (type === "cursor-update" || type === "cursor-move") {
          onCursorState?.(frame);
        } else {
          onDisplayFrame?.(frame);
        }
      });
    }

    // E5-T20e: swap the assembly's default NullSink for the page-owned AudioWorklet producer only
    // after the machine exists. This works identically on the main thread and in the whole-machine
    // worker because SharedArrayBuffers survive structured cloning without a page callback.
    const audioRequested = audioSharedBuffer !== null
      || audioClockBuffer !== null
      || audioCapacityFrames > 0
      || audioSampleRateHz > 0;
    if (audioRequested) {
      if (audioSharedBuffer === null || audioClockBuffer === null
        || audioCapacityFrames < 1 || audioSampleRateHz < 1
        || typeof machine.attachAudioOutput !== "function") {
        throw new Error("browser wasm build lacks a complete audio output bridge");
      }
      machine.attachAudioOutput(
        audioSharedBuffer,
        audioClockBuffer,
        audioCapacityFrames,
        audioSampleRateHz,
      );
    }
    const captureRequested = captureSharedBuffer !== null
      || captureCapacityFrames > 0
      || captureSampleRateHz > 0;
    if (captureRequested) {
      if (captureSharedBuffer === null || captureCapacityFrames < 1
        || captureSampleRateHz < 1
        || typeof machine.attachAudioCapture !== "function") {
        throw new Error("browser wasm build lacks a complete audio capture bridge");
      }
      machine.attachAudioCapture(
        captureSharedBuffer,
        captureCapacityFrames,
        captureSampleRateHz,
      );
    }

    // E4-T30: remove the old browser default that left the proven 2.24x block-boundary batching win
    // dark. This call is deliberately before enableJit: cold/untranslatable code keeps using the fast
    // interpreter, while `fastInterpreter=false` remains an explicit legacy differential path.
    if (typeof machine.setFastInterpreter === "function") {
      machine.setFastInterpreter(Boolean(fastInterpreter));
    }
    try {
      window.__interpreter = {
        fast: Boolean(fastInterpreter),
        blockCache: Boolean(fastInterpreter),
        interruptBatching: Boolean(fastInterpreter),
      };
    } catch { /* worker scope */ }
    try {
      document.documentElement.dataset.interpreter = fastInterpreter ? "fast" : "legacy";
    } catch { /* worker scope */ }

    // E4-T29 Phase 2: arm the in-wasm browser JIT on the main-thread Linux path. The demo runs
    // WasmLinux directly (not the cpu-worker), so the JIT is dark unless enabled HERE. Gate on
    // cross-origin isolation (runtime WebAssembly codegen is only sound/allowed there) exactly like
    // web/cpu-isolation.js selectJitBackend; `?jit=0` forces interpreter-only for an A/B. The
    // interpreter stays the oracle for fallback and differential checks — enableJit only arms
    // tier-up of hot blocks.
    try {
      // `?jit=0` forces interpreter-only; `?jitThreshold=N` tunes the hotness count before a block is
      // nominated for compilation (default 512). Lower = compile more aggressively at the cost of
      // synchronous compilation stalls; measured cold Node startup regressed at thresholds 32..256.
      // `opts.jitThreshold` lets the worker path (where loader runs off-page and location.search is
      // empty) receive the page-selected policy through bootParams.
      const _q = new URLSearchParams(location.search);
      const _jitQ = jit ?? (_q.get("jit") === "1" ? true : _q.get("jit") === "0" ? false : undefined);
      const _thrRaw = jitThreshold ?? _q.get("jitThreshold");
      const _threshold = Math.max(1, Number(_thrRaw) || 512);
      const _residency = jitResidency ?? _q.get("jitResidency") ?? "repack-off";
      const _jalrQ = jitJalr ?? (_q.get("jalr") === "1" ? true : _q.get("jalr") === "0" ? false : undefined);
      const _regionQ = jitRegion ?? (_q.get("region") === "1" ? true : _q.get("region") === "0" ? false : undefined);
      const _jalr = _jalrQ ?? true;
      const _region = _regionQ ?? true;
      // E4-T33 proved bounded browser handles and repaired the bulk handoff. The restored-Node screen
      // is faster with JIT at the shipping threshold, so isolated browser workers opt in by default;
      // `?jit=0` remains the explicit interpreter rollback/A-B.
      const _wantJit = (_jitQ ?? true) && globalThis.crossOriginIsolated === true;
      if (_wantJit && typeof machine.enableJit === "function") {
        if (typeof machine.enableJitWithPolicy === "function") {
          machine.enableJitWithPolicy(_threshold, _residency);
        } else {
          machine.enableJit(_threshold);
        }
        if (typeof machine.setDynamicChaining === "function") {
          machine.setDynamicChaining(_jalr);
        }
        if (typeof machine.setChaining === "function") {
          machine.setChaining(_region);
        }
        try {
          window.__jit = {
            enabled: true,
            threshold: _threshold,
            residency: _residency,
            jalr: _jalr,
            region: _region,
          };
        } catch { /* worker scope */ }
        console.info(
          "wasm-vm: browser JIT enabled (crossOriginIsolated, threshold=" + _threshold +
          ", residency=" + _residency + ", jalr=" + _jalr + ", region=" + _region + ")",
        );
      } else {
        const reason = _jitQ === false ? "forced-off" : (globalThis.crossOriginIsolated ? "no-enableJit" : "not-cross-origin-isolated");
        try {
          window.__jit = { enabled: false, reason, jalr: _jalr, region: _region };
        } catch { /* worker scope */ }
        console.info("wasm-vm: browser JIT NOT enabled —", reason);
      }
    } catch (e) {
      console.warn("wasm-vm: enableJit gate failed:", e?.message || e);
    }

    // E4-T01/T02 browser-evidence hook (additive, default-off): expose the raw WasmLinux instance
    // so a Playwright driver can pull getProfile() after boot, and — when the page is opened with
    // `?profile=1` — arm the sampled hot-PC + subsystem-time profiler from the very first
    // instruction (setProfiling injects the JsHostTimer). Inert unless the query param is present.
    const wantProfile = profile ?? (new URLSearchParams(location.search).get("profile") === "1");
    if (wantProfile && typeof machine.setProfiling === "function") {
      machine.setProfiling(true);
      globalThis.__profilingArmed = true;
    }
    try { window.__machine = machine; } catch { /* worker scope: profiling is still armed above */ }

    // E3-T12d persistent snapshot restore: load the durable user snapshot directly inside wasm before
    // considering the shipped build-time RAM snapshot. `restoreStoredSnapshot` keeps the large blob
    // out of JS; a missing, stale, corrupt, or foreign result leaves the freshly constructed machine
    // untouched and the normal fallback paths below decide what to do.
    let restoredFromStoredSnapshot = false;
    if (usePersist && typeof machine.restoreStoredSnapshot === "function") {
      try {
        const decision = await machine.restoreStoredSnapshot();
        if (decision === "resume") {
          restoredFromStoredSnapshot = true;
          onState("restored");
        } else if (decision !== "missing") {
          console.warn(`wasm-vm: stored snapshot not coherent (${decision}) — cold booting`);
        }
      } catch (e) {
        // A storage read failure is a cold-boot fallback, never a partially restored machine.
        console.warn("wasm-vm: stored snapshot restore failed, cold booting:", e?.message || e);
      }
    }

    // The shipped Alpine RAM image is only a fallback for a fresh/equal warm overlay. Fetch it after
    // the durable user snapshot attempt so a normal reload does not retain two whole snapshots while
    // the bounded IndexedDB loader is assembling its one Rust buffer.
    if (!restoredFromStoredSnapshot && alpineOverlaySeeded && bootSnap && opts.bootSnapshot !== false) {
      try {
        onState("restoring");
        const rgz = await fetchWithProgress(bootSnap.url, (l, t) => onProgress("bootSnapshot", l, t));
        if ((await sha256hex(rgz)) !== bootSnap.sha256) throw new Error("boot snapshot integrity");
        alpineRamBlob = await gunzip(rgz);
      } catch (e) {
        console.warn("wasm-vm: Alpine RAM fallback fetch failed, cold booting:", e?.message || e);
        alpineRamBlob = null;
        onState("booting");
      }
    }

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
    let restoredFromBootSnapshot = restoredFromStoredSnapshot;
    // E4 Alpine (chunked/persistent) restore: the overlay was already seeded with the post-boot disk
    // delta BEFORE construction; now restore the paired RAM blob. The persistent machine's snapshot
    // identity is already the chunk manifest's base_hash (set in newChunkedDiskPersistent), so
    // restoreDecisionCode enforces the core-hash + base + overlay-generation triple. A foreign/stale
    // RAM blob (or a generation mismatch) is rejected → the machine keeps its fresh chunked cold boot.
    if (!restoredFromStoredSnapshot && alpineRamBlob) {
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

    const guestClockLifecycle = createGuestClockLifecycle(machine, guestClock);

    // No resume candidate was coherent, so this machine is about to execute its cold guest boot.
    // Persistent resume success intentionally reaches the scheduler without a booting state.
    if (!restoredFromBootSnapshot) onState("booting");

    let stopped = false;
    let paused = Boolean(startPaused);
    let observedCaptureStartCount = 0;
    const observeCaptureStart = () => {
      if (typeof machine.virtioSndCaptureState !== "function") return;
      let snapshot;
      try { snapshot = machine.virtioSndCaptureState(); } catch { return; }
      if (!snapshot || snapshot.enabled !== true) return;
      const startCount = Number(snapshot.startCount);
      if (!Number.isSafeInteger(startCount) || startCount <= observedCaptureStartCount) return;
      observedCaptureStartCount = startCount;
      try { onCaptureStart({ ...snapshot }); } catch (error) { onError(error); }
    };
    // E4-T32: a worker is still one JS event loop. A 20M-instruction slice made every input/RPC and
    // output flush wait behind seconds of synchronous runChunk work. Keep the page-selected slice at
    // <=500k. Do not shrink from one slow JIT compilation: that work is not proportional to the retire
    // budget, and an earlier adaptive attempt collapsed to 1k + the timer clamp (starving throughput).
    const maxQuantum = Math.max(1_000, Math.min(500_000, Number(quantum) || 500_000));
    let runQuantum = maxQuantum;
    let sliceCount = 0;
    let sliceTotalMs = 0;
    let sliceMaxMs = 0;
    const sliceBoundsMs = [4, 8, 16, 32, 64, 128, 256, 512, 1_000, Infinity];
    const sliceHistogram = sliceBoundsMs.map(() => 0);
    let stretchMaxMs = 0;
    let lastSliceStart = 0;
    let requestedInstructions = 0;
    let retiredInstructions = 0;
    let fetchWaits = 0;
    let fetchRequestedChunks = 0;
    let fetchWaitTotalMs = 0;
    let fetchWaitMaxMs = 0;
    let inputCalls = 0;
    let inputBytes = 0;
    let schedulerYields = 0;
    let timerYields = 0;
    let mainThreadYields = 0;
    const workerPostTask = workerMode && typeof globalThis.scheduler?.postTask === "function"
      ? globalThis.scheduler.postTask.bind(globalThis.scheduler)
      : null;
    // Exactly one `tick` may be pending at a time. `resume()` guarding only on `paused` is not
    // enough: a rapid pause→resume while a tick is already pending would schedule a SECOND chain,
    // and both would then self-perpetuate (two concurrent loops, double CPU). This flag makes
    // scheduling idempotent so there is always at most one pending tick. (E2-T23 critic C3.)
    let tickScheduled = false;
    let resolveDone;
    const whenDone = new Promise((r) => (resolveDone = r));
    let doneSettled = false;
    let pendingFinishState = null;
    let taskQuiescence;
    const settleFinished = () => {
      if (doneSettled || pendingFinishState == null || taskQuiescence?.isActive()) return;
      doneSettled = true;
      resolveDone(pendingFinishState);
    };
    const finish = (state) => {
      if (doneSettled || pendingFinishState != null) return;
      pendingFinishState = state;
      stopped = true;
      tickScheduled = false;
      settleFinished();
    };
    const schedule = () => {
      if (tickScheduled || stopped || paused || quotaPaused) return;
      tickScheduled = true;
      if (workerPostTask) {
        // Scheduler tasks avoid the recursive-timer 4–5ms clamp. Ordering against Worker messages
        // is implementation-defined, so browser gates measure input/RPC latency under load instead
        // of treating this scheduling primitive as a fairness guarantee.
        schedulerYields += 1;
        void workerPostTask(tick, { priority: "user-visible" }).catch((error) => {
          tickScheduled = false;
          onState("error");
          onError(error);
          finish("error");
        });
      } else if (workerMode) {
        timerYields += 1;
        setTimeout(tick, 0);
      } else {
        mainThreadYields += 1;
        yieldToMain(tick);
      }
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
      onState("error");
      onError(e);
      finish("error");
      return true;
    };
    // `tick` is async so chunked mode can `await` the lazy chunk fetch between run quanta. To keep
    // the E2-T23 C3 single-tick invariant across the await, `tickScheduled` stays TRUE for the whole
    // duration of a tick (run + fetch) and is cleared only at the end — so any `schedule()` during
    // the fetch is a no-op and no second loop can start.
    const runTick = async () => {
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
        const sliceStart = typeof performance !== "undefined" ? performance.now() : Date.now();
        if (lastSliceStart) stretchMaxMs = Math.max(stretchMaxMs, sliceStart - lastSliceStart);
        lastSliceStart = sliceStart;
        res = machine.runChunk(runQuantum, usePersist ? maxDirtyBytes : undefined);
        if (typeof machine.takeAgentOutput === "function") {
          const agentBytes = machine.takeAgentOutput();
          if (agentBytes?.byteLength) onAgentOutput(agentBytes);
        }
        observeCaptureStart();
        const sliceMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - sliceStart;
        sliceCount += 1;
        sliceTotalMs += sliceMs;
        sliceMaxMs = Math.max(sliceMaxMs, sliceMs);
        requestedInstructions += runQuantum;
        retiredInstructions += Number(res.retired) || 0;
        const bucket = sliceBoundsMs.findIndex((bound) => sliceMs <= bound);
        sliceHistogram[bucket < 0 ? sliceHistogram.length - 1 : bucket] += 1;
      } catch (e) {
        onState("error");
        onError(e);
        finish("error");
        return;
      }
      if (res.done) {
        // Compact guest-layer evidence for long Linux runs: surface the same architectural state
        // SHA-256 contract as native boot evidence. It is printed into the terminal so the browser
        // screenshot/transcript carries a reopenable, stale-run-detecting fingerprint.
        if (!workerMode) {
          try {
            emitOutput(new TextEncoder().encode(`\r\nstate sha256=${machine.stateDigest()}\r\n`));
          } catch { /* a terminal state is still reported even if evidence formatting fails */ }
        }
        onState("done");
        finish(res.state);
        return;
      }
      // E3-T02 chunked boot: a guest disk read may have parked awaiting a chunk. Fetch every parked
      // chunk (hash-verified in wasm) before the next quantum, or the parked reads never complete.
      if (isChunked) {
        try {
          const pending = machine.pendingChunks();
          if (pending.length > 0) {
            const fetchStart = typeof performance !== "undefined" ? performance.now() : Date.now();
            fetchWaits += 1;
            fetchRequestedChunks += pending.length;
            await machine.fetchPending();
            // A permanent demand-chunk failure is recorded by the wasm fetch layer while the
            // parked guest read remains pending. Stop the controller at that boundary instead of
            // re-running the same failed read forever (and leaving callers with an apparently
            // healthy Alpine boot whose runtime probe can never become true).
            const fetchStats = machine.fetchStats?.();
            if (fetchStats?.error) {
              throw new Error(`lazy chunk fetch failed: ${fetchStats.error}`);
            }
            const fetchMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - fetchStart;
            fetchWaitTotalMs += fetchMs;
            fetchWaitMaxMs = Math.max(fetchWaitMaxMs, fetchMs);
          }
        } catch (e) {
          onState("error");
          onError(e);
          finish("error");
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
    // `stop()` is a storage quiescence barrier, not merely a scheduler flag. A tick can be awaiting
    // lazy fetch or IndexedDB persistence after its synchronous runChunk. Keep that exact Promise
    // and settle whenDone only from the idle edge, after the pump has returned completely.
    taskQuiescence = createTaskQuiescence(settleFinished);
    const tick = () => taskQuiescence.run(runTick);
    schedule();

    return {
      backend: "main-thread",
      // Host hotplug is separate from guest mode adoption; stats come from the actual GPU map.
      setDisplay: (width, height) => !stopped && machine.setDisplay(width, height),
      displayStats: () => stopped ? null : machine.displayStats(),
      sendInput: (bytes) => {
        if (!stopped) {
          inputCalls += 1;
          inputBytes += bytes?.byteLength ?? bytes?.length ?? 0;
          machine.sendInput(bytes);
        }
      },
      // E5-T26f: the T23d page Channel writes framed bytes through the named virtio-console port.
      sendAgentInput: (bytes) => {
        if (stopped || typeof machine.sendAgentInput !== "function") return 0;
        return machine.sendAgentInput(bytes);
      },
      // E5-T12b: the DOM keyboard bridge publishes physical evdev frames through the same
      // controller on both the direct and whole-machine-worker paths. Worker RPC ordering keeps
      // sendKeyboardEvent immediately ahead of its matching syncKeyboard frame.
      sendKeyboardEvent: (eventType, code, value) => {
        if (stopped) return false;
        machine.sendKeyboardEvent(eventType, code, value);
        return true;
      },
      syncKeyboard: () => {
        if (stopped) return false;
        machine.syncKeyboard();
        return true;
      },
      // E5-T14b: the DOM pointer bridge keeps tablet and mouse frames on separate controller
      // methods, preserving T14a's independent slot/queue contract in both boot backends.
      sendTabletEvent: (eventType, code, value) => {
        if (stopped) return false;
        machine.sendTabletEvent(eventType, code, value);
        return true;
      },
      syncTablet: () => {
        if (stopped) return false;
        machine.syncTablet();
        return true;
      },
      sendMouseEvent: (eventType, code, value) => {
        if (stopped) return false;
        machine.sendMouseEvent(eventType, code, value);
        return true;
      },
      syncMouse: () => {
        if (stopped) return false;
        machine.syncMouse();
        return true;
      },
      // E5-T13c: expose the guest's host-owned LED feedback so the page can reconcile lock keys
      // after focus recovery without reading or mutating guest state through an ad-hoc path.
      keyboardLedState: () => (
        typeof machine.keyboardLedState === "function" ? machine.keyboardLedState() : null
      ),
      stop: async () => {
        finish("stopped");
        await taskQuiescence.stop();
        settleFinished();
        return whenDone;
      },
      // Explicit execution pauses freeze both clock modes. Wall mode resets its host anchor
      // before rescheduling; unpaused background throttling retains the core gap/slew policy.
      // The RTC remains separate. main.js's explicit visibility pause still freezes execution;
      // the desktop worker route does not pause on visibility changes.
      pause: () => { paused = true; },
      resume: () => {
        if (paused && !stopped) {
          guestClockLifecycle.resume();
          paused = false;
          schedule(); // idempotent — never spawns a second loop even if a tick is still pending
        }
      },
      isPaused: () => paused,
      guestClockState: () => guestClockLifecycle.state(),
      // E4: true when this boot skipped the Linux boot by restoring a shipped boot snapshot.
      restoredFromBootSnapshot: () => restoredFromBootSnapshot,
      overlaySeedIdentity: () => overlaySeedIdentity,
      audioOutputReady: () => (
        typeof machine.audioOutputReady === "function" ? machine.audioOutputReady() : false
      ),
      audioCaptureReady: () => (
        typeof machine.audioCaptureReady === "function" ? machine.audioCaptureReady() : false
      ),
      captureState: () => (
        typeof machine.virtioSndCaptureState === "function"
          ? machine.virtioSndCaptureState()
          : null
      ),
      notifyCaptureEvent: (event) => (
        typeof machine.notifyCaptureEvent === "function"
          ? machine.notifyCaptureEvent(event)
          : false
      ),
      stateDigest: () => machine.stateDigest(),
      // E5-T26e: the page-side T23d Channel calls confirmAgentHello only after a fresh peer HELLO;
      // the wasm seam then arms the core's application-generation fence for one restore attempt.
      confirmAgentHello: () => {
        if (typeof machine.confirmAgentHello !== "function") return false;
        return machine.confirmAgentHello();
      },
      // E5-T26f: serialize the live composite desktop envelope through the same controller
      // surface used by the page in both direct and whole-machine-worker boot modes.
      saveDesktopSnapshot: () => {
        if (typeof machine.saveDesktopSnapshot !== "function") {
          throw new Error("desktop snapshot save is unavailable in this wasm build");
        }
        return machine.saveDesktopSnapshot();
      },
      // E5-T26e: restore the actual composite envelope through the production Machine boundary.
      // The browser bridge applies the returned hostViewport through T22's PresentationController.
      restoreDesktopSnapshot: (bytes, width, height) => {
        if (typeof machine.restoreDesktopSnapshot !== "function") {
          throw new Error("desktop restore is unavailable in this wasm build");
        }
        return machine.restoreDesktopSnapshot(bytes, width, height);
      },
      jitStats: () => (typeof machine.jitStats === "function" ? machine.jitStats() : null),
      profileStats: () => (typeof machine.getProfile === "function" ? machine.getProfile() : null),
      schedulerStats: () => ({
        quantum: runQuantum,
        maxQuantum,
        slices: sliceCount,
        totalSliceMs: sliceTotalMs,
        averageSliceMs: sliceCount ? sliceTotalMs / sliceCount : 0,
        maxSliceMs: sliceMaxMs,
        sliceHistogram: sliceBoundsMs.map((bound, index) => ({
          leMs: Number.isFinite(bound) ? bound : null,
          count: sliceHistogram[index],
        })),
        maxStretchGapMs: stretchMaxMs,
        requestedInstructions,
        retiredInstructions,
        fetchWaits,
        fetchRequestedChunks,
        fetchWaitTotalMs,
        fetchWaitMaxMs,
        outputCalls,
        outputBytes,
        inputCalls,
        inputBytes,
        yieldMode: workerPostTask ? "scheduler.postTask" : workerMode ? "timer" : "message-channel",
        schedulerYields,
        timerYields,
        mainThreadYields,
      }),
      tailscaleCommand: (command) => slirpTailscaleCommand(command),
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
      resumeAfterQuota: () => {
        if (quotaPaused && !stopped) guestClockLifecycle.resume();
        quotaPaused = false;
        schedule();
      },
      // "Continue read-only": refuse every future guest write and resolve the ONE parked,
      // unacknowledged WRITE with EIO. The persist pump may keep retrying its RAM-only bytes after
      // space is freed, but page close is allowed to lose those bytes because the guest never saw
      // S_OK for that descriptor. Existing durable data is intact.
      continueReadOnly: () => {
        if (quotaPaused && !stopped) guestClockLifecycle.resume();
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
      snapshotSave: () => {
        if (lockReadOnly) return Promise.reject(new Error("read_only"));
        return machine.persistSnapshot();
      },
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
      // Current durable-overlay generation reconstructed by the persistent boot. This is a test
      // and evidence hook so a reload-after-write can distinguish persisted advancement from the
      // in-memory-only advance hook above.
      snapshotGeneration: () => machine.overlayGeneration(),
      // AC3 export/import: raw stored-blob bytes out, and persist an external blob into this base's
      // snapshot store (still coherence-guarded on restore).
      snapshotExport: () => machine.readStoredSnapshot(),
      snapshotRestore: () => {
        if (!usePersist || typeof machine.restoreStoredSnapshot !== "function") return Promise.resolve("missing");
        return machine.restoreStoredSnapshot();
      },
      snapshotImport: (bytes) => {
        if (lockReadOnly) return Promise.reject(new Error("read_only"));
        return machine.importStoredSnapshot(bytes);
      },
      // Current {usage, quota} for the storage indicator.
      storageEstimate: () => (navigator.storage?.estimate ? navigator.storage.estimate() : Promise.resolve({})),
      // E3-T10 (critic BUG-4): close the IndexedDB connection so reset-disk's deleteDatabase can
      // actually delete (our open handle would otherwise block it forever). Call before wiping.
      closeStorage: () => { try { machine.closeStorage(); } catch {} },
      // E3-T09: explicitly release the writer lock (poweroff/stop paths; close/crash releases
      // it automatically via Web Locks semantics). The wasm barrier fences new writes immediately,
      // then waits for any snapshot operation that already passed its ownership check before the
      // Web Lock promise is resolved.
      releaseWriterLock: async () => {
        // The controller can outlive the Web Lock promise. Fence both JS and wasm before releasing
        // the lock so a stale controller cannot save/import into the namespace after a new tab owns
        // it. This is one-way: reacquiring requires constructing a new machine.
        lockReadOnly = true;
        try { await machine.relinquishSnapshotWriter?.(); } catch {}
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
  // `websocket` is the ordinary browser transport. `tailscale` is the official public
  // Tailscale control plane + DERP path when controlUrl is blank. `headscale` is the same
  // Tailscale client pointed at a private Headscale control plane. `relay` is retained as an
  // explicit private/self-hosted wvrelay compatibility path; it is not a Headscale network.
  const aliases = {
    "public-relay": "tailscale",
    "tailscale-public": "tailscale",
    "headscale-private": "headscale",
    "private-tailscale": "headscale",
    "private-relay": "headscale",
    "private-wvrelay": "relay",
  };
  const normalizedRequested = aliases[requested] ?? requested;
  const provider = normalizedRequested || (
    workerUrl ? "tailscale" : relayUrl ? (typeof opts.slirpWebsocket === "string" ? "websocket" : "relay") : "offline"
  );

  if (!new Set(["tailscale", "headscale", "relay", "websocket", "offline"]).has(provider)) {
    throw new Error(`unknown slirp provider: ${provider}`);
  }
  if ((provider === "tailscale" || provider === "headscale") && !workerUrl) {
    throw new Error(`${provider} provider requires slirpTailscale.workerUrl`);
  }
  if (provider === "headscale" && !String(tailscale?.config?.controlUrl ?? "").trim()) {
    throw new Error("headscale provider requires slirpTailscale.config.controlUrl");
  }
  if (provider === "tailscale" && String(tailscale?.config?.controlUrl ?? "").trim()) {
    throw new Error("tailscale public provider requires a blank controlUrl; choose headscale for a private control plane");
  }
  if ((provider === "relay" || provider === "websocket") && !relayUrl) {
    throw new Error(`${provider} provider requires slirpRelay`);
  }

  return {
    provider,
    relayUrl: provider === "relay" || provider === "websocket" ? relayUrl : "",
    relayToken: provider === "relay" || provider === "websocket" ? relayToken : "",
    workerUrl: provider === "tailscale" || provider === "headscale" ? workerUrl : "",
    workerConfig: provider === "tailscale" || provider === "headscale" ? (tailscale?.config ?? {}) : {},
  };
}

export function tailscaleCommand(command) {
  return slirpTailscaleCommand(command);
}
