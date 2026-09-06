---
id: E5-T25a
epic: 5
title: Freeze test-only desktop performance instrumentation and injection hooks
priority: 525.1
status: in-progress
depends_on: [E5-T09e, E5-T18e]
estimate: S
risk: medium
capstone: false
---

## Goal

Create the narrow, test-only boundary that later performance slices use to inject
deterministic pointer/key events and observe actual display presents. Keep all hooks
out of the normal release surface and make the counters describe drawn damage, not
host calls that a null sink could count.

## Boundary

Own only the feature-gated input injection API, sink-side present/damage telemetry,
and deterministic fixture adapter. Do not choose thresholds, publish baselines, or
change guest scheduling, compositor behavior, or production input semantics.

## Deliverables

- A test-only injection interface for pointer press/move/release and focused keypress
  events with deterministic ordering and no caller-supplied shell command.
- Sink telemetry for drawn presents, damage rectangles, bytes uploaded, and guest
  instruction attribution, with explicit null-sink behavior.
- A fixture/unit target that proves the event sequence and damage intersection
  records are stable.
- A release/feature audit proving the hooks are absent or unreachable in the normal
  build.

## Acceptance criteria

- [x] A deterministic fixture injects the documented pointer/key sequence and receives
      the same ordered guest events and telemetry on five repetitions.
- [x] A present with a damage rectangle records one drawn-present sample and its
      exact rectangle; a null sink cannot report a drawn frame merely because the host
      requested one.
- [x] The feature-disabled/release artifact exposes no callable injection entry point
      and the static audit records the exact command and result.
- [x] Native and wasm/browser-facing telemetry schemas agree byte-for-byte for the
      fixture record.

## Verification command

make verify-E5-T25a

## Adversarial verification

Replace the display sink with a null sink that acknowledges presents without drawing;
the drawn-present count and damage ledger must not claim healthy FPS. Inject a release
without a press, duplicate a sequence number, and submit an out-of-bounds rectangle;
each must be rejected or recorded as an explicit no-op without corrupting the next
valid event. Audit the release artifact for the hook symbol and feature string.

## Verification log

### 2026-09-06 — worker — IMPLEMENTED

Implementation commit: `2fd093b2181b5fdcfe2e2e41b61f3b60d4fc9edb`
(`perf(e5-t25a): freeze desktop telemetry and input hooks`).

`make verify-E5-T25a` passed at the frozen implementation head. The command ran
`node --check` for the helper and presentation controller, seven Node tests including
the existing presentation suite, the release audit, and the opt-in browser harness.
The deterministic fixture repeats move/press/release/key-down/key-up plus one drawn
damage record five times and compares the complete event, controller-call, telemetry,
and GPU-counter records byte-for-byte. A stale release is an explicit frozen no-op;
duplicate button state is also a no-op; an out-of-resource damage rectangle is rejected.
The null backend acknowledges a present but records `drawnPresents: 0` and
`drawnBytes: 0`.

The browser evidence is `evidence/e5-t25a/browser/results.json` (SHA-256
`f82cf35bb1c0db9e425b6bbfc37a5117304be424e1f9318777e1dc165a273d4e`) and
`evidence/e5-t25a/browser/chromium-gated.png` (SHA-256
`7b77d08efbfeab64b9a46cf6b3617c86b1e81afd90781a24bf4c2b02893f5547`). Chromium
152.0.7977.76 and Firefox 132.0 both exercised the gated helper and produced the
same `e5-t25a-v1` pointer record and ordered tablet calls; the normal query exposed
no `window.__desktopPerf`. The JS/TS helper projections are byte-identical, and the
native Node fixture and both browser records use the same frozen schema.

