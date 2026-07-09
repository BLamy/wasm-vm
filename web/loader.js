// E2-T21: the browser cold-start loader. Stream-fetches the boot artifacts with honest
// progress, INTEGRITY-CHECKS them against the manifest sha256 (a corrupt image must never
// boot), instantiates the WASM module, and boots unmodified Linux via `WasmLinux`, driving the
// run loop off `setTimeout` so the main thread stays responsive (workers/SAB are Epic 4).
//
// Memory discipline (32-bit wasm): each artifact lands in JS memory exactly once (a single
// preallocated `Uint8Array` sized from Content-Length), then is handed to wasm by one copy in
// the `WasmLinux` constructor. No intermediate Blob/ArrayBuffer duplication.

import init, { WasmLinux } from "./pkg/wasm_vm_wasm.js";

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
    ramMib = 256,
    onState = () => {},
    onProgress = () => {},
    onOutput = () => {},
    onError = () => {},
    quantum = 2_000_000,
  } = opts;
  const isChunked = mode === "chunked";
  // Disk/chunked modes leave bootargs empty so WasmLinux supplies `root=/dev/vda rw …`.
  const bootargs = opts.bootargs ?? (mode === "initramfs" ? "console=ttyS0 earlycon=sbi" : "");
  const role = mode === "disk" ? "rootfs" : "initramfs";
  const baseUrl = opts.baseUrl ?? imageManifestUrl.replace(/[^/]*$/, "");

  try {
    const manifest = await (await fetch(manifestUrl)).json();
    const km = manifest.artifacts.kernel;

    onState("fetching");
    // The kernel is always fetched whole (small). The rootfs is fetched whole for disk/initramfs
    // modes; in chunked mode it is NOT — only the image manifest is fetched now, and its chunks are
    // pulled lazily during boot by WasmLinux.fetchPending.
    const kernel = await fetchWithProgress(km.url, (l, t) => onProgress("kernel", l, t));
    let secondaryBytes = null;
    let imageManifestText = null;
    if (isChunked) {
      const r = await fetch(imageManifestUrl, { cache: "default" });
      if (!r.ok) throw new Error(`fetch ${imageManifestUrl} → HTTP ${r.status} ${r.statusText}`);
      imageManifestText = await r.text();
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
    // HTTP-fetches chunks under baseUrl; initramfs → the image as the initrd.
    const machine = isChunked
      ? WasmLinux.newChunkedDisk(ramMib, kernel, imageManifestText, baseUrl, bootargs, (u8) => onOutput(u8))
      : mode === "disk"
        ? WasmLinux.newDisk(ramMib, kernel, secondaryBytes, bootargs, (u8) => onOutput(u8))
        : new WasmLinux(ramMib, kernel, secondaryBytes, bootargs, (u8) => onOutput(u8));

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
      if (tickScheduled || stopped || paused) return;
      tickScheduled = true;
      setTimeout(tick, 0);
    };
    // `tick` is async so chunked mode can `await` the lazy chunk fetch between run quanta. To keep
    // the E2-T23 C3 single-tick invariant across the await, `tickScheduled` stays TRUE for the whole
    // duration of a tick (run + fetch) and is cleared only at the end — so any `schedule()` during
    // the fetch is a no-op and no second loop can start.
    const tick = async () => {
      if (stopped || paused) { tickScheduled = false; return; }
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
      whenDone,
    };
  } catch (e) {
    onState("error");
    onError(e);
    throw e;
  }
}
