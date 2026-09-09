---
id: E5-T18b
epic: 5
title: Prove WM terminal launch and keyboard input
priority: 518.2
status: verified
depends_on: [E5-T18a]
estimate: S
risk: high
capstone: false
---

## Goal

Prove that a user can launch the configured terminal from the WM menu and type a command
through the existing guest input path.

## Boundary

This slice owns WM-menu terminal launch, window focus, keyboard delivery, and terminal text
rendering. Cursor/DPR geometry, compositor crash recovery, and playbook consolidation are
separate slices.

## Deliverables

- A deterministic terminal interaction harness built on the T18a ready-desktop fixture.
- Input evidence showing the menu selection, focused terminal, typed command, and rendered output.
- Any required image/startup configuration changes, rebuilt through the committed builder.

## Acceptance criteria

- [x] The local desktop harness selects Terminal from the WM menu and opens the configured
      foot/xterm window.
- [x] The focused terminal accepts a deterministic command through the T12 input path and
      renders the expected ls output without dropped, duplicated, or reordered keystrokes.
- [x] Repeating the open/type/close flow leaves the desktop responsive and produces no
      unexpected console or guest errors.

## Verification command

make verify-E5-T18b

## Adversarial verification

Repeat the menu/open/type/close flow with focus changes and a rapid but bounded input burst.
Verify that a terminal opened after another window was focused still receives the complete
command and output. A silent focus loss, missing character, or stale terminal window refutes
the slice. WebKit and independent machines are out of scope.

## Verification log

### 2026-09-05 — coordinator — planned

This S slice freezes the typed-terminal user path on top of the cold-boot contract.

### 2026-09-05 — worker — IMPLEMENTED

- Exact implementation head: `115910d` (`feat(e5-t18b): prove desktop terminal input`).
- Acceptance command: `make verify-E5-T18b` passed on local Chromium with a cold cache. The run
  completed two Terminal-launch → content-focus → typed-command → Control-D cycles in 602.241 s,
  with 71 presented frames, 272 keyboard frames matched to 272 DOM events, and both commands
  reporting `terminalMarkerSeen=true`, `inputSequenceMatch=true`, and visible diffs of 9,657 and
  9,675 pixels. The deterministic 10 ms inter-key cadence keeps the larger command burst bounded
  while allowing the interpreted guest to consume each T12 frame.
- Evidence: [desktop-terminal-input.json](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t18b/desktop-terminal-input.json)
  (SHA-256 `5aa963e84165c95d193a56490665819fad0bfbfc5a28b1ce3093c100bd3d85b8`),
  [desktop-terminal-browser-console.log](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t18b/desktop-terminal-browser-console.log)
  (SHA-256 `5fa145ba9dc48aa47d67fc4833eec3f083db9b487dabd6349f5d911d78f5657b`), and
  [desktop-terminal-input.png](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t18b/desktop-terminal-input.png)
  (SHA-256 `45456a63a456737cf9a46709083638bf6131b7e0925092a5bf5620579af37ef2`). The exact
  launcher-enabled image is SHA-256 `08bb8227fe0180ed06e5a01188e4a0fe3b21565ba83dcc2c1df632ca413172be`,
  its file manifest is `0155d794fa136a4653e76ae76f9c01233d9175f0ef56a9e9eb2565074985e0ad`, and
  its split chunk manifest is `2e92778fe0e6c5bd0819034bda28d235307cf7ab8f031cd30e1854f96982a6c0`.
- Supporting gates passed: `cargo fmt --all -- --check`; affected core/CLI/wasm32 clippy with
  `-D warnings`; 267 core tests with `gpu-trace`; the two guest keyboard-stream tests; wasm32
  check; 36 keyboard/pointer/reconciliation tests; shell syntax; source/dist parity; and the
  verifier self-test. The repository-wide `make ci` was attempted but remains blocked by
  pre-existing macOS all-feature `wvseccomp` libc errors and unrelated dead-code warnings, plus
  an unrelated E6-T22 trailing-space edit; none is in this diff.

