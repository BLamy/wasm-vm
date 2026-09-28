VERDICT: verified

# E5.5-T03ay — late response verified; desktop acceptance remains negative

The combined diagnostic option preserves the original product failure and proves
a later terminal response on the cap-1024 / 16384-entry decoded-cache candidate.
The first retained frame containing the typed command and returned prompt arrives
**155.838 seconds after Enter**. This is diagnostic evidence only. Desktop
responsiveness is not solved and T03q is not promoted.

Frozen implementation: `f89062c73ec6d6b8e9ce0d88bd3ebdb2fc7edb93`.
Worker submission: `2383565e`. Predictions preceded opening AY runtime/image
evidence. I did not implement this task or edit implementation code.

## Predictions

- **P1 option/runtime — HELD.** The normalized candidate URL equals AX's URL
  exactly. Compared with AW, only `decodedCacheEntries=16384` is added. Both
  actual runtime samples show cap-1024, cap 1024, recycling enabled and 16384
  decoded entries, with the unchanged 500000-instruction quantum and icount
  divider 64. The observer is explicitly requested by the new CLI option;
  `diagnosticOnly:true` and `desktopAcceptance:false` remain set.
- **P2 provenance — HELD.** Independently hashed all 47 helper sources, 96
  served rows / 73 resources / 67 Git-backed dist resources, exact AR RAM/delta,
  AQ kernel and R3 chunk manifest. Every predicted hash matches. AT WASM remains
  1602266 bytes, SHA-256
  `7d7b300003cf68076c28958694062dacf3c879efe921bc631bade568ee143bdf`.
  The late/pixel observer, watchdog, trial policy and WASM match their held AX
  versions byte for byte. See `audit.json` `sources`, `provenance`, `carried`.
- **P3 original physical trial — HELD.** The 128 trusted key events reconstruct
  `printf 'd1789351536e2a1c' > /tmp/desktop-keys-68240c0ab6976c7f`; 256 ordered
  keyboard/sync acknowledgements are true. Independent raw fence `mu4x2gh028`
  completes at `2026-09-17T02:34:49.310Z`, traffic index 1159, **67.556s after
  Enter**. No serial input contains the nonce. The original screenshot is taken
  at `02:35:04.331Z`, **82.577s after Enter / 15.021s after nonce**, within the
  original 20s capture deadline; it remains the empty prompt. Startup 42.538s,
  typing 2.665s, readback 67.556s and cleanup 1.142s all fit the original budgets.
  Raw points: worker `desktop/report.json:24272`, `:24281`, `:33024`, `:33522`.
- **P4 fixed continuation/no stimulus — HELD.** Start `02:35:04.343Z`, deadline
  `02:38:04.343Z`, finish `02:37:44.601Z`: 160.258s inside one fixed 180s allowance.
  The original screenshot, result, nonce and capture timestamps are unchanged.
  All 630 subsequent wire messages are existing `keyboardLedState` read calls;
  no new physical/serial input, configuration write, agent input or readiness
  event occurs. Cleanup begins after the diagnostic finishes and closes normally.
  Sources: `report.json:33545`, `:34459`; `audit.json` `continuation`, `timing`.
- **P5 pixel binding — HELD.** Independently decoded all five gzip Worker/canvas
  pairs and all five PNGs. Worker format normalization/cropping equals canvas,
  and PNG pixels equal canvas exactly: **zero differing pixels at every
  checkpoint**. Before/after sequence and presented counts agree, pending is
  zero. All eight retained raw frame hashes and final canvas also match.
  Observer bounds/disposal hold: 15 seen, 7 evicted, 8 retained, no errors.
- **P6 visible timing — HELD with retained-evidence limits.** I personally
  inspected all five PNGs. +0/+40s are empty; +80/+120/+160s show the exact typed
  command and returned shell prompt. Cursor-only frame 8 changes 221 pixels
  (x639..653, y400..422) at Enter+125.837s. Frame 9 remains the same. Frame 10
  adds 3022 terminal pixels (x28..641, y52..85) at Enter+155.838s, nonce+88.282s.
  Its raw bytes equal the frame used by the first changed +80s screenshot.
  **No retained pixel evidence demonstrates terminal output within Enter+120s.**
  Frame 7 is still blank at Enter+111.598s; frame 8 arrives after that window.
  Earlier ring entries were evicted, so this verdict does not claim continuous
  pixel coverage or prove that no transient change ever occurred between samples.
