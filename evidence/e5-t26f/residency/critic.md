# E5-T26f residency-control diagnostic — fresh critic

Pre-evidence review against base `5bf283efca46dae9697c610d59364eeb76eb5f52` and
the current uncommitted browser/harness worktree. I read the complete F task and scoped
diff before inspecting any new residency browser evidence; none existed at prediction
time. The implementation is still being frozen, so source and diff digests are deferred
until the coordinator supplies the exact head. This is a diagnostic critic record, not
an F verdict.

## Falsifiable predictions

1. **Desktop option and unchanged default.** With no `jitResidency` query parameter,
   `startLinuxBootWorker` will receive `undefined`, leaving the loader's existing
   `repack-off` default authoritative. Exact query bytes will be forwarded without
   normalization. For unsupported/empty/case/whitespace variants, the existing WASM
   `enable_browser_jit` validator must refuse the requested JIT selection before machine
   mutation; the existing loader catches that gate exception, warns, and falls back, so
   no whole-guest-boot rejection is predicted. This option must not auto-enable JIT or
   alter clock, quantum, audio, snapshot, or persistence settings. Invalid diagnostic
   environment labels still reject before browser launch, and live executor/policy/cap
   checks must reject any fallback that does not match the explicit diagnostic request.
2. **Diagnostic isolation.** `E5_T26F_DIAGNOSTIC_RESIDENCY` will be accepted only in
   `reuse` mode, only with explicit string `E5_T26F_DIAGNOSTIC_JIT=1`, and only for
   exact `repack-off`, `cap-256`, or `cap-1024`. Missing/JIT-off/non-string JIT values,
   create/default mode, malformed labels, and any CPU/latency/command override—including
   an explicitly empty variable—must reject before browser work. The run must remain
   `acceptance:false`, ICount, key delay 5, and physical `sh /tmp/a`.
3. **Actual worker policy, not URL intent.** At both `jitBefore` and `jitAfter`, the live
   worker RPC must report `hasExecutor === true`, the requested policy, and its exact
   existing cap (`repack-off -> 24`, `cap-256 -> 256`, `cap-1024 -> 1024`). A missing,
   malformed, stale-policy, wrong-cap, or endpoint-changing response must fail while
   retaining the raw observed state in the first failure artifact. Omitted residency
   must neither access policy/cap fields nor add an RPC to either pre-existing JIT arm.
4. **Freshness and original T0 remain intact.** Both endpoint retirement counts must be
   safe nonnegative integers and `jitAfter.guestRetired` must strictly exceed
   `jitBefore.guestRetired`. `postRestoreStart` must equal the restore's original
   `completedAt`; the before RPC is charged inside that budget. Terminal completion,
   immediate positive/non-silent PCM and attachment checks, and frozen `postRestoreEnd`
   must precede the after RPC. Neither policy observation may reset or extend the
   unchanged two-second assertion.
5. **One new seal and four private reuses.** With no checkpoint override, the comparison
   driver will create exactly one checkpoint from the newly built served JS, then run
   four separate copied-profile children in ABBA order:
   `repack-off`, `cap-256`, `cap-256`, `repack-off`. Existing output directories/files
   must be refused. Every child must bind the same exact final head, served-runtime,
   browser/checkpoint identity, kernel, image, manifest, profile digest, snapshot digest,
   origin, command, clock, and key pacing; only the requested residency policy/cap and
   resulting execution may differ.
6. **Failure admission is narrow.** A child may complete normally or exit 1 only with
   the exact retained F error `post-restore interaction exceeded 2 seconds`. Any other
   exit code, signal, missing record, phase/error message, browser/HTTP error, absent
   restore, cold `booting` state, missing marker/visual change, detached/silent PCM, or
   incorrect policy/cap must abort the aggregate without writing a successful comparison.
7. **Counter evidence is bounded.** Each result must retain raw before/after timestamps
   and states plus nonnegative deltas, with positive `guestRetired` and
   `retiredViaJit`. These counters bracket two RPC completions and include guest work
   outside the exact terminal/PCM window; they are not exact frozen-window counts.
   Counter differences can describe this run but cannot identify a single runtime cost.
