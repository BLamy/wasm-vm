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
    ramMib = 256,
    bootargs = "console=ttyS0 earlycon=sbi",
    onState = () => {},
    onProgress = () => {},
    onOutput = () => {},
    onError = () => {},
    quantum = 2_000_000,
  } = opts;

  try {
    const manifest = await (await fetch(manifestUrl)).json();
    const { kernel: km, initramfs: im } = manifest.artifacts;

    onState("fetching");
    const [kernel, initramfs] = await Promise.all([
      fetchWithProgress(km.url, (l, t) => onProgress("kernel", l, t)),
      fetchWithProgress(im.url, (l, t) => onProgress("initramfs", l, t)),
    ]);

    onState("verifying");
    for (const [name, bytes, want] of [
      ["kernel", kernel, km.sha256],
      ["initramfs", initramfs, im.sha256],
    ]) {
      const got = await sha256hex(bytes);
      if (got !== want) {
        throw new Error(`integrity check failed for ${name}: expected ${want}, got ${got} — refusing to boot corrupt bytes`);
      }
    }

    onState("instantiating");
    await init(); // WebAssembly.instantiateStreaming under the hood (wasm-pack --target web)

    onState("booting");
    const machine = new WasmLinux(ramMib, kernel, initramfs, bootargs, (u8) => onOutput(u8));

    let stopped = false;
    let paused = false;
    let resolveDone;
    const whenDone = new Promise((r) => (resolveDone = r));
    const tick = () => {
      if (stopped || paused) return;
      let res;
      try {
        res = machine.runChunk(quantum);
      } catch (e) {
        onState("error");
        onError(e);
        resolveDone("error");
        return;
      }
      if (res.done) {
        onState("done");
        resolveDone(res.state);
        return;
      }
      // Yield to the event loop so the page stays responsive (no main-thread freeze).
      setTimeout(tick, 0);
    };
    setTimeout(tick, 0);

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
          setTimeout(tick, 0);
        }
      },
      isPaused: () => paused,
      whenDone,
    };
  } catch (e) {
    onState("error");
    onError(e);
    throw e;
  }
}