- **P7 attacks/coverage — HELD.** The focused gate passes **59/59**, no skips.
  Eight forged reports reject: wrong decoded cache, wrong cap, changed raw nonce,
  extended original deadline, late image promoted to original capture time,
  diagnostic promoted to desktop success, extended continuation deadline, and
  inconsistent frame-count screenshot binding. Three independent checkpoint
  attacks also reject unchanged-sequence/pending drift, present-count drift and
  a later operation crossing the single deadline by 1ms. Original fields and
  source bytes remain unchanged in each fixture. See `audit.json` `attacks`,
  `checkpoint-attack.json`, `focused-tests-localhost.log:65`.

## Exact image/frame relationship

| Requested offset | Captured offset | Worker frame | PNG / canvas content |
| --- | --- | --- | --- |
| 0ms | 3ms | 5 | Empty original prompt |
| 40000ms | 40003ms | 7 | Same empty prompt |
| 80000ms | 80003ms | 10 | Command and returned prompt |
| 120000ms | 120002ms | 13 | Same command and returned prompt |
| 160000ms | 160002ms | 15 | Same command and returned prompt |

The first changed checkpoint captures at `02:36:24.346Z`, Enter+162.592s and
nonce+95.036s. The worker narrative uses the earlier operation timestamp;
the values here use the report's actual `capturedAt`. Frame 10 itself arrived
at `02:36:17.592Z`. The changes comprise 3243 pixels relative to the initial
canvas: 221 cursor pixels plus 3022 terminal pixels. Citations:
`report.json:33888`, `:34640`; `audit.json` `checkpoints`, `retainedFrames`.

Original/+0/+40 PNG SHA-256:
`431be977157bf77dcd21ca8bf3b640bce9e02dc8c54f09a30d58af78a8195b24`.
Changed/+80/+120/+160 PNG SHA-256:
`d05f6a7b8984e0a13c90dd546622c0ead2ff3983b081d5abb7a4e6d8cc9e8381`.
Changed raw frame SHA-256:
`6e1ffa0312c12b67245eaeb9f6e3eac02b699b5ccee6f0998f31410ced8db992`.
Changed canvas SHA-256:
`6564a48cc31b88c0aa36bd55c4382d742391b1020bf63f738096a23aaf0510f1`.

## Coverage and corrected interpretation

The only runtime-facing diff since `9e610792` is the wrapper option hunk in
`tools/verify/omarchy-input-kernel-response.mjs`: CLI admission, explicit late
flag, inherited pixel flag and existing cache experiment selection. The actual
frozen run exercises all four decisions and the preserved product/diagnostic
route. Defaults are unchanged; types/help text are waived as declarative.
Prior AX verifier files, task lifecycle updates and Q's dependency metadata do
not change runtime behavior. No implementation hunk remains unproven.

One worker prose error was corrected during review: its JIT counters were
initially labeled as sampled at continuation end. `report.json:1345` dates
that sample at the original product capture (`02:35:04.343Z`); the corrected
`RESULT.md` now says so. There is no end-of-continuation JIT sample. This
correction does not alter raw evidence or require a rerun.

Report SHA-256:
`f1b74d8d1577b4816f989054b5d6ecfb9587babb25bdc4833c47d0f3c6b1b3c4`.
Receipt SHA-256:
`e290a069d5cce71849d99ef96d37b6bc522c5c8623910577ca331379979cbdc2`.
`audit.json` seals all worker files and records exact bytes, bounds and times.

SUITE: keep the existing late-probe tests and the verifier's forgery/checkpoint
fixtures. Medium-risk harness-only scope needs no runtime rebuild, cold clone,
additional browser boot or deployment.

```sh
DEVELOPER_DIR=/Library/Developer/CommandLineTools /Users/blamy/.nvm/versions/node/v24.20.0/bin/node evidence/omarchy-profile/residency-decoded-cache16384-late-verifier/audit.mjs evidence/omarchy-profile/residency-decoded-cache16384-late-r5
DEVELOPER_DIR=/Library/Developer/CommandLineTools /Users/blamy/.nvm/versions/node/v24.20.0/bin/node evidence/omarchy-profile/residency-decoded-cache16384-late-verifier/checkpoint-attack.mjs
DEVELOPER_DIR=/Library/Developer/CommandLineTools /Users/blamy/.nvm/versions/node/v24.20.0/bin/node --test tools/verify/omarchy-display-late-probe.test.mjs tools/verify/omarchy-input-kernel-response.test.mjs tools/verify/omarchy-input-trial.test.mjs tools/verify/omarchy-user-input.test.mjs tools/verify/omarchy-desktop-live.test.mjs tools/verify/omarchy-owned-trial.test.mjs
```
