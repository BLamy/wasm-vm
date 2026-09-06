---
id: E5-T18c
epic: 5
title: Prove desktop cursor alignment and DPR hit-testing
priority: 518.3
status: verified
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

- [x] Moving the host cursor to the tested control produces the matching guest hover highlight
      at both DPR 1 and DPR 2, with no one-pixel or scale-dependent offset.
- [x] Close and maximize buttons hit-test the intended window at both DPR values and do not
      activate an adjacent control.
- [x] The pointer/focus run is deterministic across repeated local Chromium contexts and has
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

### 2026-09-05 — fresh adversarial verifier — VERDICT: verified

VERDICT: verified. No remaining falsification or in-scope sufficiency finding.

Verified frozen implementation `4302d6b617a6f8f8cf492bf92095814fd2006cf3` against
`33717547b7b1c97bf18817fbb13e557ce3861169`, with worker submission `23ca95b`. Independently
checked the report and transcript in both main and the recorded pristine clone: their SHA-256
values are respectively `347759ea9286aa9b14d6c9213fd06c9efdd8db52ae238538f00b333cdce6653c`
and `92de568ef146aad13073bd8c8663c1c175f96cb7adb7a0f957ad1b18a93a80b6`. Rehashed all 20
referenced PNGs in both locations and matched every report digest. Visually inspected all four
final PNGs and representative normal, panel-clipped, and maximized hover captures. Compared the
seven source/dist pairs, runner, and cursor reference byte-for-byte with the frozen commit;
the worker metadata commit changed no implementation under this proof.

The following predictions were made before examining final acceptance states. `report` below
means `evidence/e5-t18c/desktop-cursor-dpr-hit-testing.json` at the digest above.

- P1 CSS mapping and cursor/hover coincidence — **HELD**. Predicted identical guest pixels
  at DPR 1/2 despite canvas origin `(80.25,84.5)`, exactly the intended highlight, and no
  displaced hotspot. Independently recomputed all recorded CSS/guest/tablet mappings and
  half-open hit tests. All 248 edge-hover observations matched their preceding transcript
  predictions; all 16 center observations report the exact target hotspot and 94 opaque
  reference pixels (report lines 2027, 6286, 21161, 25420 and the corresponding entries in
  all four runs). The independently checked Wayland bitmap/reference remains unchanged.
- P2 intended control activation, including the second window — **HELD**. Predicted normal
  rectangles `(115,251,811,745)` then `(557,13,1253,507)`, panel-clipped controls, and exact
  maximization to `(0,32,1280,800)`. All eight cycles agree. Opposite inside corners exercise
  maximize and close; all 64 outside-titlebar presses preserve geometry. Independently
  checked all 88 press deliveries: exactly one tablet move followed by absolute mouse
  BTN_LEFT/272 make and break, consecutive distinct frame sequences, and exact coordinates.
  Final held-button and pointer-diagnostic arrays are empty in every run.
- P3 close is distinguishable from minimize — **HELD**. Each positive minimize/Super+Tab probe
  restores its original rectangle; each close/Super+Tab probe leaves no window after at
  least the positive probe's actual retired-instruction budget. Recomputed every
  `after - before`, checked the required budget against its own positive control, and
  rejected relying on the report's accepted flags alone. Counter citations: report lines
  4203, 8462, 13770, 18029, 23337, 27596, 32904, and 37163.

  | DPR / repetition / cycle | Positive retired | Close retired |
  |---|---:|---:|
  | 1 / 1 / 1 | 101478121 | 102976314 |
  | 1 / 1 / 2 | 100477406 | 101975697 |
  | 1 / 2 / 1 | 102976554 | 104975026 |
  | 1 / 2 / 2 | 100477523 | 103476066 |
  | 2 / 1 / 1 | 101976816 | 102976059 |
  | 2 / 1 / 2 | 101477245 | 103975053 |
  | 2 / 2 / 1 | 101976821 | 103975369 |
  | 2 / 2 / 2 | 100977471 | 103974921 |

- P4 repetition, clean context, and diagnostics — **HELD**. Four distinct DPR/repetition
  records each contain two complete cycles, with equal repeated geometry and zero unexpected
  console/page/request errors. The raw transcript's only browser error is the permitted
  favicon 404 at line 77. All final guests are paused with state digests at report lines
  9578, 19145, 28712, and 38279. Built-demo evidence remains HELD: 126/0, correct link,
  appropriately partial pre-verdict pip, and the documented deployment-time Alpine manifest.
- Incremental adversarial checks — **HELD**, carried forward without rerunning the boot.
  The unchanged frozen harness already passed 28 targeted JS tests and its self-test. Prior
  verifier attacks confirmed rejection of absent/one-pixel-displaced cursors, cursor-induced
  diagonal body-edge shifts, missing press frames, duplicate button-downs, non-progressing
  async counter reads, and insufficient/overshoot-mismatched restore budgets. The diagonal
  fixture draws two black pixels at `(811 + floor(row/2), 264 + row)` for rows 0 through 23;
  the window rectangle and controls remain unchanged. Unchanged T18b launch/focus evidence
  and scoped core gates remain HELD; they are not re-litigated by this metadata-only verdict.
- COVERAGE — live evidence exercises normal/maximized/panel-clipped body detection, boundary
  classification, cursor matching, exact press delivery, both control transitions, matched
  progress polling, repeated contexts, and the read-only pointer-state accessor. Invalid
  inputs and fail-closed oracle paths are covered by the held deterministic tests/attacks.
  Static HTML/CSS, manifest/roadmap declarations, serialization, and diagnostic-only failure
  capture are waived from separate runtime branch proof; source/dist parity and the built
  demo cover publication wiring. No core runtime or pointer transport change is claimed.
- SUITE — retain the committed geometry/observer regression tests, runner self-test, cursor
  reference, and `make verify-E5-T18c` as the permanent proof artifacts. No duplicate tests or
  new implementation edits are needed. WebKit, independent machines, rr, process-management
  expansion, and another cold boot remain out of scope.

Verifier commands/checks: read-only Node assertions over every report cycle and corresponding
transcript predictions; SHA-256 checks of report/transcript/log/PNGs; `git show` byte comparisons
against the frozen head; local PNG inspection. The earlier held JS/self-test and bounded
in-memory sabotage checks are reused unchanged. Only task status/checklists/log and generated
queue/task JSON are changed by this verdict; final dist rebuild/deployment remains with worker.