8. **ABBA interpretation.** All four ordered observations must be reported—no fastest-run
   selection. Two samples per policy may reveal a gross order/warmth effect but cannot
   establish statistical significance, a generalized speedup, or a production/default
   policy. A cap-256 win, loss, tie, or mixed result is only a hypothesis screen. Any arm
   over two seconds remains an F failure; even a sub-two-second diagnostic arm does not
   prove deferred drag/coherence/second-reload acceptance.
9. **Guest-visible recovery remains explicit.** Every retained child screenshot/record
   must show the real conditional green completion and prompt, actual fresh PCM, cursor
   and typed input. Any visible ALSA underrun must be reported as XRUN followed by
   successful recovery—not inferred absent from HTTP/server logs. Prior H session-fence,
   T19a XRUN/PCM recovery, T26i ICount default, and earlier F CRC/no-reboot/input findings
   carry HELD only where these boundaries remain unchanged.
10. **Bounded critic attacks after freeze.** I will independently (a) remove/neutralize
    the one desktop forwarding member and require its focused test to fail, and (b)
    sabotage one endpoint to return the correct policy with the wrong cap or to switch
    policy between endpoints; the diagnostic must reject and retain the raw mismatch.
    If either sabotage remains green, the new boundary is not sufficiently falsifiable.

## Preliminary coverage disposition

- `web/desktop-terminal.js`: one forwarding member; must be exercised by the focused
  production-call extraction test and actual browser worker state.
- `tools/verify/e5-t26f-browser-roundtrip.mjs`: selection, query, live policy/cap,
  freshness, T0, and PCM/end ordering require focused Node checks plus each browser arm.
- `tools/verify/e5-t26f-residency-comparison.mjs`: checkpoint creation, all four ABBA
  children, exact-F-failure admission, identity equality, counter extraction, head
  stability, and no-overwrite output require the final aggregate record/log.
- Focused runner and desktop tests: deterministic candidates for retention if the
  sabotages are effective.
- Make/test-list and generated mirrors are declarative/build coverage only; no new
  runtime semantics follow from them.

No source finding is raised before the helper tests and frozen browser artifacts arrive.
No runtime, task status, queue, default, criterion, or unrelated file was changed by the
critic.

## Frozen-head static and deterministic review

Runtime/harness head: `de9c9feae6e20dd906145fb5fab3913666b18f8a`; base:
`5bf283efca46dae9697c610d59364eeb76eb5f52`; binary-diff SHA-256:
`51b19d42e5611673255046c3ea0acbf70aeab2e99c6087b6656453cb13362c10`.
There is no diff under `crates/core`, `crates/wasm`, or `web/pkg`. Source, package,
and dist WASM are byte-identical at SHA-256
`30c8f2ab3b1f3c25db77c03d6161d39e55de7ea3d88447f83f5d7942952c3a28`.

The focused submission records 122/122 JS checks passing; helper-log SHA-256:
`c10d13bfd210d50271b1db2ec866fe0d697ad1f4452392f06d7ad9d96befd30b`.
The web build log is SHA-256
`2a8d411d8896ad0fad71cd94af548da3f74336c2e2672d4c56a3685a4c9e8187`.
`web/desktop-terminal.js` and its dist mirror are byte-identical at
`396ce5320f24aea5343e621a2907022db6104b93cacd52946031f44c29ec4fc0`;
the scoped changed files have no whitespace errors.

### Prediction ledger before browser evidence

- **P1 desktop option/default — HELD statically and deterministically.** The production
  boot-call test executes the actual query declaration and full worker options object.
  Omission remains `undefined`; all three existing labels and unsupported raw labels are
  forwarded unchanged. The unchanged WASM validator refuses an invalid policy before
  mutation, while the unchanged loader owns warning/fallback and the default. This is a
  forwarding result, not a claim that an invalid page query aborts guest boot.
