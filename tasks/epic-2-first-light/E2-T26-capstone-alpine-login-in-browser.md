---
id: E2-T26
epic: 2
title: "Capstone: unmodified Alpine riscv64 boots to a login shell in the browser"
priority: 226
status: pending
depends_on: [E2-T19, E2-T20, E2-T22, E2-T23, E2-T24, E2-T25]
estimate: L
capstone: true
---

## Goal
The Level 2 threshold, demonstrated end-to-end. First the minimal-platform proof: the
browser tab boots **xv6-riscv** to its `$` shell (Layer A + minimal Layer B). Then the full
milestone: the same page loads the WASM machine, fetches the pinned Linux kernel and Alpine
ext4 image, boots unmodified Linux from virtio-blk to a `login:` prompt in xterm.js; a human
logs in, uses `vi`, `top`, and shell scripts, and runs `poweroff` to a clean, UI-acknowledged
halt. Real OS kernels — tiny and full — in the tab.

## Context
Integration of everything in this epic: T21's loader feeds T10's MemBackend and boots the
T12 kernel against the T18 rootfs over T08/T09/T11 virtio-blk, on the T02 DTB with
T04–T06 SBI, consoled through T07+T22 xterm.js, timed by T05+T16+T23, shut down via T17,
watched by T20, at the speed T25 measured. Expected gaps to close here: the wasm build of
the full device stack (anything `cfg`-gated wrongly shows up now), the T17 ExitReason
event surfacing as a "machine halted — reload to boot again" UI state, and a browser
subset of T24's battery. Per the capstone protocol (tasks/README.md), the demo must run
from a cold start: fresh clone, `tools/build-all.sh` (or documented artifact download),
fresh browser profile, no dev-server state. Record the demo (screen capture) and check in
the script that reproduces it. This is the "demoable to anyone" moment from the roadmap —
a public URL is not required, `tools/serve-dev.sh` is.

## Deliverables
- The working page: load → progress → boot log streaming in xterm.js → `login:` →
  interactive session → poweroff → halted state UI.
- `tools/demo-capstone.sh`: builds/fetches artifacts, serves, prints the URL and the
  demo script (login, vi, top, script, poweroff).
- Playwright end-to-end test automating the entire capstone flow headless, kept green in
  CI; demo recording checked into `docs/media/`.
- Updated `README.md` top-level: how to run Level 2 in your own browser.

## Acceptance criteria
- [ ] Fresh clone + documented commands → the browser boots xv6-riscv to `$` and runs `ls`.
- [ ] Fresh clone + documented commands → browser shows Alpine `login:`; root login works.
- [ ] In the browser: `vi /root/hello.sh` — write a 3-line script with a loop, save;
      `sh /root/hello.sh` produces correct output; `top` renders and updates live; ^C
      exits it cleanly.
- [ ] `poweroff` runs OpenRC shutdown, kernel prints "Power down", the page shows a
      distinct halted state, and a subsequent externally-run `fsck.ext4 -f -n` on the
      served image's post-session state (native re-check of the same flow) is clean.
- [ ] Boot to login: measured time recorded and within 2x of the T25 browser baseline.
- [ ] Playwright capstone test passes 3/3 consecutive runs with fresh browser contexts.
- [ ] Storm detector (T20) reports zero anomalies across the full demo session.

## Adversarial verification
Cold-start rule is absolute: verify on a machine/profile that has never run the project
(or a pristine container + fresh Chromium profile); any undocumented dependency or
leftover-state reliance refutes. Run the full demo 3x with fresh contexts; then adversarial
variations: Slow-3G throttled load; background the tab for 2 min mid-boot and after login
(T23 claims under fire); paste a 100 KB script into vi; run `dd if=/dev/zero of=/x bs=1M
count=128` then `md5sum` read-back in-browser; attempt login with a wrong password first.
Any hang, storm dump, dropped input, corrupted file, or dirty post-poweroff journal
refutes. Compare the session subjectively and objectively (boot time, `top` refresh
smoothness, ^C latency) against webvm.io/alpine.html and record the comparison in the log
— parity is not required at Level 2, but the delta must be measured and stated. Finally,
confirm the kernel and rootfs artifacts' sha256 match `releases/` manifests — any locally
patched artifact refutes "unmodified".

## Implementation plan (2026-07-05, scoped from the codebase)

The capstone integrates already-shipped pieces; the concrete NEW work is the browser disk path.
The current browser boot (`WasmLinux`, #78/#79) uses `enable_virtio_slots(None)` — **no disk** — and
boots the busybox *initramfs*. Alpine needs `root=/dev/vda` over virtio-blk. Gap, in order:

1. **In-memory `BlockBackend` — ALREADY EXISTS.** `crates/core/src/block.rs` has `MemBackend`
   (Vec-backed, RW, `MemBackend::new(Vec<u8>)`) and `SparseMemBackend`, both `impl BlockBackend`.
   No new device code — just feed the Alpine image into `MemBackend::new` and `enable_virtio_blk`.
   Memory: take the image as a `Vec<u8>` param (wasm-bindgen moves it into the MemBackend — one
   wasm-side copy, keeping the T21 single-copy discipline; a `&[u8]` + `.to_vec()` would double it).
2. **`WasmLinux` disk mode.** Add a constructor (or arg) that takes the disk image bytes, builds
   the MemBackend, `enable_virtio_blk`s it, and boots with `root=/dev/vda rw` and NO initrd (the
   existing `place_and_boot` already supports `initrd: None`). Keep the initramfs path too.
3. **`web/loader.js` disk mode — DONE.** `startLinuxBoot({mode:"disk"})` fetches kernel + the
   `rootfs` manifest artifact, integrity-checks both, and boots via `WasmLinux.newDisk`. Single-copy
   (the 512 MB image is `Vec<u8>`-moved into the MemBackend). **Manifest strategy (CI-critical):**
   the 512 MB image is TOO BIG for gh-pages and `web-build` regenerates `artifacts.json`, so Alpine
   is **local-only** — a SEPARATE `web/artifacts-alpine.json` (gitignored, generated by
   `tools/demo-capstone.sh`), served by `serve-dev.sh`. Do NOT add rootfs to the committed
   `artifacts.json` / `gen-web-manifest.sh` (keeps gh-pages busybox-only + the deploy green). The
   "Boot Alpine" button passes `manifestUrl:"./artifacts-alpine.json"`; absent → graceful error.
   (No manifest-drift CI gate exists, confirmed — but the deploy job DOES run `gen-web-manifest`.)
4. **Halted-UI state (T17).** Surface `runChunk`'s poweroff/reboot terminal state as a distinct
   "machine halted — reload to boot again" UI, not just a status string.
5. **xv6 minimal proof.** Separate + simpler: an xv6-riscv kernel ELF booted via the bare-metal
   path (like `WasmMachine`/ELF, not the Linux platform) to its `$`. Artifact must be built/pinned
   (none in releases/ yet) — likely its own small sub-task.
6. **`tools/demo-capstone.sh`, Playwright e2e, recording, README.** The e2e is heavy: a browser
   Alpine boot is ~10 min (native was 445 s; browser ~1.2×), so the capstone Playwright test is a
   long/nightly job — bound it and document, like E2-T24.

**Cost note:** browser Alpine boot ≈ 9–10 min each; 3× fresh-context runs ≈ 30 min. This is a large
(L) capstone whose verification is measurement-heavy — implement in focused passes, not one sprint.

## Verification log
(empty)
