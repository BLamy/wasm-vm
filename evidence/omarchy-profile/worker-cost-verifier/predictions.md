# E5.5-T03ac independent verifier predictions

Recorded at 2026-09-16T02:10:48.232149+00:00 before the authorized worker-cost recording, while HEAD is 8da6f973 and the harness is not yet implemented. The verifier owns only this directory. Prior T03ab negative desktop results and T03z runtime proof carry by unchanged source/digests; neither desktop acceptance nor release promotion is claimed here.

## Falsifiable predictions

- P1 — Scope and identity. The final diff adds only harness/test/task/evidence work, with unchanged executable/runtime/guest/default sources. The actual served release WASM hashes to `1bc7285239db053abdaaafe4c5869a5a2495c7c149d01a239ec020e1fedbf88d`; all R3 sources match the fixed identities in `omarchy-input-trial.mjs`. Recorded harness bytes equal the committed head, with a clean scoped source status.
- P2 — Single owned run. Exactly one fresh owned Chrome process runs the candidate residency option. Actual worker state has cap 256, recycling off, threshold 512, cold counters 65536, decoded cache 4096, icount divider 64, admission probe off, entry timing off; the page uses a 1280x800 desktop and LP1. Normal cleanup completes and the owned watchdog records no timeout.
- P3 — Unchanged readiness and input. Readiness requires restored state plus actual app layers/pixels, not recorder-created readiness. The physical event sequence reconstructs the typed nonce-producing command, its trusted keyboard/sync calls reach the same worker, and Enter anchors exactly 120000 ms of acceptance after bounded startup (300000 ms) and typing (60000 ms). Serial commands only inspect/independently read; none writes the nonce.
- P4 — Immutable verdict. A failure records no valid independent nonce by its original deadline, then saves the actual failure screenshot within the fixed capture allowance (20000 ms). Any pending read may settle after that deadline, but cannot create success or extend acceptance. No new guest input or serial commands occur after the frozen verdict.
- P5 — Post-verdict profile. Sampling only occurs if P4 produced a genuine failure and its actual image. Profiler attach is later than both. It selects exactly the same-origin owned `linux-worker.js` target, starts once at 1000 us sampling interval, runs for a fixed 30000 ms, and stops/closes inside the existing 180000 ms diagnostic allowance. It never pauses/steps the guest. A successful input path skips the diagnostic.
- P6 — Raw profile coherence. Raw profile nodes/sample IDs/time deltas form a nonempty valid tree with finite nonnegative weights. Independent per-sample and weighted self/inclusive recounts reproduce the summary, allowing documented CDP timing tolerance rather than equating sample count to elapsed time. Target ID, URL, browser version, timestamps and digests bind the sample to this recording.
- P7 — Symbol binding. Offline names apply only to indices of the served release module. Every non-custom WASM section of the named companion exactly matches release sections, with per-section hashes. Dynamic/foreign/anonymous frames stay unresolved. The companion is never served, executed or published.
- P8 — Honest conclusion and coverage. The report identifies measured top costs with raw node/section citations and one bounded next investigation. It claims neither root cause, speedup nor restored responsiveness. Focused tests cover wrong worker, premature/altered verdict, malformed profiles, late capture, identity mismatch and successful-input skip. Each changed behavior has runtime or focused-test coverage.

## Bounded novel attack planned before evidence

Attempt favorable misattribution using an otherwise valid raw profile: replace/insert a same-function-index frame from a different module URL or a page/foreign worker target. Predict strict identity validation rejects mismatched ownership, and offline symbolization leaves foreign index frames anonymous rather than falsely inheriting release names. Refine the exact fixture after reading the completed validation API, without another guest run.

## Scope of verdict

This task may verify a faithful post-failure diagnostic. It cannot verify desktop responsiveness. T03q remains gated.