- **P2 diagnostic isolation — HELD deterministically.** Exact labels require reuse plus
  explicit string JIT `"1"`; JIT-off/missing/malformed values, non-reuse modes, and
  CPU/latency/command conflicts reject. Metadata remains non-acceptance with unchanged
  command, ICount and key pacing.
- **P3 actual policy/cap — HELD deterministically.** Both endpoints reuse the existing
  state RPC and demand exact mappings 24/256/1024. Omitted policy does not read cap/policy
  fields. Mismatch tests retain raw observations in the first failure artifact.
- **P4 freshness/T0/PCM ordering — HELD deterministically.** Prior freshness hardening
  and T0/PCM/end tests are unchanged and included in the 122 checks. Browser execution
  remains pending.
- **P5 one seal/four private reuses — HELD by static control flow; browser pending.** With
  no checkpoint override, the driver creates once, then invokes four reuse children in
  ABBA order and refuses pre-existing child/report paths. Final evidence must contain the
  new checkpoint and all four children before this becomes observed coverage.
- **P6 narrow failure admission — HELD by static control flow; browser pending.** A
  signalled child, non-0/1 status, missing canonical file, or any error other than the
  exact F cap aborts before comparison output. Functional assertions are evaluated before
  a child is retained.
- **P7 counter bounds — HELD by static control flow; browser pending.** The aggregate
  preserves endpoints and computes only safe, nonnegative deltas, additionally requiring
  positive guest and JIT retirement. The report does not label these as an exact frozen
  interaction window.
- **P8 ABBA interpretation — pending measurements.** The script retains every arm in
  order and hard-codes `fVerified:false`; no ranking or default mutation exists.
- **P9 guest-visible recovery — pending records and screenshot inspection.** HTTP logs
  will not be used to infer XRUN absence.
- **P10 critic sabotages — HELD.** See below.

### Bounded novel attacks — effective

1. **Desktop forwarding sabotage.** The production query/boot call returned `cap-256`
   at baseline. Replacing only the forwarding member with `undefined` in an in-memory
   copy caused the focused exact-value expectation to fail. No repository file changed.
2. **Worker-state sabotage.** An extracted `recordDiagnosticJit` rejected a correct
   `cap-256` policy carrying cap 24 at `jitBefore`, and rejected a switch to
   `repack-off` at `jitAfter`; both raw mismatches remained in milestones. Removing only
   the cap assertion made the wrong cap pass, while removing only the policy assertion
   made the endpoint switch pass. The guards and their tests are therefore sensitive to
   the claimed policy/cap boundary.

No frozen-source refutation is found. A real `cap-1024` browser arm is not needed for the
present ABBA 24-versus-256 claim: production forwarding and pre-existing policy semantics
cover all three labels, while the live comparison expressly measures only 24 and 256.
Require a cap-1024 browser run only if a later claim interprets its real performance or
promotes it. Final disposition still awaits the completed checkpoint, four canonical
children, aggregate comparison, and inspected screenshots.

### Terminology carried from the prior JIT control

The earlier JIT-control endpoint change `compiledBlocks: 94 -> 133` is a net increase of
39 in the **live resident-block gauge**, not a count of compilation events. The same
interval records 656 cache installs, which is the relevant event counter. Residency
comparisons must preserve that distinction; no prior timing or retirement delta changes.

## Collector correction and retained interrupted attempt

The first aggregate attempt did not complete an ABBA comparison. Its one retained
`repack-off` child completed the browser interaction, but the aggregate collector read
the nonexistent flat field `state.hostEntries`; the actual worker response places the
counter at `state.entryCost.hostEntries`. The checkpoint record is SHA-256
`d6b36e38c182446a1ddc8c8cd674089a7509d7566b311126508a03935816b09d`, and its run log is
`ba67a1f7cad8f2d3f1ef78125b224041fc1120f36691a61b5629675e7cdffb5a`. The retained child
JSON is `86712b7909b297a3e192bb5e4d7bc7e654b576364747316a3bc4b188642a3ae1`; its canonical
PNG is `61bc9fe101e574fe7fbaaf15876d608e2097605cfb49270f5c38ea3988d5fe31`, run log is
`539922f7a1dea82c6334435d9b7815fa75840fb63101affa03519ffcc9161d19`, and server log is
`a068bdc77471daba082d5e9a275bbb65e736695579753675980885de0cef97dc`.

