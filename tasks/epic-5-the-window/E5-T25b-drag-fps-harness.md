---
id: E5-T25b
epic: 5
title: Measure repeatable real-window drag FPS and bottleneck counters
priority: 525.2
status: in-progress
depends_on: [E5-T25a]
estimate: S
risk: medium
capstone: false
---

## Goal

Build the headed Playwright scenario that drags a real Foot window across the T18
desktop and measures drawn presents over wall time. The result must expose the guest
execution, upload, and present buckets needed by the later baseline instead of
reporting a browser-only animation rate.

## Boundary

Own the deterministic 300-step pointer script, warm-up policy, five-run aggregation,
and machine-readable drag result. Do not implement input hooks or latency-to-photon
measurement; consume T25a's frozen boundary only.

## Deliverables

- `web/bench/desktop-perf.ts` drag scenario and JSON output with FPS p50/p95,
  bytes/frame, instructions/frame, and guest/transfer/present durations.
- A headed pinned-browser runner that records the exact viewport, DPR, browser,
  image, and commit.
- Five retained runs with coefficient of variation and a deterministic null-sink
  attack result.

## Acceptance criteria

- [ ] Five unattended drag runs each complete 300 smooth moves and report CV < 15%
      under the named dev-machine configuration.
- [ ] The real drawn-present counter, not requestAnimationFrame callbacks alone,
      determines FPS; the result includes nonzero attribution counters.
- [ ] The null-sink attack materially craters or rejects the drawn-FPS result and
      cannot pass by counting acknowledged-but-undrawn presents.
- [ ] The result is reproducible from `make verify-E5-T25b` with no inherited
      `RUSTFLAGS`, `CARGO_*`, or logging environment.

## Verification command

make verify-E5-T25b

## Adversarial verification

Run with the null sink, a busy guest, 4x CPU throttle, and DPR 2. Compare the full
present and attribution records, not just the summary FPS, and document which values
are baseline configuration versus stress observations. A window that does not move,
or a run that draws no damage, must fail rather than produce a plausible number.

## Verification log

### 2026-09-06 — worker — IMPLEMENTED

Implementation commit: `765fefcb` (`perf(e5-t25b): measure real desktop drag FPS`).

`make web-build` and `make verify-E5-T25b` passed at the frozen worker head. The
verification target ran syntax checks, five deterministic Node tests, the source/dist
release audit, and a headed Chromium run against the real Foot window. The runner
scrubs `RUSTFLAGS`, `RUST_LOG`, and all `CARGO_*` variables before starting the
server, records the pinned viewport/DPR/browser/image/manifest, and retains the full
present records rather than counting animation callbacks.

The browser evidence is `evidence/e5-t25b/browser/drag-fps.json` (SHA-256
`67f4dbf8723451383b56bf5d8565309c8a91c765d36c6587a6a1960a925860dd`) and
`evidence/e5-t25b/browser/drag-fps.png` (SHA-256
`58b0e53df2ec4c3ef30e8c4d71f349962e0c170b3597849899220ce3655938f1`). Headed
Chromium was `152.0.7977.76`, viewport `1440x1050`, DPR `1`, image SHA-256
`811267cbf96c1e055e31063829580432d5e5e343cff1a975f5fc10664cc2e00e`, and desktop
manifest SHA-256 `935a9fe2bf6022b01ac6147665b9ca59736930b6e265e33069318e4d9cc2ccaa`.
All five runs requested exactly 300 pointer moves and reached at least 300 processed
pointer frames; drawn presents were `92, 94, 100, 100, 114`. The aggregate was FPS
p50 `4.397911607682904`, p95 `4.749077887383471`, mean `4.307047618230559`, and
CV `8.429883380318232%` against the `<15%` limit. Every run had nonzero guest
instruction attribution and guest/present duration buckets; browser and HTTP error
arrays were empty. The null-sink attack returned
`{drawnPresents:0,accepted:false,reason:"no-drawn-presents"}`.

