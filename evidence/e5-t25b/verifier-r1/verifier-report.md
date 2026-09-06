VERDICT: needs-evidence

- **P1/P2/P3 baseline and attribution — NEEDS EVIDENCE.** Predicted an exact-head artifact with five independently provable 300-move runs and full drawn-present/attribution records. Observed SHA-256-exact retained artifacts whose summary math holds: five requested 300-move runs, drawn presents `92/94/100/100/114`, CV `8.429883380318232%`, positive guest instructions and guest/present durations, empty browser/HTTP errors, and a rejected null sink. However, `head` is `null`, each `pointerFrames` value is cumulative with no retained before/delta, and neither top-level run contains raw present records, scheduler snapshots, or duration samples (`evidence/e5-t25b/browser/drag-fps.json:4,19-299`; `retained-evidence-audit.mjs`). The current writer still serializes only `aggregate` and summarized `runs`, not `after.records` (`tools/verify/e5-t25b-browser.mjs:161-215`). Demand: retain full per-run records and before/after counters, then produce one successful headed Chromium artifact stamped to the exact harness head.
- **P4 null/no-window/no-damage semantics — HELD.** Predicted that all three conditions reject. The analyzer rejects an all-undrawn run with `no drawn presents`, and its null-sink assertion returns `accepted:false` (`web/bench/desktop-perf.js:103-105,167-171`; `analyzer-attacks.mjs`). The browser runner waits for non-null detected window chrome and then asserts usable titlebar geometry before every run (`tools/verify/e5-t25b-browser.mjs:126-140`), so an absent/non-window surface cannot enter aggregation. No-damage cannot manufacture FPS because FPS is computed only after at least one `drawn === true` record (`web/bench/desktop-perf.js:103-127`).
- **P5 hostile analyzer inputs — PARTLY HELD / RECORD PROOF NEEDED.** Predicted rejection of non-finite values, missing/zero guest attribution, missing/regressing scheduler attribution, null records, all-undrawn records, and malformed counters. The first set rejected as predicted; exact four/six-run and NaN-FPS aggregates also rejected. The analyzer intentionally accepts 299/301 `expectedMoves`, a 300-point path with identical endpoints, duplicate/regressing presentation sequences, regressing `guestInstructionsTotal`, zero duration buckets, and sums beyond the safe-integer range (`analyzer-attacks.mjs`, command output recorded below). The production runner pins `DRAG_MOVE_COUNT = 300` and computes endpoints 300 pixels apart, so synthetic path-size/duplicate probes do not refute the real runner (`web/bench/desktop-perf.js:5,51-68`; `tools/verify/e5-t25b-browser.mjs:134-159`). But sequence/total coherence cannot be checked against the retained baseline because its raw records were discarded. Demand: serialize the records and validate these producer invariants in the evidence audit (or reject them in the analyzer).
- **P6 source/dist and release audit — HELD.** Predicted byte-identical deployed projections and exact opt-in/sampler lifecycle checks. The release audit passed, direct `cmp` passed for terminal, perf JS/TS, perf hooks, and desktop page, and source/dist SHA-256 pairs matched; roadmap source/dist hashes also matched (`tools/verify/e5-t25b-release-audit.mjs:16-68`). No task projection drift was found. Unrelated pre-existing user modifications to `web/dist/artifacts*.json` were neither touched nor used for this finding.
- **P7 environment isolation — HELD FOR THE IMPLEMENTED BOUNDARY.** Predicted inherited `RUSTFLAGS`, all `CARGO_*`, and `RUST_LOG` would not reach the served browser environment. The runner deletes exactly those keys before spawning the dev server (`tools/verify/e5-t25b-browser.mjs:65-72`). With hostile values set, syntax checks, all five Node tests, and the release audit passed before the browser boot limitation. The browser leg therefore did not prove end-to-end completion under that shell, but no inherited-variable dependency was observed.
- **P8 DPR 2 / busy / throttle — NEEDS EVIDENCE DUE TO THE NAMED ENVIRONMENT LIMITATION.** Predicted fresh stress records if local Chrome could complete. The bounded exact-head DPR-1 attempt ran `make verify-E5-T25b` with a 120,000 ms browser timeout and failed at `tools/verify/e5-t25b-browser.mjs:111`: `page.waitForFunction: Timeout 120000ms exceeded` while waiting for `document.documentElement.dataset.desktopReady === "ready"`. It never reached Foot launch or drag collection, so DPR 2 and busy/4x-throttle attacks were not attempted. This is not treated as a behavioral refutation; the retained artifact covers only headed Chromium, DPR 1, unthrottled baseline.
- **P9 changed-hunk coverage — NEEDS EVIDENCE ONLY FOR CURRENT success bookkeeping.** The retained successful run exercises the unchanged terminal hook activation, sampler, present collection, real-window drag loop, drawn-only summary, aggregation, error gates, screenshot, and null-sink paths introduced by `765fefcb`. The fresh timeout exercised current exact-head lookup/requirement, server launch, page listeners, failure unwinding, and the `6bc03107` bounded process-group cleanup. The `1f6517a` per-run `pointerFramesDelta` assertion/serialization and successful exact-head result write were not reached and are task-claimed behavior, so they are not waived. Byte-copy dist files, the TypeScript re-export, Make target declaration, and roadmap metadata are waived by direct parity/static inspection; tests and release audit executed.

## Scope and orientation

