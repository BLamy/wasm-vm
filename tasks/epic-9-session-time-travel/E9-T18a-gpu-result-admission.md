---
id: E9-T18a
epic: 9
title: Own GPU result bytes and completion admission at guest event boundaries
priority: 524.9181
status: verified
depends_on: [E9-T17, E9-T09, E9-T14]
estimate: S
risk: high
capstone: false
---

## Goal

Make native guest-visible GPU DMA and completion effects deterministic inputs.

## Boundary

The native GPU result adapter and exact event-boundary admission. Bind immutable
result bytes, request/context/backing identity, exchanges and fence/error outcomes
to their actual guest-visible positions. Host completion callbacks retain owned,
revocable mailboxes and never borrow Machine reentrantly. Snapshot/pending restore
is E9-T18b; Wasm/durable/hardware presentation integration is E9-T18c. Until those
are accepted, unsupported recording/keyframe profiles remain explicitly gated.

## Acceptance criteria

- [x] Record scatter/readback bytes and completion/query/error/fence envelopes at
  their real ordered event boundaries; replay supplies exact recorded effects
  without accepting live host substitutions or advancing past a missing result.
- [x] Support the admitted production exchange bound with bounded owned payloads
  and atomic admission; do not truncate a result or silently narrow 32 MiB DMA to
  the existing device adapter's smaller inline limit. Failed admission leaves
  guest RAM, rings and committed event position unchanged.
- [x] An actual RV64 instruction-driven virtqueue/DMA workload has matching CPU,
  RAM, response/ring and GPU virtual-state witnesses under changed host result
  bytes and completion schedules. Missing/corrupt/wrong-intent/stale results have
  explicit outcomes. This native proof does not claim physical GPU presentation.

## Deterministic acceptance

`make verify-E9-T18a`. Implement one deterministic native result-admission command
with guest traces, exact state/effect digests and recorded failures, plus the
high-risk submission required by AGENTS.md. No passing command is claimed yet.

## Adversarial verification

Vary upload/draw/readback timing and returned bytes. Corrupt one recorded result,
duplicate/reorder an exchange, exhaust a payload/batch bound and deliver an old
mailbox reply. Require precise refusal/divergence, no partial DMA/ring effects,
no live replay substitution and no unresolved control request. Prove the test
detects one removed admission/identity guard. Pending capture remains refused
until E9-T18b, rather than silently losing owned results.

## Verification log

### 2026-10-21 — worker — start native result boundary

Selected after independently verified and publicly deployed E9-T17. This is the
first replacement for the E9-T18 planning container. Runtime implementation and
recorded acceptance are pending; only this task enters the active lane.


### 2026-10-21 — worker — implemented submission

Runtime frozen at `3b84dd50076d4525c04e88bbd5726fc978bd54a2`;
proof-only follow-up `07446481f2a02e16105a3782738f819352eff948` changes only
integration tests and the module's `cfg(test)` suffix. The runtime prefix is
byte-identical and the published Wasm remains 2,361,401 bytes, SHA-256
`eaf24659537e2cd79def0e49b698fdd3ced525998dc9332ba8d286538d13a35e`.

- High-risk local wall: `python3 -B tools/verify/e9-local-gauntlet.py --task
  E9-T18a --output /Users/blamy/Documents/Codex/e9-t18a-gauntlet-3b84dd50`.
  Report SHA-256 `57fee16c9e4ad15b42dce084ae26fc89c0ef3f75de538688cd8ccbe5e2c4cf30`.
  Strict production Clippy passed. `make ci` stopped with exactly the five
  historical quarantined `zicsr-stub` dead-code diagnostics; the scoped stub-only
  rerun and every remaining native/Wasm/feature/RISC-V/determinism/performance
  target passed. The recorder retains exact diagnostics and commands. Duration
  2,039.52 seconds; all three catalogued logs were independently rehashed.
- Complete pristine-clone acceptance at
  `/Users/blamy/Documents/Codex/.e9-t18a-proof-cold-3b84dd50`:
  `python3 -B tools/verify/e9-gpu-results.py --output
  /Users/blamy/Documents/Codex/e9-t18a-final-cold-3b84dd50` (the sole recipe of
  `make verify-E9-T18a`). All 13 commands passed, including 11 native integration
  tests, nine control/codec tests, 52 ordinary GPU regressions, source/clock
  regressions, no-std Wasm, production Wasm Clippy and built-page verification.
  Report SHA-256 `f6dff049d0eb28ca4f846b3ebd82c3db6b740cf6dfcfb7993df76b1b30a5cb07`;
  130 files / 325,709,109 bytes independently rehashed. Browser report SHA-256
  `2fcbf85c5c2cb6a8bb3194f9aa0897de704f70545df6f3116f8953aeef008333`:
  127 passed, zero failed, zero console/HTTP errors, native capability in-progress,
  full GPU replay in-progress, T17 keyframes verified. Screenshot and trace are
  under `browser/`; trace SHA-256
  `41116de0c345f53b039151cd05b18b68bdb4986dab333c2b7c278f2e4672e561`.
