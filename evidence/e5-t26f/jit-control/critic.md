# E5-T26f JIT-control diagnostic — fresh critic

Target `f9f017f5115b9425bf66457e8aeae016107b245d`, scoped against
`fd67c191`; binary-diff SHA-256
`31f5a1c3aff17665ab46aca1db61d815691e55d5de5c22286faf0bfdea7734fd`.
These predictions were recorded after the complete F task and source/test diff were
read, but before either `jit-1` or `jit-0` browser record was inspected. The committed
62-test helper log is part of the reviewed harness submission, not the pending browser
measurement. This review is diagnostic-only and cannot verify F.

## Pre-evidence predictions

1. **Flag and acceptance isolation.** Only the process-environment strings `"0"` and
   `"1"` will be accepted, and only with `E5_T26F_DIAGNOSTIC=reuse`. Missing mode,
   create mode, non-string lookalikes, whitespace/case variants, and simultaneous
   CPU, latency, or command variables (including an explicitly empty value) will reject
   before browser launch/profile copying. Omitted JIT control will keep the existing
   `jit=1` route and issue no new `jitStats` RPC in acceptance, create, or ordinary reuse.
2. **Route plus actual-state proof.** The URL alone will not count. `jit-1` must record
   `jitBefore.state.hasExecutor === true` and `jitAfter.state.hasExecutor === true` from
   the real worker RPC; `jit-0` must record strict `false` at both points. Missing APIs,
   RPC rejection, null/malformed state, or a requested/actual mismatch must fail and be
   present in the first failure artifact.
3. **Original timing boundary.** Both arms will retain
   `postRestoreStart === normalRestore.result.completedAt`. The first JIT RPC will be
   requested only after that T0 and before pointer/physical-key input, so its latency is
   charged to the original two-second budget. Neither RPC may reset T0.
4. **PCM/completion ordering.** Actual terminal completion, immediate positive/non-silent
   PCM, attachment/render checks, and the frozen `postRestoreEnd` must precede the second
   JIT RPC. `jitAfter.requestedAt` must be at or after `postRestoreEnd`; its completion
   may delay reporting but cannot change the value used by the unchanged two-second
   assertion.
5. **Matched-pair identity.** Both records will bind the same head, served-runtime digest
   (`84ef07f7f4ec173dc921a1d91a764f538953600fdccfb3af0eed4aaca57617f9`),
   browser, kernel/image/manifest, sealed profile and snapshot. Both will use ICount,
   key delay 5, and the exact physical `sh /tmp/a`. The only intended route difference
   is `jit=1` versus `jit=0`; browser/HTTP error arrays should be empty.
6. **Counter credibility.** `guestRetired` must increase between before/after in both
   arms because a real guest command completes. With JIT enabled, `retiredViaJit` should
   be positive and nondecreasing; without an executor it should remain zero/absent as
   defined by the existing RPC. Identical stale counter snapshots with only the expected
   `hasExecutor` bit would not support a workload comparison even though the current
   harness's policy assertion may accept them.
7. **Bounded novel attack.** A fake worker returning two identical snapshots with the
   expected `hasExecutor` value is predicted to pass `recordDiagnosticJit` because the
   new guard validates policy identity but not counter freshness. I will sabotage only
   the extracted helper in an isolated VM. If confirmed, actual records must be manually
   checked for monotonic deltas; the narrow hardening ask would be a before/after
   `guestRetired` progress assertion, not a runtime or F-criterion change.
8. **Permitted inference.** One ordered replay per arm can localize this exact sealed
   workload. It cannot establish a production/default policy, generalized speedup,
   statistical effect, or F acceptance. A faster JIT arm is only an observed matched-pair
   result; a slower/equal arm is likewise a negative diagnostic. Either arm exceeding
   two seconds remains an F failure.

## Static boundary review

The source placement matches predictions 1–4: explicit JIT selection overrides only the
pre-existing URL parameter; the first live-state RPC follows the original restore T0;
the second follows immediate PCM/audio capture and frozen `postRestoreEnd`; and the final
assertion still compares that frozen end against the original start. No runtime, WASM,
web asset, image, default, command, key pacing, or deadline line changed in this diff.

## Bounded novel attack — CONFIRMED

I extracted only `recordDiagnosticJit` into an isolated Node VM and supplied a real async
`jitStats` function that returned the same object twice:

`{ hasExecutor: true, guestRetired: 123456, retiredViaJit: 23456, hostEntries: 3456 }`.

