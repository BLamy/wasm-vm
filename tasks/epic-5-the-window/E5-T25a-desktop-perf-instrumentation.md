---
id: E5-T25a
epic: 5
title: Freeze test-only desktop performance instrumentation and injection hooks
priority: 525.1
status: implemented
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

### 2026-09-06 — worker — REWORK IMPLEMENTED

Daybreak Blue's fresh verifier at `47b489e8a86351994a6399bbfe8691979d0c7c5b`
refuted the first submission on two concrete points: asynchronous public input calls
could interleave before their `SYN_REPORT`, and the promised guest-instruction
attribution was absent from each presentation record. Those findings are retained in
`evidence/e5-t25a/verifier/verifier-report.md` and were fixed in
`76ed2b4a` (`fix(e5-t25a): serialize perf frames and attribute guest work`).

The helper now serializes every public operation through one queue, allocating its
sequence number and completing all device events plus sync before the next operation;
failed operations release the queue for later calls. Presentation telemetry now
records `guestInstructions` as the non-negative retired-instruction delta since the
previous present and `guestInstructionsTotal` as the cumulative attribution. The page
perf gate samples the existing scheduler's `retiredInstructions` RPC into that
callback, while normal pages do not install the sampler. Tests cover the two-call
concurrency attack, a 100→175 instruction delta, the null sink, stale/duplicate
input no-ops, out-of-bounds damage, five identical full records, and JS/TS byte
parity.

Final `make verify-E5-T25a` passed at `76ed2b4a`: eight tests, the release audit,
and actual Chromium 152.0.7977.76 and Firefox 132.0 gated-browser checks. The
browser evidence remains `evidence/e5-t25a/browser/results.json` SHA-256
`f82cf35bb1c0db9e425b6bbfc37a5117304be424e1f9318777e1dc165a273d4e` and
`chromium-gated.png` SHA-256
`7b77d08efbfeab64a9b46cf6b3617c86b1e81afd90781a24bf4c2b02893f5547`. The rebuilt
page proof remains 126/126 with zero browser/HTTP errors; its refreshed JSON and
PNG hashes are `48fd7146cefc6ba84976f9d8a602ada2a4d032b6033e3360d06d375434206572`
and `08f0868eab3a05b160505ce9c8596a0783374b7216a2c8b02b2d252983f62513`.

Commands: `make web-build`; `make verify-E5-T25a`;
`E5_DEMO_TASK=E5-T22g E5_DEMO_VERIFIED=1 E5_DEMO_OUT=evidence/e5-t25a/demo node tools/verify/e5-t18e-demo-smoke.mjs`.

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

### 2026-09-06 — replacement verifier — VERDICT: refuted

- **Prior P11 ordering refutation — HELD after rework.** Sixty-four independently
  delayed concurrent move/button trials in both call orders delivered each complete
  evdev frame through `SYN_REPORT`; a mixed five-frame tablet/keyboard burst and a
  rejected-operation recovery attack also preserved unique sequences and queue progress
  (`evidence/e5-t25a/verifier-r2/independent-observations.json:26-162`).
- **Prior P10 attribution refutation — HELD for valid samples.** Source, committed dist,
  and both object schemas emitted totals 100/175 and deltas 100/75 exactly
  (`evidence/e5-t25a/verifier-r2/independent-observations.json:191-231`).
- **Unavailable attribution — FAILED.** The page cache starts as null
  (`web/main.js:25,87`), but the sink coerces `Number(null)` to zero
  (`web/src/sink/presentation.js:277-285`), so a present before the first scheduler
  sample falsely reports total/delta `0/0` instead of unavailable `null/null`
  (`evidence/e5-t25a/verifier-r2/independent-observations.json:8-24,232-277`). A reviewed
  browser artifact independently records the same `0/0` in all four gated Chromium/
  Firefox source/dist cases (`evidence/e5-t25a/verifier-r2/surface-results.json:67-104,178-215`
  and `evidence/e5-t25a/verifier-r2/surface-results.json:278-315,372-410`). Reject
  null/missing values before numeric coercion,
  preserve the baseline, and add the unavailable→100→175 regression.
