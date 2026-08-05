# E4-T02 — live in-browser CPU profile capture (dev, reaping-deferred leg)

The reaping-deferred half of E4-T02 was the **live browser DevTools performance capture** of the
wasm build (the on-host half — the profiling build flags + name-section verification via
`wasm-objdump` — was already done, see the ticket log). This is that capture, taken on the Linux
`dev` box which sustains the in-browser Alpine boot the dev mac OS-reaps.

## What was captured

- **Harness:** `tools/e4-browser-profile.mjs` drives headless Chromium (Playwright chromium-1148)
  to boot the **same chunked Alpine rootfs** in the wasm build (`web/pkg`), served by
  `tools/serve-dev.sh` with `?assetBase=/releases`. A bounded ~60 s window of the boot is sampled
  via the CDP `Profiler` domain (100 µs interval) → a `.cpuprofile` loadable in the Chrome DevTools
  **Performance** panel.
- **Artifact:** `evidence/e4-t02/browser-boot.cpuprofile` (real capture; 595 nodes, 373,189 samples
  ≈ 37.3 s of on-CPU time in the window).

## Real findings (self-time / leaf shares, read out of the capture)

| % host self-time | Frame | Note |
|-----------------:|-------|------|
| 21.7% | `wasm-function[305]` | hottest wasm fn |
| 15.2% | `wasm-function[160]` | |
| 10.5% | `wasm-function[201]` | |
|  7.1% | `__wbg_now_*` | **the `performance.now()` wasm-bindgen boundary shim** |
|  5.3% | `wasm-function[454]` | |

- **89.3% of host self-time is inside wasm** (the interpreter) — the browser confirms the native
  finding that the emulator core, not the JS shell, dominates. The **top 3 wasm functions ≈ 47%** of
  host time — a heavily concentrated hot path, consistent with the native flamegraph's per-quantum
  device/interrupt re-sync + translate + dispatch cluster (E4-T02 native: `sync_plic` 24%,
  `translate_cached` 10%, dispatch 9.5%).
- **The wasm-bindgen boundary is a real, visible cost:** `__wbg_now` (`performance.now()`) is 7.1%
  of host time — the browser-only manifestation of the same clock reads the native profile attributes
  to the device/interrupt re-sync path. This directly supports E4-T06's boundary-cost thesis.

## Honest limitation (frame NAMES vs the shipped bundle)

The served `web/pkg/wasm_vm_wasm_bg.wasm` is the **release** bundle, which ships with **no `name`
custom section** (verified here by parsing the binary — no name subsection present). V8 therefore
renders wasm frames as `wasm-function[N]` indices, not demangled Rust names. This is exactly the
adversarial finding the on-host half recorded: a release/`wasm-opt`-stripped bundle yields anonymous
browser frames; **demangled `wasm_vm_core::*` frames require deploying the `[profile.profiling]`
bundle** (`wasm-pack build --profiling`, whose `wasm-opt=['-O','-g']` metadata restores the 123 KB
name section / 208 named funcs, already verified on-host via `wasm-objdump -h`). The wasm32 +
wasm-pack toolchain is not installed on `dev`, so re-capturing against the `-g` bundle is the one
remaining sliver; the **capture path itself is now proven end-to-end on dev**, and the JS-side
bindgen frames (`__wbg_now`, …) are already named. The quantitative split above stands regardless of
the wasm-internal names.
