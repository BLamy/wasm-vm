---
id: E9-T18a
epic: 9
title: Own GPU result bytes and completion admission at guest event boundaries
priority: 524.9181
status: implemented
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

- [ ] Record scatter/readback bytes and completion/query/error/fence envelopes at
  their real ordered event boundaries; replay supplies exact recorded effects
  without accepting live host substitutions or advancing past a missing result.
- [ ] Support the admitted production exchange bound with bounded owned payloads
  and atomic admission; do not truncate a result or silently narrow 32 MiB DMA to
  the existing device adapter's smaller inline limit. Failed admission leaves
  guest RAM, rings and committed event position unchanged.
- [ ] An actual RV64 instruction-driven virtqueue/DMA workload has matching CPU,
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