- **Required attacks/release/demo — HELD.** Stale/duplicate state, sequence uniqueness,
  invalid damage, null sink, five stable fixture records, JS/TS and source/dist parity,
  normal/half/full query isolation, 8/8 focused tests, Chromium 152, Firefox 132, and
  the 126/126 zero-error demo all held. The exact log's browser PNG SHA is misstated as
  `...64b9a46...`; the committed/fresh bytes are
  `7b77d08efbfeab64a9b46cf6b3617c86b1e81afd90781a24bf4c2b02893f5547`.
- **COVERAGE:** helper and sink hunks executed. The no-boot gate does not execute the
  gated scheduler sampler/timer teardown in `web/main.js:907-911,1516-1530`; add a
  deterministic page-level data-flow/teardown exercise with the fix. Full report:
  `evidence/e5-t25a/verifier-r2/verifier-report.md`.
- **SUITE:** retain verifier evidence and promote the null-sampler case after the fix.
  Independent machines, WebKit, host rr/ssh-dev, T25b/T25c, T22c, and merge are out of
  scope. No localhost listener was started in the replacement session and no merge was
  performed.

### 2026-09-06 — worker — REWORK IMPLEMENTED

Daybreak Blue's replacement verifier at `568159e176c52774f72b16eb26b0077fb7b68fee`
found one remaining semantic gap: the initial scheduler sample is intentionally
unavailable (`null`), but `Number(null)` fabricated a `0/0` attribution. The fix is
`368feb2974b9f438fda2c6f4ea751fc31c594d21`
(`fix(e5-t25a): reject unavailable guest attribution`).

`PresentationController` now accepts only a non-negative safe numeric retired-
instruction value; null, undefined, strings, booleans, invalid objects, and sampler
errors remain an explicit `guestInstructions: null` /
`guestInstructionsTotal: null` baseline and do not advance the previous total. The
page scheduler cache applies the same type check before updating the gated sampler.
The regression exercises unavailable → 100 → 175, asserting null/null, 100/100,
and 75/175 in sequence. The release audit now also proves source/dist byte parity,
the dual gate, the type-checked sampler assignment, the 50 ms sampler, and timer
cleanup; the static lifecycle audit is deterministic because the no-boot browser
surface cannot run a Linux controller.

The frozen exact-head `make verify-E5-T25a` passed eight tests, the release audit,
Chromium 152.0.7977.76, and Firefox 132.0. Browser evidence remains
`evidence/e5-t25a/browser/results.json` SHA-256
`f82cf35bb1c0db9e425b6bbfc37a5117304be424e1f9318777e1dc165a273d4e` and
`chromium-gated.png` SHA-256
`7b77d08efbfeab64a9b46cf6b3617c86b1e81afd90781a24bf4c2b02893f5547`.
The rebuilt-page proof remains 126 passed, 0 failed, 126 done, with empty browser
and HTTP error arrays. Its current JSON and PNG hashes are
`0b786e88c8ead85e509d1b1dd09213072816f2b4d3bc35c78563b3be5cc568fd` and
`aaef2ebff2f8abcd6ed9e825831f4299eba5914bae80cf28d8762450b9c37ab1`.
For avoidance of ambiguity, the full browser PNG digest is the 64-character value
above; the earlier verifier shorthand containing `...64b9a46...` was not a digest.

Commands: `make verify-E5-T25a`; `make web-build`;
`E5_DEMO_TASK=E5-T22g E5_DEMO_VERIFIED=1 E5_DEMO_OUT=evidence/e5-t25a/demo node tools/verify/e5-t18e-demo-smoke.mjs`.

### 2026-09-06 — verifier (Daybreak Blue, pass 3) — VERDICT: refuted

- **Unavailable/valid samples — HELD for ordinary values.** Scalar and both object
  callback forms rejected null, undefined, coercible/unsafe/non-finite/negative values
  without advancing the baseline, then emitted 100/100 and 75/175. Source/dist ordinary
  paths matched (`evidence/e5-t25a/verifier-r3/attack-results.json:54-1139`).