The static release audit reported
`{"productionImport":false,"productionPageSurface":false,"hookVersion":"e5-t25a-v1"}`
for source and committed `web/dist`. The built-page proof was run with
`make web-build` followed by
`E5_DEMO_TASK=E5-T22g E5_DEMO_VERIFIED=1 E5_DEMO_OUT=evidence/e5-t25a/demo node tools/verify/e5-t18e-demo-smoke.mjs`:
126 passed, 0 failed, 126 done, zero browser/HTTP errors, and the existing verified
roadmap entry remained visible. Its JSON and screenshot hashes are respectively
`6f24033ba99cd86c33207140036e4e1c201cb2f4d51774469becedcde1567b97` and
`261ac71d2c2b378aeb93210992eeaf175e5b9fc12f0011f3134e30404af1ac4c`.

Independent-machine, WebKit, and host-rr legs remain waived by repository policy.
This slice freezes instrumentation only; drag-FPS aggregation belongs to E5-T25b and
input-to-photon latency belongs to E5-T25c.

Commands: `make verify-E5-T25a`; `make web-build`;
`E5_DEMO_TASK=E5-T22g E5_DEMO_VERIFIED=1 E5_DEMO_OUT=evidence/e5-t25a/demo node tools/verify/e5-t18e-demo-smoke.mjs`;
`shasum -a 256 evidence/e5-t25a/browser/results.json evidence/e5-t25a/browser/chromium-gated.png evidence/e5-t25a/demo/demo-suite.json evidence/e5-t25a/demo/demo-suite.png`.

### 2026-09-06 — verifier (Daybreak Blue) — VERDICT: refuted

- **P1 exact-head gate — HELD.** At `fc7bfdf5e6aa503e853ab85e48d4ea656dbede77`,
  `make verify-E5-T25a` passed seven Node tests, the release audit, Chromium
  152.0.7977.76, and Firefox 132.0. The fresh browser JSON and screenshot byte-match the
  worker evidence (`evidence/e5-t25a/verifier/make-verify-success.log:1-23`).
- **P2–P6 fixture and required attacks — HELD.** Five complete records were byte-stable;
  stale/duplicate pointer and key transitions were unique-sequence no-ops; invalid
  damage left the next valid record/counters intact; and an acknowledging null sink had
  one successful present but 0 drawn presents/bytes
  (`evidence/e5-t25a/verifier/attack-results.json:3-242`).
- **P7–P9 release and schema — HELD.** Source/dist normal and half-gated pages neither
  exposed the surface nor requested the helper; both gates were required. Actual source
  and dist presents emitted drawn telemetry, and the full deterministic Node/Chromium
  fixture serialized byte-for-byte identically
  (`evidence/e5-t25a/verifier/surface-results.json:5-167`). All retained JSON/PNG hashes
  recomputed, and the stored demo is 126/126 with empty browser/HTTP error arrays.
- **P10 guest attribution/coverage — FAILED.** Deliverable lines 30-31 require guest-
  instruction attribution, but the sink record at `web/src/sink/presentation.js:330-340`
  has no such field and a scoped search found none in source, tests, or dist. Implement
  and deterministically exercise the attribution. Other behavioral hunks executed;
  generated/declarative lines and defensive catches/caps are classified in
  `evidence/e5-t25a/verifier/coverage-audit.md`.
- **P11 novel deterministic-order attack — FAILED.** Concurrent calls received records
  1 and 2 but delivered X(seq1), button(seq2), sync(seq2), Y(seq1), sync(seq1), splitting
  sequence 1's evdev frame (`evidence/e5-t25a/verifier/attack-results.json:243-332`). The
  failure repeated three times. Serialize helper operations through each sync, then
  rerun the medium-risk submission because runtime semantics change.
- **Evidence:** `evidence/e5-t25a/verifier/verifier-report.md`; attack-results SHA-256
  `5238d640452f9dab469b766f1500bc2d030ea6223535e0ad534cbc44ef0b1aef`; surface-results
  SHA-256 `79c07a2c1c46c9c4d68a01eaad9c4cf7737401c2b64ee238232b125df9859272`.
- **SUITE:** retain verifier evidence; no promotion until the two semantic refutations
  clear. Independent machines, WebKit, host rr/ssh-dev, T25b/T25c, and T22c are waived
  or out of scope. No merge performed.
