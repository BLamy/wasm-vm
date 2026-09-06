---
id: E5-T18c
epic: 5
title: Prove desktop cursor alignment and DPR hit-testing
priority: 518.3
status: implemented
depends_on: [E5-T18b]
estimate: S
risk: high
capstone: false
---

## Goal

Freeze pointer geometry and focus hit-testing for the ready desktop at device-pixel ratios one
and two.

## Boundary

This slice owns host-cursor mapping, guest hover-highlight state, and close/maximize button
hit-tests at DPR 1 and DPR 2. Terminal launch, compositor recovery, and documentation belong
to neighboring slices.

## Deliverables

- A deterministic pointer test fixture with explicit CSS-to-guest coordinate assertions.
- Evidence for cursor/hover coincidence and close/maximize behavior at DPR 1 and DPR 2.
- Regression coverage for rounding, canvas offsets, and the active-window focus transition.

## Acceptance criteria

- [ ] Moving the host cursor to the tested control produces the matching guest hover highlight
      at both DPR 1 and DPR 2, with no one-pixel or scale-dependent offset.
- [ ] Close and maximize buttons hit-test the intended window at both DPR values and do not
      activate an adjacent control.
- [ ] The pointer/focus run is deterministic across repeated local Chromium contexts and has
      no unexpected console errors.

## Verification command

make verify-E5-T18c

## Adversarial verification

Run the hit-test matrix at fractional canvas offsets and at coordinates immediately adjacent
to each button boundary. Repeat after opening and maximizing a second window. Any DPR-dependent
miss, neighboring-control activation, or cursor/hover divergence refutes the slice. WebKit and
independent machines are out of scope.

## Verification log

### 2026-09-05 — coordinator — planned

This S slice isolates pointer scaling and focus geometry after the terminal path is known to be
usable.

### 2026-09-05 — worker — STARTED

The active implementation slice freezes CSS-to-guest pointer mapping and Weston window-control
hit-testing at device scale factors 1 and 2. WebKit and independent machines remain out of scope.

### 2026-09-05 — worker — IMPLEMENTED

Frozen implementation: `4302d6b617a6f8f8cf492bf92095814fd2006cf3`, relative to verified T18b
`33717547b7b1c97bf18817fbb13e557ce3861169`. Final acceptance ran once from the initially clean
clone `/tmp/wasm-vm-t18c-final.yhtgGy/repo`, with `RUSTFLAGS`, `RUST_LOG`, all `CARGO_*`, and all
`E5_T18C_*` environment variables removed before invoking make. The only explicit external inputs
were the previously verified, read-only T18b image/chunk publication and the local chunk verifier:

```sh
make verify-E5-T18c \
  E5_T18C_IMAGE=/Users/blamy/Documents/Codex/wasm-vm/target/e5-t18b/desktop-image-v6/alpine-rootfs.ext4 \
  E5_T18C_DESKTOP_ASSET_DIR=/Users/blamy/Documents/Codex/wasm-vm/target/e5-t18b/chunks/desktop-v6 \
  E5_T18C_CLI=/Users/blamy/Documents/Codex/wasm-vm/target/release/wasm-vm
```

Publication paths in the raw report are relative to that recorded clone; the command above
provides their canonical local locations. The recorded report was copied without rewriting bytes.

Result: exit 0. The make target passed 28 pointer/geometry/observer tests, the fail-closed runner
self-test, and the local wasm/dist build before recording four fresh cache-disabled Chromium
152.0.7977.76 contexts (two at each DPR). Each context opened and focused two successive terminal
windows, proved minimize/restore as a positive control, checked 31 adjacent hover positions and
eight outside-control presses per window cycle, then maximized and closed at opposite inside
corners. All 248 hover-boundary probes, 64 outside presses, eight maximizes, eight closes, and
eight minimize/restore controls passed. Each close observation retired at least as many guest
instructions as its successful restore control, always over 100 million. All 16 center-hover
captures matched all 94 opaque pixels of an independently sourced guest cursor bitmap at the
exact predicted hotspot. Repeated window geometries agreed across both repetitions and DPRs;
the second window's titlebar was correctly clipped below the 32-pixel Weston panel. No console,
page, request, or pointer-diagnostic errors occurred. Each final guest was paused and digested;
the source/dist parity check and unchanged-head guard both passed.

Evidence:

- `evidence/e5-t18c/desktop-cursor-dpr-hit-testing.json` — SHA-256
  `347759ea9286aa9b14d6c9213fd06c9efdd8db52ae238538f00b333cdce6653c`.
- `evidence/e5-t18c/desktop-cursor-browser-console.log` — predictions before observations,
  guest/browser transcript; SHA-256
  `92de568ef146aad13073bd8c8663c1c175f96cb7adb7a0f957ad1b18a93a80b6`.
- `evidence/e5-t18c/worker-acceptance.log` — complete make/build/test output and final report;
  SHA-256 `570420c3268fbcb34ff133802d4933a613ab2c1dfef0e24f8bb433e8b609f513`.
- Four `desktop-cursor-dpr-{1,2}-run-{1,2}.png` final captures and 16 `DPR-*-hover.png`
  captures; exact filenames and SHA-256 values are embedded in the report.
- `evidence/e5-t18c/cursor-reference.json` binds the independently downloaded Wayland 1.22
  fallback `left_ptr` to identical bytes at offset 16328 in the pinned guest library.
- `evidence/e5-t18c/demo-suite.json` and `demo-suite.png` record the built app's 126 passed,
  zero failed, zero unexpected console errors, 11 live ISA pips, and the new Cursor + DPR link.
  Its T18c pip remains partial pending the fresh verifier. The smoke check staged
  `web/artifacts-alpine.json` into dist exactly as `tools/deploy-cloudflare.sh` does; the build
  intentionally excludes that deployment-time manifest. This did not change runtime sources.

Additional scoped self-validation passed: `cargo fmt --all --check`,
`cargo clippy -p wasm-vm-core -p wasm-vm-wasm --all-targets --features wasm-vm-core/gpu-trace -- -D warnings`,
and `cargo test -p wasm-vm-core --features gpu-trace --lib` (267 passed). The unrelated Linux-only
`wvseccomp` crate is not a macOS target; the quarantined `zicsr-stub` feature is not enabled for
this runtime claim. No Rust runtime behavior, pointer transport, or guest image changed in T18c.
Earlier diagnostic boots are not acceptance evidence. No rr, WebKit, independent machine, or
Omarchy work is part of this submission.