- **Parity/lifecycle/isolation — HELD with precise static waiver.** Main and presentation
  source/dist plus helper JS/TS are byte-identical; the scheduler cache has one strict
  raw-number guard; the unique sampler is dual-gated; teardown clears/nulls the timer and
  resets the baseline; the four query combinations are false/false/false/true
  (`evidence/e5-t25a/verifier-r3/static-audit-results.json:3-39`). The submitted release
  audit's lifecycle regexes are over-broad, so they were not accepted as execution proof
  (`static-audit-results.json:40-46`).
- **Exact gate/browser/demo — HELD with listener limitation.** The exact target passed
  syntax, 8/8 focused tests, and release audit before the sandbox rejected localhost bind
  with EPERM. Exact-head Chromium 152/Firefox 132 artifacts and 126/126 demo were parsed,
  hashed, and visually inspected. The full PNG SHA-256 is
  `7b77d08efbfeab64a9b46cf6b3617c86b1e81afd90781a24bf4c2b02893f5547`;
  demo hashes are `0b786e88c8ead85e509d1b1dd09213072816f2b4d3bc35c78563b3be5cc568fd`
  and `aaef2ebff2f8abcd6ed9e825831f4299eba5914bae80cf28d8762450b9c37ab1`
  (`evidence/e5-t25a/verifier-r3/integrity-results.json:3-90`).
- **Prior attacks — HELD.** Delayed ordering, rejected-operation recovery, stale/
  duplicate events, invalid damage, null sink, five stable records, schema parity, and
  release-surface isolation all survived (`attack-results.json:1142-2364`).
- **Novel invalid attribution — FAILED.** A callback returning the supported object form
  with a throwing `retiredInstructions` getter escapes the narrow sampler try/catch. The
  backend draws and drawn/success counters advance, but no null/null sample is emitted;
  `present()` returns false and increments dropped frames
  (`attack-results.json:8-50,3559-3595`; `web/src/sink/presentation.js:271-287`). Contain
  property extraction/normalization errors, preserve the baseline, and add the regression.
- **COVERAGE:** all changed implementation hunks executed or have a precise deterministic
  static waiver; no dead hunk. See `evidence/e5-t25a/verifier-r3/coverage-audit.md`.
- **SUITE:** retain the existing null regression and pass-three attacks; promote the
  throwing-getter case after the fix. No merge or out-of-scope task was started.

### 2026-09-06 — worker — REWORK IMPLEMENTED

Daybreak Blue's pass-three verifier at
`ea18259c072be8cd4d20212fb5d0228b29d1a99b` found one remaining failure: reading an
object-form attribution getter happened outside the telemetry callback's try/catch,
so a hostile getter could turn an already-drawn frame into a dropped presentation.
The fix is `ee4879a3430e5ac387dc7a960c6033d625860aeb`
(`fix(e5-t25a): contain hostile attribution getters`).

`PresentationController` now performs callback invocation and object-property
extraction inside the same diagnostic-only containment boundary. A throwing getter
therefore records null/null, preserves the prior attribution baseline, retains the
successful/drawn counters, returns true from `present()`, and reports the diagnostic
in the controller error list. The promoted regression asserts exactly those outcomes;
source and committed dist remain byte-identical. The release audit was tightened from
cross-block regexes to bounded scheduler, sampler, surface, and teardown blocks.

The exact-head `make verify-E5-T25a` passed nine tests, the strict release audit,
Chromium 152.0.7977.76, and Firefox 132.0. The browser evidence hashes remain
`f82cf35bb1c0db9e425b6bbfc37a5117304be424e1f9318777e1dc165a273d4e` for
`evidence/e5-t25a/browser/results.json` and
`7b77d08efbfeab64a9b46cf6b3617c86b1e81afd90781a24bf4c2b02893f5547` for
`chromium-gated.png`. The built-page proof remains 126 passed, 0 failed, 126 done,
with empty browser/HTTP error arrays; current JSON and PNG hashes are
`0b786e88c8ead85e509d1b1dd09213072816f2b4d3bc35c78563b3be5cc568fd` and
`aaef2ebff2f8abcd6ed9e825831f4299eba5914bae80cf28d8762450b9c37ab1`.

Commands: `make web-build`; `make verify-E5-T25a`;
`E5_DEMO_TASK=E5-T22g E5_DEMO_VERIFIED=1 E5_DEMO_OUT=evidence/e5-t25a/demo node tools/verify/e5-t18e-demo-smoke.mjs`.