- Repository head: `6bc03107cc72704c5f6e1f939e6147a15625e973`.
- Task implementation range inspected: `4017448c^..6bc03107`, with runtime implementation in `765fefcb`, evidence submission in `ec479c1d`, exact-head/per-run bookkeeping in `1f6517a`, and bounded cleanup in `6bc03107`.
- Working tree already contained unrelated user modifications and evidence. They were preserved and excluded from verifier staging.
- Frozen pre-inspection predictions: `evidence/e5-t25b/verifier-r1/predictions.md`.

## Retained artifact interrogation

Artifact hashes matched the worker log exactly:

```text
67f4dbf8723451383b56bf5d8565309c8a91c765d36c6587a6a1960a925860dd  drag-fps.json
58b0e53df2ec4c3ef30e8c4d71f349962e0c170b3597849899220ce3655938f1  drag-fps.png
```

`retained-evidence-audit.mjs` independently recomputed each run's FPS, bytes/frame, instructions/frame, p50, p95, population standard deviation, mean, and CV. It also matched the retained screenshot digest, the current local desktop manifest digest, and image-info SHA. The screenshot visibly contains a rendered Foot window on the Weston desktop. These checks establish summary consistency, not record provenance: the JSON has no full presentation records and no exact head.

The cumulative pointer-frame values are `308, 610, 914, 1217, 1520`. They are compatible with at least 300 events per later run, but without each run's `pointerFramesBefore` they do not independently prove every run's delta. The implementation added that evidence after the retained run, but no successful artifact exercised it.

## Pure analyzer attack matrix

Command: `node evidence/e5-t25b/verifier-r1/analyzer-attacks.mjs`.

| Attack | Observed |
|---|---|
| 299 / 301 generated moves | accepted as explicitly requested; endpoint-inclusive and unique |
| identical endpoints, 300 moves | generated 300 duplicate points |
| NaN path coordinate / timestamp / bytes / duration | rejected |
| missing, zero, or negative per-present guest attribution | rejected |
| missing scheduler counters | rejected |
| regressing guest or transfer scheduler duration | rejected |
| null record / all-undrawn run | rejected |
| null-sink assertion | returned `{drawnPresents:0,accepted:false,reason:"no-drawn-presents"}` |
| duplicate/regressing presentation sequence | accepted |
| regressing cumulative guest total with nonnegative supplied deltas | accepted |
| zero guest/transfer/present duration buckets | accepted |
| unsafe aggregate byte or guest-instruction sum | accepted |
| four/six runs or NaN aggregate FPS | rejected |

The accepted synthetic path-size cases do not reach the fixed production runner. The accepted record-counter cases matter to evidence sufficiency because the raw baseline records needed to check producer coherence are absent.

## Browser attempt and environment limit

Command (hostile inherited env, verifier-only output, four-minute outer bound):

```text
E5_T25B_OUT=evidence/e5-t25b/verifier-r1/current-head-dpr1
E5_T25B_REQUIRE_HEAD=6bc03107cc72704c5f6e1f939e6147a15625e973
E5_T25B_TIMEOUT_MS=120000
RUSTFLAGS=verifier-hostile RUST_LOG=verifier-trace
CARGO_TARGET_DIR=/tmp/e5-t25b-hostile-target CARGO_BUILD_JOBS=1
make verify-E5-T25b
```

The syntax checks, five deterministic tests, and release audit passed. Headed Chrome launched, but desktop readiness did not arrive within 120 seconds:

```text
page.waitForFunction: Timeout 120000ms exceeded.
at tools/verify/e5-t25b-browser.mjs:111:14
make: *** [verify-E5-T25b] Error 1
```

No result artifact was written. Cleanup completed without hanging, which exercises the final process-group termination hardening. Because even the baseline could not reach readiness in the bound, no DPR-2 or throttled/busy-guest number is represented as verifier evidence.

## Coverage disposition

| Changed area | Disposition |
|---|---|
| `web/desktop-terminal.js` perf gate, present records/durations, scheduler sampler | exercised by retained headed run; source/dist parity held |
| `web/bench/desktop-perf.js` path, summary, aggregation, null sink | exercised by retained summary plus deterministic and hostile analyzer runs |
| Browser Foot detection, 300 mouse moves, five-run loop, summary/error/null gates | exercised by retained successful pre-hardening run |
| Exact Git-head lookup and requirement | exercised by fresh current-head attempt |
| Per-run pointer before/delta assertion and serialization | **needs evidence**; no successful post-`1f6517a` run |
| Successful exact-head JSON write | **needs evidence** |
| Bounded server process-group cleanup | exercised by fresh readiness timeout |
| Release audit and Make target | executed directly |
| Dist copies / TS re-export / roadmap | waived by byte parity and declarative/static reasoning |

## Verdict rationale and next proof

No retained or fresh observation contradicts real-window drag behavior, drawn-only FPS, null-sink rejection, or the reported baseline summary. The deficiency is proof sufficiency: the successful artifact predates exact-head/per-run bookkeeping, and both the artifact and current writer omit the full records the verifier charter requires. This is therefore `evidence-needed`, not `in-progress`.

To clear the gap, a worker may change only the harness/evidence layer: retain each run's raw present records, presentation duration samples, scheduler before/after snapshots, and pointer before/after/delta; then record one successful exact-head headed-Chromium run and repeat the record-level counter audit. When the local browser can complete, include DPR 2 and busy/4x-throttle stress observations separately from the baseline. Runtime semantics were not refuted, so unrelated gauntlet legs need not be repeated.

## Suite disposition

- Retained verifier artifacts: `predictions.md`, `analyzer-attacks.mjs`, `retained-evidence-audit.mjs`, and this report.
- Existing `make verify-E5-T25b` remains the recurring target, but its successful result schema must retain the record-level evidence before it can close this task.
- No implementation, test, or harness file was modified by the verifier.