That partial child is useful localization, not one of the final four arms. It binds head
`de9c9feae6e20dd906145fb5fab3913666b18f8a`, served runtime
`45ce3b925c590fab34b8fd8af85f0bb2ffbec585df2e2586c668869fe4ebca6b`, profile
`f6a145f7c15572d77968a5af5a477f7b4231b98fc222922c5d740e1bf40c4c78`, and snapshot
`e2186e00eb85fb4b82dc6edc7780fef02590ffd666c6ae68b90176d4726ecdf7`. Its original-T0
interaction is `4000.815 ms`, hence still an F timing failure after successful marker,
input, attached/running audio, and 1440/1440 non-silent PCM frames. Independent arithmetic
over the real endpoint states gives `entryCost.hostEntries = 1,313,897 - 159,470 =
1,154,427` and all 11 expected nonnegative deltas.

Commit `884dc59a81970a96f9fc4672a7241eee2454d5d0` changes only the collector to traverse the
dotted nested path. The corrected collector source is SHA-256
`aaa92c67a789861a8e389bc13067d469c71b25fa624824b445ae7ad36a98caa8`. It requires a safe
nonnegative starting value, a safe ending value, a nonnegative delta, and positive guest
and JIT retirement. The latter two conditions also make a negative ending value
impossible. No runtime or served browser byte changed.

A focused real-shape regression was frozen for integration after the collector commit at
`tools/verify/e5-t26f-residency-comparison.test.mjs`, SHA-256
`ba07b14e62a24e4408c7680e7dfbfdddb9081aef17030a99090df2c6c0cdefa3`. It executes the
collector's pure assertions against the retained real record, independently asserts the
11 exact deltas, rejects missing/malformed/unsafe/regressing endpoint counters, prevents
fallback to fabricated flat fields, and rechecks exact child-failure admission. The
critic reran the frozen file directly: 6/6 passed. In a temporary isolated copy, changing only the
collector key back to flat `hostEntries` made 5/6 tests fail, including the exact-record
test. **SUITE disposition:** sufficient for retention in the focused harness gate. The
file was worker-frozen but still awaiting coordinator integration at final critic
inspection; its source digest and the critic's 6/6 direct run are exact, while the
coordinator's submission log remains the authority for the integrated gate record.

## Corrected ABBA evidence at `884dc59a`

The canonical aggregate is
`evidence/e5-t26f/residency/replay/comparison.json`, SHA-256
`bba06bea873de0d2876ccebe8a923239040cbc66d97c63da7380305685536745`. Its four child JSON
digests were recomputed and match the aggregate exactly:

| Arm | Policy/cap | Original-T0 interaction | Child JSON SHA-256 | Live-gauge/counter disposition |
|---|---:|---:|---|---|
| A1 | `repack-off` / 24 | `4997.115 ms` | `c0926ac7ea4b30b4d76e8a91ce8fffc12281f3076b9f33be242214071ac4420f` | `compiledBlocks 94 -> 102`; 594 installs, 233 retranslations, 105 evictions |
| B1 | `cap-256` / 256 | `3691.095 ms` | `086a22589c476a628a7c457f0c74f3d8fde7c3430e0220b6c2f1d3e52d834c23` | `compiledBlocks 94 -> 508`; 414 installs, no retranslations/evictions |
| B2 | `cap-256` / 256 | `4582.245 ms` | `fd016a6c25bf06bec9aa4c7164780ca57d0b571e878fd6416c5b3d7f0d8d04ae` | `compiledBlocks 94 -> 556`; 462 installs, no retranslations/evictions |
| A2 | `repack-off` / 24 | `3991.010 ms` | `41388d77c253f9642b502c69733af7974650f2aa73c0451b23592fb10fcfa3c3` | `compiledBlocks 94 -> 108`; 445 installs, 117 retranslations, 84 evictions |