Both `jitBefore` and `jitAfter` were accepted; two RPC calls occurred, but all counters
were identical. The helper therefore proves that the requested executor policy reached
an RPC endpoint, not that its returned measurement is fresh. This is a bounded harness
finding, not a runtime or F refutation. A real record with increasing counters can still
be interpreted after independent inspection. The smallest legitimate hardening is to
require `jitAfter.state.guestRetired > jitBefore.state.guestRetired` before treating the
pair as a workload measurement; no assertion about speedup or minimum JIT share follows.

## Authenticated pair review

Canonical artifacts:

| Arm | JSON SHA-256 | PNG SHA-256 | run.log SHA-256 |
| --- | --- | --- | --- |
| `jit=1` | `8019eb6495611139ef6a2e71e91431e312e892ce9591d67f7aa7393f8dbbf782` | `c4aacf2ccf2aa5307470647937f9abab0312a82336707e88cbccb442ec6899c7` | `b1a95adde9af1467382cdfe211f590e03069312db17caff947cd889f92b66d09` |
| `jit=0` | `afee1c19cb82b59f6a4e7384dddc6c5902bca68d6402d6eb87a80ddbf707d13f` | `4f47af34049324ae5132fcbf6d90c9a29238912eeb7dfd9115de60ba9dd1a161` | `3ff9955625b9534919b314a9389df64e83f005f318b56b111a9e3cc1d101d444` |

Both records bind head `f9f017f5115b9425bf66457e8aeae016107b245d`, runtime
`84ef07f7f4ec173dc921a1d91a764f538953600fdccfb3af0eed4aaca57617f9`,
kernel `af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce`,
image `5530d6585776cf61fcedb98f7a2e75b4293d5f805809e5107cc181fa5dc62550`,
manifest `b6257e6c0e6789dee28a4f0a7eae1089193fcec545d467d8a70d245226bb9592`,
profile `778bc49dcdc7551de0b2f6a23e4b32a30ce72dea2c00e425bfdc302820d8fc65`,
and snapshot `4ebdd9f6edb253d940a93082118068c089c844f985b13e0a7593956d6ccf88fb`.
Both are non-acceptance reuse diagnostics with ICount, key delay 5, no CPU/latency/
command override, and physical `sh /tmp/a`.

### Prediction outcomes

- **P1 flag and acceptance isolation — HELD.** Static ordering and the 62 helper tests
  cover exact strings, reuse-only operation, explicit empty conflicts, and no state RPC
  on default/create/ordinary reuse. Helper log SHA-256:
  `f4a8fa4de50dd712da20788169a18ea61cb7b13113401b138ee0ec0e161f7aea`.
- **P2 route plus actual state — HELD.** `jitBefore`/`jitAfter` report
  `[true, true]` for `jit=1` and `[false, false]` for `jit=0`. The disabled arm has
  zero compiled/JIT-retired/cache counters and residency `disabled`; the enabled arm
  reports `repack-off` with cap 24. Missing/malformed/mismatched/error paths are covered
  by helper tests and preserve failure milestones.
- **P3 original T0 — HELD.** In each record `postRestoreStart` exactly equals
  `normalRestore.result.completedAt`. Before-RPC request/receive offsets are
  `261.680/273.185 ms` (`jit=1`) and `264.055/264.655 ms` (`jit=0`), before pointer
  and key activity and charged to the unchanged budget.
- **P4 PCM/end ordering — HELD.** JIT-on PCM appears at `5224.770 ms` and freezes end
  at `5231.120 ms`; `jitAfter` starts at `5231.950 ms`. JIT-off PCM appears at
  `4833.035 ms`, freezes end at `4842.675 ms`, and starts `jitAfter` at
  `4843.475 ms`. Both second RPCs therefore follow immediate PCM and the immutable
  acceptance boundary.
- **P5 matched identity — HELD.** The bindings above are equal, creator profile and
  snapshot are equal, and the requested route is reflected by actual executor state.
  Browser identity is checked against the sealed checkpoint before reuse. The inspected
  canonical screenshots show two real terminal windows and visible cursor. They also
  show an ALSA `underrun!!!` in each arm (`at least 7.379 ms` for JIT-on and
  `at least 0.063 ms` for JIT-off), followed by the completed green conditional marker
  and returned prompt. This is successful XRUN recovery, not an XRUN-free run.
- **P6 counter credibility — HELD in these records.** JIT-on `guestRetired` advances
  `61,972,377`; `retiredViaJit` advances `22,286,932` (35.96% of interval retirements).
  JIT-off `guestRetired` advances `57,973,104` while JIT retirements remain zero.
  Thus the actual pair is not stale despite the harness gap found by sabotage.