The release audit reported source/dist terminal, page, and perf-module parity, an
exact dual query gate, and an installed-and-cleared scheduler sampler. The worker
submission is ready for a fresh verifier to run the required null-sink, busy-guest,
4x-throttle, DPR-2, no-window, and no-damage attacks. Independent machines, WebKit,
and host-rr legs remain waived by repository policy.

Commands: `make web-build`; `make verify-E5-T25b`; `shasum -a 256
evidence/e5-t25b/browser/drag-fps.json evidence/e5-t25b/browser/drag-fps.png`.

### 2026-09-06 — worker — REWORK IMPLEMENTED

Daybreak Blue's fresh verifier returned `needs-evidence` because the first retained
JSON discarded raw present records, scheduler snapshots, duration samples, pointer
before/after deltas, and the exact head. No runtime behavior was refuted. The
recording writer and release audit were extended in
`a14bf5453a6799a67b5f66e85b4167223580e541` (`test(e5-t25b): retain raw drag
evidence`) to retain and statically require those fields.

The replacement exact-head headed Chromium run succeeded with
`E5_T25B_REQUIRE_HEAD=a14bf5453a6799a67b5f66e85b4167223580e541`. Its JSON is
`evidence/e5-t25b/browser/drag-fps.json` (SHA-256
`8cd005bf639b7638548c18b38a0bb32938b2494b179797aa875ddc5bd70060f7`) and its
screenshot is `evidence/e5-t25b/browser/drag-fps.png` (SHA-256
`d81ba53cbe4146e0be05be40bbbd6c53d9f082910bb7595d32958301b718a059`). Headed
Chromium was `152.0.7977.76`, viewport `1440x1050`, DPR `1`, and the artifact
head matches the implementation head exactly. The five runs requested 300 moves,
processed pointer deltas `303/302/302/302/302`, and retained raw present records
`93/94/92/97/97`, each with a matching present-duration sample count. Guest
instruction attribution was positive in every raw record; scheduler before/after
counters and the full present records are in the JSON. The aggregate was FPS p50
`4.372599578061981`, p95 `5.183019875508211`, mean `4.37681808494884`, and CV
`11.321151210004228%` (<15%). The null sink remained rejected and browser/HTTP
error arrays remained empty.

Focused checks after the rework: `node --test
web/tests/e5-t25b-desktop-perf.test.mjs`; `node
tools/verify/e5-t25b-release-audit.mjs`; `node --check
tools/verify/e5-t25b-browser.mjs`; and the exact-head browser command above.
The previous verifier's DPR-2/busy/4x legs remain environment-limited; the fresh
verifier should rerun them if the local desktop is ready.

### 2026-09-06 — verifier — VERDICT: needs-evidence

- **P1/P2/P3 baseline/drawn attribution — NEEDS EVIDENCE.** Predicted a
  successful exact-head artifact with independently checkable per-run move deltas
  and full present/attribution records. The retained artifact hashes and all
  summary math held: five 300-request runs, drawn presents `92/94/100/100/114`,
  CV `8.429883380318232%`, positive guest and guest/present duration attribution,
  empty browser/HTTP errors, and null-sink rejection. Observed `head: null`, only
  cumulative pointer-frame counts, and no raw present records, scheduler snapshots,
  or duration samples. The current writer also omits those raw records from JSON.
  Retain them and produce one successful exact-head headed-Chromium artifact.
- **P4 no-window/no-damage/null sink — HELD.** The runner requires detected Foot
  chrome and valid titlebar geometry; the pure analyzer rejects null records,
  all-undrawn/no-damage input, missing/zero guest attribution, and regressing
  scheduler counters. FPS is derived from drawn records over wall time.
- **P5 counter attack — NEEDS RECORD EVIDENCE.** NaN and required-counter attacks
  rejected, while duplicate/regressing present sequences and regressing cumulative
  guest totals with supplied nonnegative deltas were accepted. The production
  producer constrains these fields, but the retained artifact discarded the records
  needed to verify that invariant. Serialize and audit them (or reject them).
