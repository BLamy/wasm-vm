# E5-T26f — frozen predictions for the separate CPU diagnostic

2026-09-08. Independent critic, Daybreak Blue assignment. Written before opening the CPU
driver, invocation, exit, raw failure record or profile. Main has disclosed their outcome;
the checks below are predictions against that claim, not claims of a blind experiment.

## Scope and carried boundary

Only new `cpu-plan.md`, `cpu-audit.mjs`, `cpu-result.json` and `cpu-results.md` in this directory
are writable. Audit the closed `single-process-observer-96ecb801/run-cpu-default.mjs` and
`cpu-default/{invocation.json,exit.json,record/failure-post-restore-interaction-checks.json,
record/interaction-cpu.json}`. No harness imports/execution, browser, build, gate, clone,
profile mutation, task/status/source/HEAD/index change or sampler launch. The earlier `cpu/`
attempt is Main's reported prelaunch diagnostic-option refusal, not a browser measurement;
do not conflate its paths/outcome with this run or expand into re-running it.

Carry the accepted original unprofiled review and N/image/helper HELD boundaries without
retesting them. Original unprofiled elapsed `4104.174999952316 ms` remains FAILED. Its report
digest is `ae149b37b3a8bc82e049bcf612cc5fd5fb2379484630957d8f71f1852e9253e2`;
its raw digest is `a25418d4dd387ae10af687e8cfffb615a3a74eb6bc1bd81aea88a50e10dfef96`.
The new diagnostic has profiler overhead and a different observation path; neither a matched
unprofiled performance comparison nor a causal/speedup inference is authorized.

## Falsifiable predictions, before reading CPU inputs

1. **CP1 — closed provenance.** Actual HEAD, driver and raw bindings will be
   `96ecb801fdf8b67af75cd150db82d115bcf046cd`. Recorded source pins must match actual bytes,
   including the unchanged proper runner
   `7f8b58f7e3f6e0f16b7b6cb91b8593e625ed058e7aa764df428e9990f85100a1`.
   Served WASM must remain `84b2c17c9b6ab9d86c85912f82bd0b4b4533178fc27a0724d47565cb40974b4d`;
   runtime tree `65935dd0535eb38ed23d78956f63ec800daf3f6bb63094c9c694e236786f74e1` and unchanged
   image/kernel/fixture/origin must equal the independently audited original bindings.
   Actual input/profile digests will be recomputed; missing pins are limitations, not invented.

2. **CP2 — isolated authenticated copy.** Reuse will originate from the same `oBnSX1` root,
   closed baseline SHA `275b4febbd10b186f9c2b34c85dbb346880de86f1e0522878c450ce25289a51f`,
   snapshot SHA `b9eac0eb045945eed648c90537a9e11819e882b7f4c57fb3bd2b9690513fce49`,
   and saved Chromium identity/origin. It must use a new iteration, neither the sealed baseline
   nor the original unprofiled `iteration-nFA2eW/profile`. Verify retained baseline/owner/
   checkpoint integrity without launching or changing them. Distinguish recorded profile-copy
   identity and source-enforced prelaunch copy checks from a nonexistent post-run pristine copy.

3. **CP3 — actual CPU configuration, not fabricated measurements.** The corrected driver
   will request CPU profiling without conflicting JIT/residency selectors, preserving physical
   `play` and its existing 5-ms pacing and original clocks/budgets. Inspect environment scrubbing
   and the proper runner's query/default path; cite `jit=1` and loader `repack-off` as
   source-established defaults only. This CPU record is reported to have no JIT RPC statistics:
   do not invent measured decoded/residency/queue capacities, counter deltas, or an observed
   JIT state. Any extra selector/sampler/harness change contradicting this scope is a finding.

4. **CP4 — original timing and reached coverage.** Raw T0 must equal normal-restore
   `completedAt`; independently compute the original frozen end minus T0, without substituting
   profile duration, a later interaction reading or CPU stop time. Main reports
   `4023.1999999284744 ms`; raw arithmetic decides its exact printed value. It must still fail
   the unchanged `<=2000 ms` criterion, with child1 at the cap after reached functional checks.
   Read actual restore/CRC/no-booting, physical input/marker/cursor/focus and immediate fresh PCM
   fields; do not copy original counters or infer guest PID identity from CPU-only data.
   Later coherence/drag/full-error-array coverage is claimed only if actually present/reached.