- **P7 novel stale-state attack — HELD / HARNESS FINDING.** Two identical snapshots
  with the expected policy were accepted, exactly as predicted. Require positive guest
  retirement progress if this diagnostic is retained as an automatically trusted
  measurement. This does not require rerunning the completed pair, whose progress was
  independently verified.
- **P8 permitted inference — HELD.** Neither arm passes F: JIT-on is `5231.120 ms`;
  JIT-off is `4842.675 ms`. Each child exits 1 solely at the unchanged two-second
  assertion after the interaction/PCM checks. Browser and HTTP error arrays are empty.

## Truthful measurement finding

In this one ordered pair, JIT-on is `388.445 ms` (8.02%) slower than JIT-off. This is
not a policy result: the arms retire unequal guest work over their measured intervals,
there is one observation per arm, order is fixed, and no timing profiler is enabled.
The enabled interval compiles 39 additional blocks, records 656 cache installs, 307
retranslations, 112 evictions, and 881,211 block builds; those counters demonstrate
mixed JIT/interpreter activity but do not attribute the wall-time difference to any one
cost. In particular, neither this pair nor the endpoint counts justify a residency,
default, compiler, or scheduler change.

Both arms nevertheless prove the localized functional boundary: matching first-present
CRC `0a17c914`, fresh HELLO generation 2, no `booting` state, real cursor movement,
20 matching physical keyboard events, green conditional completion with no red marker,
and 1,440 actual PCM frames of which 960 are non-silent (`maxAbs`
`0.082000732421875`), attached to an unlocked/running output. The run logs end only at
`post-restore interaction exceeded 2 seconds`. The HTTP server logs contain only the
allowed favicon 404 and no host-side failure, but they do not capture guest terminal
output and therefore cannot establish XRUN absence. The screenshots instead establish
that both guests underrun and then recover through successful completion; neither shows
a PREPARE error.

## Conclusion

The incremental harness is isolated and the browser measurements are usable as a
manually checked negative diagnostic. It does not verify F, cover deferred coherence/
drag/reload acceptance, or authorize any criterion/default/runtime change. The single
bounded follow-up—now accepted for implementation—is counter-freshness hardening
(`jitAfter.guestRetired > jitBefore.guestRetired`) plus deterministic harness tests.
The inspected pair remains valid incremental evidence because both actual counters
already advance; this harness-only guard does not require another browser replay. All
unchanged CRC, no-reboot, input, H session-fence, T19a XRUN/PCM recovery, and T26i
default-clock results remain carried HELD. No task status or implementation file was
changed.

## Incremental freshness-hardening review

Reviewed the uncommitted, two-file harness diff after the diagnostic pair. Scoped diff
SHA-256: `3343299a81a072d147c148219e1dab00115ce599c8a0e14e643fe0d4f6434e5f`;
runner SHA-256 `4f0c68c5d032df16ac1206bc83969c00088d5d424f845f2c09ba4fe16d37e246`;
test SHA-256 `609f3dd359a34a564f1f9f22f5f0d04a63784cacf45040cfe8c7bcd21860b4b5`.

**Prediction.** Both endpoints must retain the raw RPC observation but reject a
`guestRetired` value that is absent, non-numeric, fractional, negative, non-finite, or
outside JavaScript's safe-integer range. `jitAfter` must additionally reject a missing
valid `jitBefore`, equal count, or decreasing count in both executor modes; `0 -> 1`
must remain valid.

**Observed — HELD.** The implementation validates the current endpoint before using it
and applies strict `retired > before` only to `jitAfter`. Since `milestones[key]` is
assigned before either assertion, malformed/stale raw state remains available in the
failure artifact. The new test covers both JIT modes, stale/reversed/zero after-values,
eight malformed endpoint forms, absent-before ordering, and the valid `0 -> 1` minimum.
All 63 helper tests pass; `freshness-tests.log` SHA-256
`2216b61dfbe856f2fcbdf506e9f173e52e0208de8e128f11579ac1aabc6949e2`.
The scoped two-file diff has no whitespace errors.

**Sabotage — effective.** In an isolated Node VM using the extracted helper, unchanged
code rejected `123 -> 123`. Replacing only `retired > before` with
`retired >= before` made the stale pair pass. Separately replacing only the current
endpoint's safe-integer predicate with `true` made string `"123"` pass as `jitBefore`.
Thus the promoted regression is sensitive to both the strict-progress and endpoint-type
guards; no shared file was modified.

**Incremental verdict: HELD.** This closes the critic's sole JIT-control harness finding.
The already inspected browser pair needs no replay: its observed `guestRetired` deltas
were independently positive (`61,972,377` and `57,973,104`) and therefore satisfy the
new guard. No runtime/default/F criterion changed, and this remains incremental
diagnostic evidence rather than F verification.