- **P6/P7 release/env — HELD.** Five deterministic tests and the release audit
  passed under hostile inherited `RUSTFLAGS`, `RUST_LOG`, and `CARGO_*` values;
  direct source/dist comparisons, including roadmap, matched. The runner's spawned
  server environment deletes the required variables.
- **P8 browser stress — ENVIRONMENT-LIMITED.** A bounded current-head headed Chrome
  attempt reached the browser leg but timed out after 120 seconds at
  `tools/verify/e5-t25b-browser.mjs:111`, waiting for `desktopReady`. Cleanup
  completed, but no drag ran, so DPR 2 and busy/4x-throttle were not attempted.
  Retained evidence covers only DPR 1/unthrottled baseline; this timeout is not a
  behavioral refutation.
- **COVERAGE — NEEDS EVIDENCE.** The retained success exercises the unchanged
  runtime and analyzer paths from `765fefcb`; the fresh timeout exercises exact-head
  lookup and `6bc03107` bounded cleanup. The `1f6517a` per-run delta assertion and
  successful exact-head write remain unexecuted. Dist/TS/roadmap declarations were
  waived by byte parity/static reasoning.
- **SUITE:** retained verifier predictions and reusable pure/evidence audit scripts.
  No implementation, test, or harness files were changed.

Full report: `evidence/e5-t25b/verifier-r1/verifier-report.md`.

Commands: `node evidence/e5-t25b/verifier-r1/analyzer-attacks.mjs`; `node
evidence/e5-t25b/verifier-r1/retained-evidence-audit.mjs`; hostile-env Node
checks/tests/release audit and direct source/dist `cmp`; bounded hostile-env
`make verify-E5-T25b` (browser readiness timeout at 120000 ms).

### 2026-09-06 — verifier r2 — VERDICT: refuted

- **Stationary-window rejection — FAILED.** Predicted that a no-motion run
  could not emit plausible accepted FPS. A deterministic browser-like attack
  supplied five runs with 300 requested/processed pointers, valid positive
  stationary drawn records, attribution, and durations. Production summary and
  aggregation accepted mean 15 FPS, CV 0%, and `repeatabilityHeld:true`. The
  browser runner checks Foot geometry only before each drag and checks pointer
  count afterward; it never verifies displacement. Add and retain a before/after
  window-motion signal, reject insufficient displacement before aggregation,
  and add a stationary-window regression test.
- **Retained raw evidence — HELD.** Both artifact hashes and exact producer head
  matched. All 473 records passed sequence/timestamp, boolean, damage/byte,
  instruction total/delta, duration, scheduler, pointer, and aggregate audits.
  The five retained baselines themselves show 286–405 px horizontal damage
  movement and recompute to CV `11.321151210004228%`; null sink rejects.
- **Release/environment — HELD.** Hostile-env syntax checks, 5/5 focused tests,
  updated release audit, source/dist parity, and scrub logic passed. Current head
  differs from artifact head only in this task metadata, so no runtime rerecord
  was required for that delta.
- **Stress — ENVIRONMENT-LIMITED.** A fresh headed DPR-2 attempt timed out at
  `tools/verify/e5-t25b-browser.mjs:111` after exactly 120000 ms waiting for
  `desktopReady`; no drag ran and no artifact was written. Busy/4x were therefore
  not attempted and no stress result is claimed. This is separate from the
  stationary-window refutation.
- **COVERAGE/SUITE.** Baseline producer paths through `a14bf545` are exercised;
  static/mechanical hunks are precisely waived in the report. Retain the raw
  audit and stationary sabotage, promoting the latter after the fix.

Full report: `evidence/e5-t25b/verifier-r2/verifier-report.md`.

Commands: verifier-r2 artifact audit and analyzer attacks; hostile-env syntax,
focused tests, and release audit; source/dist `cmp`; `git diff --check`; image
SHA-256 and Chrome provenance; bounded headed DPR-2 attempt.
