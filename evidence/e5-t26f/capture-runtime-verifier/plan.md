# E5-T26f after P — prelaunch critic predictions

Planning only, 2026-09-08. Independent F critic, not P verifier or implementer. I read
F's complete current boundary and acceptance, the existing single-process observer, and
the prior post-PLIC prelaunch plan. No new runtime evidence has been inspected or run.

Main owns P's active final clone, frozen at
`078500ebbef1c5d90adf973790ad68b7579a5879`, then F activation and metadata freeze,
followed by exactly one fresh cold creation and one default, unprofiled diagnostic reuse.
P reportedly only makes per-unit retirement metadata optional and routes
`WasmLinux.run_chunk` through `Machine.run`; P correctness is exclusively P's fresh
verifier's responsibility and is not reviewed here. P is not yet verified, so no F browser
launch is admissible before its final verified verdict. Expected release WASM SHA-256:
`a3ce02529ae2e6ec175066f4c838451ca7d1472b5f6bd2f5b2d5cbff805c8b42`.
All historical F checkpoint seals are invalid for the forthcoming metadata/runtime freeze.

## Falsifiable predictions

1. **Prerequisite and launch order.** P's immutable final verdict says `verified` before F
   activation, metadata freeze, cold creation, or reuse begins. The frozen P commit and
   release-WASM digest above are recorded without reinterpretation. Any F launch before that
   verdict, or any later mutation of the frozen F head or served inputs during capture, is
   FAILED and the resulting screen is inadmissible. P's semantic correctness is carried from
   its verifier, not re-litigated from F output.

2. **Exact immutable bindings.** `invocation.json`, cold and reuse records, the inner runner,
   and the collector all identify one Main-frozen F HEAD. Recompute and match the recorded
   source bindings, served release WASM, runtime tree, browser identity, origin, kernel,
   fixture, image metadata, chunk manifest, observer binary/build metadata, helper, and
   snapshot bytes. The served WASM must hash to the expected digest above. HEAD agreement
   alone cannot substitute for a missing byte-level binding; mismatch is FAILED and an absent
   required binding is NEEDS EVIDENCE.

3. **Carried image/helper proofs.** Provided their bytes and dependency boundary remain
   unchanged, carry the independently held observer image SHA-256
   `d2fc4eab9bc1b5fe528a2956b58faefb20fcf18e2505c499ecafa8824d390f72`
   and resident helper SHA-256
   `5807b908fc1bd84ff19c96e269df6b69ac86d3a62412a032f476dc8ea7f581d9`
   without rerunning or re-reviewing those proofs. Rehash both in the new bindings. A changed
   byte or dependency boundary cancels carry-forward and is NEEDS EVIDENCE; this diagnostic
   does not authorize a replacement image, helper, fixture, or new harness requirement.

4. **Fresh cold seal.** The wrapper refuses an existing output directory and creates a fresh
   retained Chromium profile. Cold exits zero, prepares the established two-window desktop,
   terminal text, custom cursor, completed initial playback, and actual resident observer,
   then closes a paused, coherent checkpoint. Its snapshot digest, first-present CRC,
   generation, publication/audit state, runtime bindings, and screenshots agree. Reuse uses a
   fresh copy of that new seal and never launches, rewrites, or rebinds a historical checkpoint.

5. **Prepared-player identity.** Inspect the new PNGs and actual pre-1/pre-2/post observations.
   The same saved player PID/starttime, executable, FIFO descriptor, and owned PREPARED PCM
   identity survive restore under the carried fail-closed helper guards. Decoding the saved
   sound state shows the required empty/prepared stream and zero queued playback before the
   gesture. No historical PID, descriptor, starttime, CRC, or frame count is assumed.

6. **Unchanged default, unprofiled policy.** Reuse records the existing physical `play` path
   and 5-ms key pacing with the normal default-4096 execution budget, JIT enabled, existing
   `repack-off`/24 residency policy, and unchanged clocks and acceptance endpoint. No CPU,
   latency, guest-PC, retirement, or other profiler; command override; COMPLETE override; or
   alternate timing endpoint is active. P supplies no presumed performance improvement.

7. **Reached functional observations.** The new seal's saved CRC equals the normal restore's
   first-present CRC; full repair and fresh HELLO complete without a `booting` state or device
   re-probe. Two locked/suspended zero-PCM observations precede the delayed physical gesture.
   Ten keyboard and DOM transitions match, guest-visible focus and fresh completion text are
   observed, the cursor is newly rendered at the requested location, buttons are released,
   and audio is attached/running with a strictly positive fresh non-silent PCM count after the
   same child completes. Report actual written, inspected, and non-silent counts; do not infer
   bit-exact duration or an unsampled first-arrival time.

8. **Mandatory F two-second result.** The sole F timing prediction is evaluated, not presumed:
   normal restore `completedAt` is T0 and the original frozen `postRestoreEnd` is the endpoint.
   Independently require `postRestoreEnd - completedAt <= 2000 ms`. A larger value is FAILED,
   with exact raw fields, assertion point, and reuse exit cited. Outer exit zero, later samples,
   profiler clocks, or presentation timestamps cannot replace this interval. No historical
   timing result or proposed profiler cause is re-litigated.

9. **Diagnostic remains non-acceptance.** `invocation.json` must retain `acceptance:false`, and
   the observation/final presentation must retain `fVerified:false` whether reuse exits 0 or 1
   and even if the two-second predicate passes. Cold-zero/reuse-one/outer-zero means a validly
   retained cap failure, not acceptance; cold-zero/reuse-zero/outer-zero means only this bounded
   screen passed. Normal full `make verify-E5-T26f`, including its full F acceptance and fresh
   independent review, remains mandatory in either case.

10. **Reached coverage and bounded disposition.** Claim coherence admission/generation,
    drag-phase saves, second reload/restore, no-stuck guest hover, and complete browser/HTTP
    error arrays only when the immutable output actually reaches and records them. Otherwise
    preserve those phases as deferred/NEEDS EVIDENCE and do not infer them from presentation-
    local emptiness. Classify each reviewed prediction as HELD, FAILED, or NEEDS EVIDENCE with
    artifact hashes. Carry unchanged observer/image/helper proofs and the eventual P verdict;
    retain all historical failures as failures. Aggregate counters are not exact interval
    attribution or causation. Do not add attacks, harness requirements, performance assumptions,
    or another investigation into old failures/profiler hypotheses.

Stop at this pre-results plan. Await the fresh, immutable cold/reuse outputs after P's final
verdict and Main's F freeze.
