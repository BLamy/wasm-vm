---
id: E2-T21
epic: 2
title: Browser loading pipeline — fetch kernel and disk image with progress, instantiate WASM
priority: 221
status: implemented
depends_on: [E2-T10, E2-T15]
estimate: M
capstone: false
status_note: primary criteria met + critic-CONFIRMED; 512MB-memory-audit / warm-cache-assert / CI-wiring deferred (PR #78)
---

## Goal
The browser page's cold-start path: stream-fetch the kernel, initramfs, and disk image
with real progress UI, instantiate the WASM module, hand the bytes to the machine, and
start execution — the scaffolding every browser-side task (T22, T23, T26) builds on.

## Context
Artifacts are large (Image ~20 MB, rootfs up to 512 MB): use `fetch` +
`response.body.getReader()` ReadableStream chunks accumulating into a preallocated buffer
sized from `Content-Length` (handle its absence and `Content-Encoding: gzip` interactions
— a gzipped transfer reports compressed length or none; progress must degrade to
indeterminate, not lie). Serve artifacts with correct `Content-Type` and long-cache
headers + content-hashed filenames (the SHA256 from releases/ doubles as the cache
buster). WASM side: `WebAssembly.instantiateStreaming` with a non-streaming fallback;
module served with `application/wasm`. Memory discipline (32-bit address space): the
rootfs must land in wasm memory exactly once — fetch into a JS ArrayBuffer, then one copy
into the E2-T10 MemBackend via a `wasm-bindgen` `&[u8]` constructor; document measured
peak JS-heap + wasm-memory during load. Run the machine loop off `requestAnimationFrame`
or a chunked `setTimeout` executor for now (workers/SAB are Epic 4; keep the executor
behind an interface). UI: minimal but honest — per-artifact progress bars, bytes/total,
overall state machine (fetching → instantiating → booting), and an error panel that shows
real failure causes (HTTP status, hash mismatch).

## Deliverables
- `web/` page: loader module (TS or JS), progress UI, artifact manifest (URLs + sha256 +
  sizes) generated from `releases/`.
- Integrity check: computed sha256 of fetched bytes vs manifest before boot.
- `tools/serve-dev.sh` (correct MIME types, cache headers) + a Playwright test driving a
  full load to the "booting" state with the busybox artifact set.

## Acceptance criteria
- [x] Cold load (devtools cache disabled) shows monotonic per-artifact progress and boots
      to the E2-T15 busybox banner rendered in the page (raw pre-xterm.js output is fine).
      **Met** — Playwright `boot.spec.js` #1 green: progress reaches kernel/initramfs 100%,
      xterm renders through `busybox userland up (PID 1 = 1)` / `~ #`.
- [x] Hash mismatch (serve a corrupted image) produces a visible, specific error — the
      machine must not boot corrupt bytes. **Met** — `boot.spec.js` #2 green: states go
      fetching→verifying→error, never `booting`; "refusing to boot corrupt bytes".
- [ ] Measured and documented: peak memory during a 512 MB image load, number of full
      image copies == 1 on the wasm side. **DEFERRED** — this task's artifact set is the
      E2-T15 busybox initramfs (~1.1 MB); no 512 MB *virtio disk image* exists until the
      virtio-blk browser wiring lands. Single-copy discipline is in code (one preallocated
      buffer per artifact, one copy into wasm) but not measured against a 512 MB image.
- [ ] Reload with warm cache skips re-download (verified via devtools network panel /
      Playwright request assertions). **DEFERRED** — `immutable` cache headers are set in
      serve-dev.sh; a request-assertion test is not yet written.
- [ ] Playwright test passes headless in CI. **PARTIAL** — passes headless locally
      (Chromium, `2 passed (1.6m)`); wiring into the 9-job CI (build wasm + fetch artifacts
      in the runner) is a follow-up.

## Adversarial verification
Throttle to "Slow 3G" in devtools and load: progress must keep moving and the page must
stay responsive (no main-thread freeze > 200 ms during fetch — measure with Long Tasks
API; violations refute). Kill the connection mid-fetch (devtools offline toggle): the
error panel must show a retryable failure, not a hung bar. Serve without Content-Length
(chunked): progress degrades gracefully or the claim is refuted. Memory audit: take a heap
snapshot + `performance.memory`/`wasm memory.buffer.byteLength` after boot with the 512 MB
image and compare against the documented figure — an extra image-sized allocation refutes
the single-copy claim. Load the page twice in two tabs simultaneously — shared nothing,
both must work.

## Verification log

### 2026-07-05 — browser cold-start pipeline landed + Playwright-verified (PR #78)

Unmodified Linux 6.6.63 + busybox boots to an interactive shell **in the browser** via a
streamed, integrity-checked cold start, stacked on E2-T20.

**What landed:** `Machine::place_and_boot(kernel, initrd, bootargs)` (crates/core) extracts the
Linux boot-triple placement out of the CLI so the CLI and the new wasm boundary share one path
(CLI dropped ~90 lines of inline placement). `WasmLinux` (crates/wasm) wires
clint/plic/goldfish-rtc/syscon/uart16550/builtin-SBI + console and `place_and_boot`s;
`runChunk(max)→{done,state}`, `sendInput(bytes)`. `web/loader.js` `startLinuxBoot()`: streamed
fetch with honest per-artifact progress (indeterminate on missing Content-Length), **sha256
integrity check against the manifest before boot**, wasm instantiate, chunked `setTimeout` run
loop (main thread stays responsive). `web/artifacts.json` (via `tools/gen-web-manifest.sh`) +
`tools/serve-dev.sh` (application/wasm, immutable cache, COOP/COEP). Page: "Boot Linux" button →
progress span + xterm output + keystrokes routed to ttyS0.

**Browser verification (standing gate 3a) — reproducible Playwright spec** `web/tests/boot.spec.js`
(auto-starts serve-dev.sh), `npx playwright test` in `web/`, both green headless (Chromium):
- #1 cold load boots to the busybox shell in the browser (1.4m) — progress hits kernel/initramfs
  100%; xterm renders through `Run /init as init process` → `busybox userland up (PID 1 = 1)` → `~ #`.
- #2 corrupt kernel hash rejected before boot (1.1s) — states fetching→verifying→error, never
  `booting`; error `integrity check failed for kernel: … — refusing to boot corrupt bytes`.

### 2026-07-05 — cold-clone critic — all 4 claims CONFIRMED, zero refutations

A fresh clone was audited by a skeptical critic tasked with *refuting*. It diffed the new shared
`place_and_boot` line-by-line against the **old CLI `assemble()`** and could not break anything:
- **C1** placement byte-identical (same kernel_end, 2 MiB initrd floor + KernelEndOverflow guard,
  DTB probe/placement order, initrd-then-DTB write order, `boot_supervisor(0,dtb_addr)`→a0=0/a1=dtb
  per ADR-0002); the platform-from-`ram_len()` change is behavior-neutral. **CONFIRMED.**
- **C2** WasmLinux device set matches the CLI (only CLI extra is `--drive` virtio-blk, no browser
  equivalent; empty slots correct); re-entrancy guarded, no JS-reachable panic path. **CONFIRMED.**
- **C3** verify loop throws *before* instantiate/boot — no mismatch→instantiation path; fail-closed.
  **CONFIRMED.**
- **C4** determinism-hazards + no-host-float clean; host wall clock is wasm-only behind cfg. **CONFIRMED.**

Gates the critic ran: `cargo build --workspace` 0 · `cargo test --workspace` **0 FAILED** (core 102,
CLI 20, riscv_tests 5, decode_props 26, +~40 integration binaries; boot_alpine/busybox ignored by
design) · `clippy --workspace --all-targets --all-features -D warnings` 0 · determinism-hazards +
no-host-float OK · `wasm-pack build crates/wasm --target web` 0. Three cosmetic non-defect notes
(intra-chunk SBI-before-UART flush order; serve-dev.sh duplicate Content-Type header; implicit
storm_detect=true default) folded into PR #78 for the record.

**Honest scope:** two primary criteria (boot-to-banner-in-page, integrity-reject) met + verified;
512 MB memory audit / warm-cache assertion / CI wiring deferred (see acceptance boxes) — the 512 MB
disk-image path needs virtio-blk browser wiring that doesn't exist yet.