The `compiledBlocks` differences above are changes in a live resident-block gauge, not
compilation-event counts. The larger policy retained more live blocks and avoided
eviction in these two arms, but the within-policy timing ranges are roughly 0.9--1.0
seconds and every arm still exceeds two seconds. This four-run screen therefore permits
no statistically significant speedup, causal cost attribution, default promotion, or F
acceptance claim.

### Final prediction ledger

- **P1--P4 — HELD.** Every child is reuse-only, non-acceptance, explicit JIT-on, ICount,
  key delay 5 and physical `sh /tmp/a`. Live before/after responses report the requested
  policy and exact cap, safe advancing retirement, and the after sample occurs only after
  the frozen interaction end. The served-runtime digest remains
  `45ce3b925c590fab34b8fd8af85f0bb2ffbec585df2e2586c668869fe4ebca6b`.
- **P5 — HELD.** The aggregate contains exactly ABBA order over four private reuse
  profiles. All bind the same profile
  `f6a145f7c15572d77968a5af5a477f7b4231b98fc222922c5d740e1bf40c4c78`, snapshot
  `e2186e00eb85fb4b82dc6edc7780fef02590ffd666c6ae68b90176d4726ecdf7`, kernel, 1-GiB
  image, manifest, origin and runtime. The checkpoint creator differs only because the
  collector-only `884dc59a` commit changed no served byte.
- **P6 — HELD.** All four children exit 1 solely with the exact retained assertion
  `post-restore interaction exceeded 2 seconds`; there are no browser, HTTP, presentation,
  or guest-clock errors. Each reaches `restored` without a cold `booting` state, reports
  matching pre/first-present CRC `09c5c407`, and receives fresh agent HELLO generation 2.
- **P7 — HELD after correction.** The aggregate includes all 11 independently checked
  deltas. `entryCost.hostEntries` advances by 1,517,420; 1,702,673; 2,561,390; and
  1,106,911 in ABBA order. These endpoint-bracketed counters include RPC-adjacent guest
  execution and are not an exact frozen interaction window.
- **P8 — HELD.** All arms are retained in order with `fTimingPassed:false` and
  `fVerified:false`; no fastest-run selection or default mutation appears.
- **P9 — HELD, with XRUN recovery visible.** Every child records 20 physical keyboard
  frames and 20 DOM events, the real conditional marker, prompt, visual change, cursor,
  output attachment and running/unlocked audio. Fresh non-silent PCM is respectively
  4096/4096, 1440/1440, 2400/2400 and 1440/1440 inspected frames, each with maximum
  absolute amplitude `0.082000732421875`. The four canonical PNGs are byte-identical at
  SHA-256 `61bc9fe101e574fe7fbaaf15876d608e2097605cfb49270f5c38ea3988d5fe31`;
  inspection shows ALSA `underrun!!! (at least 0.063 ms long)` followed by the green
  completion marker and shell prompt. This is successful held T19a recovery, not absence
  of a guest XRUN.
- **P10 — HELD.** The forwarding/policy sabotages remained effective, and the new
  isolated flat-counter sabotage is caught by the real-shape regression.

**Incremental conclusion:** the corrected collector and four-arm diagnostic are truthful
for the narrow residency screen. They do not satisfy or waive F's unchanged two-second
criterion and do not justify a production/default policy change. Prior H, T19a and T26i
boundaries remain HELD; no F verdict or task-status change is made here. Before closing
this report, every file-backed SHA-256 citation above was recomputed from the named file;
the diff digest was recomputed from `5bf283ef..de9c9fea`, and the runtime/profile/snapshot
bindings were cross-checked in each of the four canonical child records.