- Incremental proof after the fresh critic's read-only preliminary G1–G4 report:
  new pristine clone
  `/Users/blamy/Documents/Codex/.e9-t18a-final-gaps-cold-07446481`;
  `python3 -B /tmp/e9-t18a-record-gaps.py --root
  /Users/blamy/Documents/Codex/.e9-t18a-final-gaps-cold-07446481 --output
  /Users/blamy/Documents/Codex/e9-t18a-final-gaps-07446481`.
  The executed recorder is retained and hashed inside that evidence directory.
  Report SHA-256 `c1bb230369158767160a314e9f8625d71c1991fd5d532da6ae60ce13d33f169e`;
  68 files / 111,296,396 bytes independently rehashed. Policy, format, strict
  affected-test Clippy and seven new tests passed. Raw CPU/RAM/GPU/trace pairs
  independently match before/after count/byte/legacy refusals; drain/retry resolves
  the original guest fence. Nineteen invalid wire bodies, actual persisted kind7
  decoding, wrong mode/position/hash/generation, supported control-only installation
  refusal and the prepared-frame dispatch cap are recorded. This proof-only
  response carries unchanged prior gates under AGENTS.md's incremental policy.

The recorded RV64 program configures the actual virtqueue, publishes available
heads, writes GPU MMIO notifications, polls used-ring completion and loads the
readback/fence into architectural registers. Across altered host bytes and
schedules, full CPU sections, every RAM byte, response/rings, GPU virtual state,
result receipts and instruction traces match. The 32 MiB production exchange is
retained in full; count/byte exhaustion and wrong ownership refuse before partial
effects. Synchronous recorded failures skip physical allocation; recorded success
requires reconstruction. Asynchronous callbacks remain owned mailboxes; logical
DMA/completion admission is ordered separately from physical transport. Native
sinks establish guest effects. Pending keyframes, durable Wasm/physical GPU replay
and that physical presentation evidence remain explicitly gated for T18b/T18c.

Fresh critic session `01a15e27-9b2d-7a61-b659-45373c5700b1` has already retained
independent descriptor-authority, changed-schedule, corrupt-control and early-
completion probes plus a guard-removal sabotage that failed as expected and passed
following restoration. Its preliminary report found proof gaps and no semantic
contradiction. This worker submission awaits that session's final independent
coverage review and verdict; only the verifier may set `verified`.


### 2026-10-21 — verifier

VERDICT: verified

Fresh critic session `01a15e27-9b2d-7a61-b659-45373c5700b1`. Runtime
`3b84dd50076d4525c04e88bbd5726fc978bd54a2`, proof-only response
`07446481f2a02e16105a3782738f819352eff948`, formal submission
`41c92574926fb35a218bfb949e81206d4a8f907f`. The initial read-only session's
HELD results carry: all 218 retained critic artifacts rehash unchanged. Only
three verifier regression tests are promoted; no runtime implementation changed.

Final evidence base:
`target/evidence/e9-t18a-standard-verifier/3b84dd50/final-07446481/`.
Predictions were recorded in `predictions.md` before new raw state was opened.

- **AC1 / P1–P3, P7, P17–P19 — HELD.** Exact recorded DMA/results and
  completion/error/fence outcomes survive changed live bytes and schedules.
  Independent G1 refusals execute at Before162, and stale completion generation
  refuses at Before194 (`independent.log:94-99`). Kind7 serialized tape
  decoding/replay and all 19 independently reconstructed malformed wire bodies
  hold (`independent.log:101`, `submission-audit.json` codec entries). No missing
  result advances retirement or admits a live replacement. G1/G2 are closed.
- **AC2 / P4–P5, P21–P22 — HELD.** Carry the exact 32 MiB payload and record-side
  limits. Replay's 257th small receipt and third 32 MiB receipt return Limit at
  transition161, ordinal256/2, sequence260/6 (`independent.log:103-104`). Full
  before/refused CPU/RAM/GPU/trace pairs match byte-for-byte. Refused RAM hashes
  are `e61317da525e1ee83d4dcbec27a668171a045210c0b59e5427e366a24ec7802c`
  and `46fc31cf36372f2d6df3d11a1a389b81908f6613ef7293b810841781ba5ee851`.
  Drain/retry then resolves the original fence once, usedidx5/head8/len24.
  Legacy's backing-valid 32-byte gather for a 64-byte rectangle refuses before
  shadow/exchange/event mutation; its refused RAM hash is
  `bd767993982587348e9592c83247062702bc8268ad4217ec9319b4d27482bea8`.
  The valid retry changes the retained shadow from zero to exact 6d bytes and
  resolves the fence (`independent.log:92`). G4 is closed.
- **AC3 / P6, P8–P9, P11–P12, P14–P15 — HELD.** Carry real RV64 virtqueue/DMA
  traces and full CPU/RAM/response/ring/GPU equivalence under independent
  schedules 5/11/23, authentic stale-post refusals, pending-capture refusal,
  descriptor rewrite isolation, corrupt control refusal and early completion
  ordering. The prior intent-guard sabotage fails at `Ok(())` versus
  `Err(Intent)` and passes after byte-exact restoration
  (`../sabotage-intent-disabled.log:9-12`, `../probes-report.json`).
