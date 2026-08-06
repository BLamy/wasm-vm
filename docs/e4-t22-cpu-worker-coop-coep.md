# E4-T22 — CPU worker on SharedArrayBuffer: build, isolation & deployment

The CPU dispatch loop (interpreter, and later the E4-T10 JIT) runs on a dedicated Web Worker
against a shared `WebAssembly.Memory` that backs guest RAM + CpuState + TLBs. The main thread keeps
DOM / xterm.js / devices. This document is the deployment + build story: the two build variants, the
cross-origin-isolation requirement, and how to satisfy it on every host class including header-less
static hosts (GitHub Pages).

## Two build variants

| Variant | Toolchain | Memory | Built by | Used when |
|---|---|---|---|---|
| **Shared (threaded)** | nightly + `build-std` | imported, `shared` | `tools/build-web-shared.sh` → `crates/wasm/pkg-shared` | `crossOriginIsolated === true` |
| **Fallback (single-thread)** | pinned stable (`make wasm`) | internal, non-shared | `wasm-pack build crates/wasm` → `web/pkg` | not isolated / no SAB / no Worker |

### Why nightly for the shared build

Shared memory requires the module to be compiled with `+atomics,+bulk-memory,+mutable-globals` and
linked with `--shared-memory --import-memory`. Atomics on `wasm32-unknown-unknown` are still
unstable, so `std` must be recompiled with the same target-features via `-Z build-std`, which needs
nightly + the `rust-src` component. The **fallback** stays on the pinned stable toolchain. Only the
threaded variant touches nightly; the emulator core is unchanged.

Verify the emitted memory import:

```
$ wasm-objdump -x -j Import target/wasm32-unknown-unknown/release/wasm_vm_wasm.wasm | grep memory
 - memory[0] pages: initial=19 max=32768 shared <- env.memory
```

`shared` + `<- env.memory` is the whole point: the host creates the `WebAssembly.Memory({shared:true})`
and the worker passes it as the `env.memory` import at instantiate time. The fallback build instead
*defines and exports* a non-shared memory (`memory[0] pages: initial=19`, no `shared`, no import).

## Cross-origin isolation requirement

A shared `WebAssembly.Memory` (SharedArrayBuffer-backed) is only available when the page is
**cross-origin isolated** — `globalThis.crossOriginIsolated === true`. The browser grants that only
under both response headers on the top-level document:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Under `require-corp`, every cross-origin subresource must itself carry
`Cross-Origin-Resource-Policy` (or be fetched with `crossorigin` + CORS). Our R2 blobs and any CDN
assets must send `Cross-Origin-Resource-Policy: cross-origin`. (`credentialless` COEP is an
alternative that drops the CORP requirement on no-credential subresource loads; `require-corp` is the
strict, most-portable choice and what the shim below sends.)

### Backend selection (no half-init)

`web/cpu-isolation.js` makes the decision **before any wasm is fetched**:

```
probeIsolation(globalThis) → { crossOriginIsolated, hasSharedArrayBuffer, hasAtomics, hasWorker, forceSingleThread }
selectCpuBackend(snapshot) → { backend: "worker-shared" | "single-thread", wasmVariant: "shared" | "fallback", reason }
```

Isolated ⇒ load `pkg-shared` + spawn `cpu-worker.js`. Otherwise ⇒ load the stable `pkg` in-line
(existing `WasmMachine` path) and log a single console warning. There is never a threaded backend
that starts and then discovers it cannot get a SharedArrayBuffer. `?singlethread=1` forces fallback
for debugging.

## Serving the headers, per host class

### 1. Dev server (already done)

`tools/serve-dev.sh` already sends `Cross-Origin-Opener-Policy: same-origin` +
`Cross-Origin-Embedder-Policy: require-corp` on every response. Playwright's default config uses it,
so the isolated path is exercised in CI on `dev`.

### 2. Production with header control (nginx / Cloudflare / Netlify / Vercel)

Send both headers on the HTML document (and ideally all app-shell responses):

```nginx
add_header Cross-Origin-Opener-Policy   "same-origin"    always;
add_header Cross-Origin-Embedder-Policy "require-corp"   always;
```

Netlify `_headers` / Vercel `headers` / Cloudflare Transform Rules: set the same two headers. Ensure
cross-origin subresources (R2, fonts) send `Cross-Origin-Resource-Policy: cross-origin`.

### 3. Header-less static hosts (GitHub Pages) — service-worker shim

GitHub Pages cannot set response headers. `web/coi-serviceworker.js` is a header-injection service
worker: it re-fetches each response and **synthesizes** the COOP/COEP headers, which flips
`crossOriginIsolated` to true — on the **second** load (first load installs + activates the SW; the
page then reloads once so the reloaded document is served through the SW). Registration helper:
`web/coi-serviceworker-register.js#ensureCrossOriginIsolated()`.

```html
<script type="module">
  import { ensureCrossOriginIsolated } from "./coi-serviceworker-register.js";
  const isolated = await ensureCrossOriginIsolated();  // may reload once
  const { chooseCpuBackend } = await import("./cpu-isolation.js");
  const sel = chooseCpuBackend();  // "worker-shared" now, or "single-thread" if the shim couldn't help
</script>
```

The shim only rewrites headers; the app-shell **offline cache is owned by `web/sw.js`** (E3-T24c).
The two service workers are registered independently and never double-own bytes.

## WFI park/wake

The worker parks with `Atomics.wait(controlCells, IRQ_index, seenIrq, timeoutMsToNextMtimecmp)`
(`cpu-control-block.js#wfiPark`). Any thread that raises an interrupt — a UART keypress, a timer
deadline, a virtio IRQ — calls `raiseIrq()` which `Atomics.add`s the monotonic IRQ counter and
`Atomics.notify`s it. The counter is monotonic and never reset, so a notify that races the park is
never lost: the worker re-reads the counter and `Atomics.wait` returns `not-equal` immediately.
`Atomics.wait` is legal only on a worker — never call `wfiPark` on the main thread.

## Interim synchronous MMIO stub

Until E4-T23 lands the async device proxy, device MMIO is a **blocking** request/response over the
control block (`mmioRequest` worker-side blocks in `Atomics.wait`; the main thread's
`mmioPending`/`mmioRespond` services it and wakes the worker). This keeps Alpine bootable with the
CPU already worker-side; E4-T23 replaces the stub with the real proxy without changing the build or
isolation story.

## Memory-model correctness

All cross-thread cells are read/written through `Atomics.*`. A device buffer write followed by
`raiseIrq()` (release) is observed-before the woken worker's read (acquire) — the worker never sees a
stale device buffer (ticket adversarial angle #3). The control block is a dedicated small
SharedArrayBuffer, separate from the guest `WebAssembly.Memory`, so signalling offsets are stable and
independent of the guest memory map.