Claim: at this exact implementation head, the local Chromium route boots the pinned riscv64
Weston desktop, selects the configured desktop-shell Terminal launcher, opens `/usr/bin/weston-terminal`
which starts foot, focuses the client through the guest pointer path, and delivers both deterministic
commands through Chromium physical `KeyboardEvent` → T12 evdev frames → virtio-input → foot. The
recorded visual markers, exact DOM/frame sequence matches, clean repeat closes, zero browser errors,
published image/chunk bindings, and paused guest state demonstrate the acceptance criteria. WebKit,
independent machines, and host rr are outside this slice's explicit scope.

### 2026-09-05 — verifier — VERDICT: verified

- P1 exact-head publication — HELD. Predicted the committed report would identify the local
  Chromium scope and bind the run to the exact launcher-enabled image. At `HEAD` `61fd584` (runtime
  head `115910d`), the report records the scope, result, image/file/chunk manifest bindings, and
  `chunk-verify: OK` at [desktop-terminal-input.json](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t18b/desktop-terminal-input.json:2).
  Fresh SHA-256 checks match the report for the image, both manifests, report, transcript, and
  screenshot; the file manifest contains the executable `/usr/bin/weston-terminal` digest.
- P2 launcher, focus, input, and repeat — HELD. Predicted two complete menu → terminal → focus →
  command → Control-D cycles with no lost or reordered physical keys. The recorded interaction
  records show two accepted launches, focuses, commands, and closes, with both markers visible and
  `132` keyboard frames equal to `132` DOM events at lines 116-219. An independent frame audit
  reconstructed 66 make/break pairs per command (including Enter), matched every code to the
  command string, and found zero evdev-code mismatches across all 272 frames.
- P3 rendering, errors, and final state — HELD. Predicted the guest would present usable desktop
  frames and finish in a clean paused state. The report records 71/71 successful Canvas2D presents,
  zero dropped frames, 12 pointer frames, no input diagnostics, `paused: true`, and `error: null`
  at lines 221-224 and 2405-2531; browser console/page/request error arrays are empty at lines 55-59.
  The transcript has only the explicitly tolerated favicon 404 at line 24, and the committed
  screenshot hash recomputes at lines 2534-2536.
- P4 bounded novel attack — HELD. Predicted a one-cycle proof mutant would be rejected rather than
  accepted as the required repeated flow. `node tools/verify/e5-t18b-desktop-terminal-input.mjs
  --self-test` exited 0 with `E5T18B_SELF_TEST=wrong-count-rejected` (`tools/verify/e5-t18b-desktop-terminal-input.mjs:474-505`).
- COVERAGE — HELD. The browser recording exercises the added terminal route, launcher-enabled
  image, wasm interactive keyboard budget, serialized tablet/mouse pointer path, T18b asset route,
  and verifier main path. Source/dist parity and the deployed index link are independently bound at
  lines 2538-2585. The native-only CLI constant call site (`crates/cli/src/boot.rs:1585-1590`),
  legacy noninteractive foot fallback (`tools/rootfs-inner.sh:456-470`), byte-identical TypeScript
  pointer mirror, and generated queue/dist/service-worker/index metadata are explicit waivers, not
  acceptance claims. No acceptance-bearing changed hunk remains unexecuted or unexplained.

Commands: `git rev-parse HEAD`; `git diff --name-status d133ec9..61fd584`; SHA-256 checks for the
report/transcript/screenshot/image/manifests; `target/release/wasm-vm chunk-verify
target/e5-t18b/chunks/desktop-v6`; independent JSON invariant, keyboard-pair/code/evdev audits;
source/dist `cmp`; `node --check tools/verify/e5-t18b-desktop-terminal-input.mjs`; `node
tools/verify/e5-t18b-desktop-terminal-input.mjs --self-test`; `node --test web/tests/pointer.test.mjs`;
`bash -n tools/build-rootfs.sh tools/image/desktop.sh tools/rootfs-inner.sh tools/serve-dev.sh`; and
scoped `git diff --check`. WebKit, independent machines, and host rr were not run per the task's
explicit scope. No implementation, test, script, evidence, or unrelated file was modified.