- **P20 / G3 — HELD.** The forwarding probe observes 100→7 and 3→3, reaches
  exact Before7 with budget0, and removal restores100 without retirement
  (`independent.log:83`). Instrumented `admission.rs:178-184` and
  `session_clock.rs:737` execute; this is a budget claim, not JIT/GPU rendering.
- **P16 / G5 — HELD.** The runtime prefix SHA remains
  `ffef8fc9db8257f91cf066a6e5fd7eb00158f625bf86def5ccbb74ffb4b58286`;
  published Wasm remains the worker's exact 2,361,401 bytes/hash. The completed
  2,039.52-second wall, three catalogued logs and full cold report rehash to
  the submitted digests. Strict production Clippy passes; the only exception
  is exactly the five historical stub diagnostics with its scoped passing
  rerun and all remaining targets passing. The 13-command cold acceptance
  (including built-browser127/0, zero errors) carries unchanged. G5 is closed.
- **P23 / COVERAGE — HELD.** All 145 submitted text/binary hunks across 32 files are classified: 58 executed, 87 waived, zero dead and zero needs-evidence. No dead or needs-evidence
  hunk remains. Per-line LLVM counts and source mappings are retained; every
  zero-counter changed source line has a specific held execution citation or
  waiver in `zero-line-dispositions.json`. Waivers cover declarative metadata,
  assertion/trait scaffolding, private repeated preconditions, cryptographic
  collision defense, compatibility paths already executed by the recorded
  regressions, and explicitly closed B/C paths. Coverage SHA-256:
  `ead890c0989455da15b063d7b92ae2e42f1f4ed49498313a2814580aceb8681d`. See `coverage.json` and `coverage-closure.log`.
- **P24 / citation correction — HELD.** The fifth notification STORE is
  `native/small/record.trace:158`, PC80002274, instruction0400a823; line159 is
  the following used-ring load, not the notification. The helper observes
  pending at Before159. Trace SHA-256
  `b1f194bf8c459a02ea1fc35f3a5e3bffc14af8fbb80c417c7a45c9cf89df6342`.
  `submission-audit.json` retains the exact correction and all five kick lines.
- **P25–P26 / SUITE — HELD.** Promoted the three verifier tests for accepted
  descriptor authority, corrupt control publication refusal and early physical
  completion. They also prove sticky-source transport refuses Admission and a
  completion with exchange1 after two exchanges refuses Intent without partial
  state or later retirement. Raw before/refused pairs match; instrumented
  `admission.rs:140` executes once and `submit3d.rs:462` twice. Three promoted
  tests, affected strict Clippy and formatting pass
  (`promoted-v2/promoted-report.json`, `remaining-guards.json`).

Independent audit SHA-256: `39390b7801d105d487554baf541f3f43ce18bf0a1423455b0e90e9fdc1bd79cf`
(`submission-audit.json`); all 62 incremental native files also byte-match the
independent seven-test rerun. `receipt.json` binds final evidence; workflow and
commit receipts are retained alongside it. Tests/fixtures/evidence alone changed
after the frozen runtime, so unrelated gates were carried under AGENTS.md's
incremental policy. Commands: `run-independent.py` (seven gap tests with LLVM
coverage); `run-promoted-v2.py` (format, strict affected Clippy, three promoted
tests); byte/catalog auditors; task policy before queue regeneration.

This verifies the native A boundary only. Pending keyframes remain E9-T18b;
Wasm/durable/physical GPU replay remains E9-T18c. No physical presentation claim,
runtime fix, deployment, merge, push or advancement of B was made.


### 2026-10-21 — publication — main site verified

Released verified native capability metadata and task ledger at source
`6789429c74284a8e3b4426520fc9f2d223fc21cd`, after verifier commit `8a53718eb`.
`bash tools/deploy-cloudflare.sh` completed production deployment `3a893fc5`
with `--branch main`; public URL is <https://wasm-vm.pages.dev/>. All pinned
large R2 artifacts matched their expected bytes before the Pages publication.
Deploy log SHA-256:
`37a698b93ec6701f120a3f570e31999b95181bf9f5ce811476210e13b5eaeb87`.

`node tools/verify/e9-gpu-results-browser.mjs --output
 target/evidence/e9-t18a-production-3a893fc5 --url https://wasm-vm.pages.dev/
 --capability-status verified` passed on the actual main URL: 11 exact served
assets (including Wasm and both case-study pages), 127 passed / zero failed,
zero console and HTTP errors, native result pip verified, complete GPU replay
still in-progress and T17 keyframes verified. Report SHA-256
`f59764ba5048b1b32179249f3fad9349817c73f7c20a9702151f0d2f710c1efa`;
recorded browser trace SHA-256
`51ebd93682b0c73110520ac3ee832b9ae52d04964d3871a28dd0a62eebfb39ea`.
The screenshot, executed checker and exact asset hashes are retained alongside
the report. The five deployment-only R2 manifest rewrites were preserved in
`target/evidence/e9-t18a-release-6789429c/deployed-manifests/`, then only those
generated files were restored to their committed local-build versions. PR #594
remains open in the native stack; no merge was requested or performed.