5. **CP5 — CPU profile integrity and sampling limits.** Actual `interaction-cpu.json` must
   hash to Main's claimed `21e222eda13169d922c4f1d4135446cd7b6de84b97cc31f2cb7c7afe123e708a`
   and match its raw recording metadata. Inspect target/session, start/stop order and units,
   profile-node IDs/tree links/sample references, sample/time-delta lengths, nonnegative timing
   and the reported 2608 samples. Retain discrepancies, gaps and unrepresented targets.
   Profile start/stop may not equal F's interval; use actual timestamps and collection-source
   ordering, never equate CPU sampling weight with exact elapsed attribution or first arrival.

6. **CP6 — foundational disposition, attribution deferred.** Provide HELD/FAILED/NEEDS
   EVIDENCE with actual hashes/JSON fields/source lines. Count and validate samples and target
   coverage, but do not map unnamed WASM addresses/function indices to Rust symbols or classify
   hot-path causes before Luna's separate `spp-cpu-symbols` immutable handoff. Named-symbol
   attribution remains NEEDS EVIDENCE. No profiler result verifies F; even a passing diagnostic
   cap would leave the complete normal `make verify-E5-T26f` and independent review outstanding.

## Next boundary

Finish the foundational closed-record CPU audit, then return its results and await the explicit
symbol-mapping handoff. Do not inspect partial symbol artifacts or revise these predictions
after opening the CPU evidence. Main owns subsequent source/diagnostic decisions.

## Frozen symbol-mapping extension — before inspecting the closed handoff

Main has now authorized the closed `evidence/e5-t26f/spp-cpu-symbols/` handoff and its existing
`target/e5-t26f/spp-cpu-symbols-96ecb801/companion/named.wasm` and gzip. CP1–CP6 above remain
unchanged. Their original pre-CPU plan digest was
`e6248d0283eaf7249eb17392caf063ea49686aff79b06b1792c93a7bb7e1fb6b`.
Foundational CPU result digest before this extension was
`6246cfded4de7ef06471ac9b2a08d4930e593c6bc2a3ed944f30bf9b0188bf95`.
No mapping, summary or companion bytes have been inspected when writing this extension.

7. **CP7 — companion authenticator.** Actual named WASM should hash to Main's supplied
   `372815edf3bb6a1f72d770d7796353836b87df48c61acb9fb8168e72c1810116`. Independently parse
   served and companion WASM sections, validating bounds/order and equality of every non-custom
   payload, not merely comparing a declared aggregate digest. Main reports eleven matching
   non-custom sections and 1890 recovered names; verify these actual values, function-index/name
   associations and gzip round-trip. Added names must not be mistaken for a newly executed build.
   Authenticate the cited existing Rust input (`89bf2f0ad3306efbf42aaaa0b54dda5aada6110f361d939b3eeca2c300323c2d`)
   and scoped supplied before/after/command/script provenance without regenerating a companion.

8. **CP8 — independent attribution arithmetic.** Inspect the existing held symbolizer's
   mapping and category rules, then independently recompute summary counts, self/inclusive sample
   weights and bridge categories from this exact CPU profile and authenticated name map. Validate
   function indices rather than naively treating offsets as indices; preserve unresolved or
   synthetic JS-to-WASM/generated/other frames explicitly. Weight denominator must be actual
   `timeDeltas` sum (foundational audit:3260775 microseconds), not F elapsed, nominal1000×2608,
   profile duration3261824, or inconsistent hitCount2607. Main claims `sync_plic` self208905us
   (about6.407%); calculate rather than adopt it. Inclusive weights overlap and must not be
   summed as disjoint shares. Preserve node9 hit55/sample56 discrepancy without repairing raw data.

9. **CP9 — honest failed-attempt boundary.** Retain the supplied initial wrong-expected-CPU-hash
   failure as a failed preprocessing attempt, not a browser run or successful generation.
   The original failed script was edited; any reconstructed script is expressly NOT ORIGINAL
   and cannot prove its original byte identity. Inspect the closed failure/provenance declarations
   and bound the conclusion accordingly; do not demand an unrequested provenance campaign.

10. **CP10 — final bounded disposition.** Only authenticated sampled-worker attribution may
    become HELD. A function's self/inclusive share is not its contribution to the whole F deadline,
    a unique latency cause, or proof that a PLIC source candidate will speed up F. The CPU-profile
    interval excludes earlier F steps and has no recorded clock synchronization. F's original cap
    remains FAILED; late coherence/drag and full acceptance remain NEEDS EVIDENCE. Do not review,
    activate, implement or test the disjoint source candidate. Close these four CPU artifacts
    after this immutable attribution review; runtime/seal/task/HEAD stay untouched.
