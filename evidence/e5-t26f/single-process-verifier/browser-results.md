# Closed single-process observer browser review

VERDICT: actual binding integrity and reached functional predicates HELD; original F timing FAILED; outer collector compatibility REFUTED. No F acceptance, speedup, first-PCM timing, or performance-cause claim follows.

Subsequent repair, without rewriting this original verdict: [collector-only fix HELD](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/collector-review.md), followed by [P13 scoped clone HELD](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/p13-review.md) at001e8086. The original wrapper still failed. [The later latency replay](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/latency-review.md) is separately reviewed, not substituted into this run's timings or counters.

This report concerns **only** the original unprofiled cold/reuse at `05b82bc688a34e6a1abef7b6c761c01bf4a3f7c6`, under `evidence/e5-t26f/single-process-observer-05b82bc6/{cold,reuse}`. P11/P12 were registered in [preflight](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/preflight.md:33) before the run. The later latency replay and any CPU sample are separate experiments and were not inspected for this report. There was no critic browser launch, clone, build, stress run or input mutation.

## P11 — actual retained bytes and preparation HELD

Ran `node evidence/e5-t26f/single-process-verifier/browser-integrity.mjs` after the original run closed and before Main's latency replay. The script executes the proper runner's **exact source-extracted `treeDigest` function**, including sorted traversal, symlink/non-regular refusal and SHA-256 of `JSON.stringify([relative,size,fileSha256] entries)`. Runtime uses exactly its `src|pkg|bench` plus top-level `js|mjs|html|css|json` filter, not `web/dist` or a generic directory hash. Full per-file entries and comparisons are retained in [integrity JSON](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/browser-integrity-v1.json:121).

| Actual bytes independently read | Result |
| --- | --- |
| Served runtime, 150 regular files | `f897f34951ca3ab59909f0ce6bbe2e8a68a6620cdace4d1e4eca617cbd601ce8` |
| Sealed `checkpoint-profile`, 816 regular files | `f7a2bc52a45ed895eb1edd71f722ab1fb5c5ccf106a0753a6630b17f84940685` |
| Retained `normal-checkpoint.json` | `7c0e4780bb458bc5c4978e9319b51cb943687f08073080493105b21c3c724d22` |
| Decoded WVMDESK1 envelope, 2,820,040 bytes | `87477fbfe7b1d31edfb75336f0f49f0001f175106a6506933cef733d579699e7` |
| Actual prepared sound payload | `330d02f9e91a4e67239bd3386715f87ca45cb0ea8052c387276a6c5450eeeafc` |
| Kernel bytes | `af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce` |
| Full image bytes, 1,073,741,824 bytes | `d2fc4eab9bc1b5fe528a2956b58faefb20fcf18e2505c499ecafa8824d390f72` |
| Actual chunk manifest | `e02a9af547773f9d54e47151419ab3b118c55d3a4c90b25dcc434487db8dc9f5` |

The retained seal is `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26f-single-process-observer-IKBhyX`. Only its closed **checkpoint-profile** was compared to the seal; the executed iteration profile is expected to change and is not that immutable baseline. Owner, cold and reuse binding objects agree. All 17 invocation pins matched actual inputs both before and after this integrity pass, including the original collector `4bc9e00027a42465a37364cad1b707c87da78806a1c0d20d5729109728004d04`, proper runner `7f8b58f7e3f6e0f16b7b6cb91b8593e625ed058e7aa764df428e9990f85100a1`, proof `d5615b185536f0f0af3da7d4b133ec28ec9e2c62962d22b3cd57e8c24f5a5810`, helper `5807b908…` and executable `cdb72cc9…`. This is a check at that point, not a claim that later authorized collector edits share those bytes. [All 17 comparisons](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/browser-integrity-v1.json:51).

Decoded `checkpoint.session.value`, then base64-decoded its actual `bytes`. SHA/length match the envelope, retained normalSnapshot, cold and reuse. The frozen `parsePreparedSound` implementation was called directly on these bytes, verifying envelope trailer and section digests, required versions/bounds and actual sound parameters. Result: state/params/request/stream/buffer/period/channels/format/rate = `2/1/257/0/3840/1920/2/5/7`; pending transfers/bytes, release/next-XRUN/reset, all kicks and event count are zero. This is not a copied sound-summary assertion. [Decoded result](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/browser-integrity-v1.json:4967).

CRC `9c53f290` is the **paired front-buffer CRC metadata**, matching saved machineResume and actual reuse first-present CRC. It is not CRC32 of the envelope, and this check does not claim a separately decoded GPU-pixel CRC calculation. The envelope format authenticates device sections with SHA-256; the browser paired the front-buffer CRC at the paused save boundary. Persisted/paused are true and overlay generation is 652. [Restore record](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-observer-05b82bc6/reuse/failure-post-restore-interaction-checks.json:169).

The independently viewed [cold PNG](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-observer-05b82bc6/cold/resident-prepared.png) shows matching pre-1/pre-2 `pid=1000 start=31468`, inode-match `/usr/bin/aplay`, `pipe_read`, child FIFO FD3 read-only flags `0100000`, parent FD3 flags `0100002`, no child writers, PCM FD4 owner1000 PREPARED with both pointers zero, followed by green `e5t26f-prepared`. Raw preparation records 118 keyboard/DOM frames, accepted/inputSequenceMatch/marker true, red false. The old lower terminal's 2.289-ms underrun is already visible in this pre-save screenshot; it is not evidence of an underrun by the restored resident player. No arbitrary structured guest stdout was assumed.

## P12 — reached functionality HELD, unchanged deadline FAILED

Cold exits `{code:0,signal:null}`; reuse exits `{code:1,signal:null}`. The actual restored envelope matches the seal, first-present CRC is `9c53f290`, full repair and agent re-handshake are true, protocol version1, sound XRUN events0, and bootStates are fetching/instantiating/restored with no `booting`. `displayChecksPassed:true`; `checksPassed:false` correctly remains false after the cap failure.

Two pre-gesture samples at 1521.2649999856949 and 1877.5299999713898 ms are locked/suspended with zero ring indices, fill and non-silent PCM. The actual runner keeps the 350-ms delayed down/up and fixed physical `play` at 5-ms pacing. Its raw command record has 10 keyboard/DOM frames, accepted/inputSequenceMatch/terminalMarkerSeen true, 8,465 changed pixels and no red marker. Cursor rendering reaches `(684,392)`, 94 matching pixels. [Samples and command](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-observer-05b82bc6/reuse/failure-post-restore-interaction-checks.json:373).

The independently viewed [post-reuse PNG](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-observer-05b82bc6/reuse/failure-post-restore-interaction-checks.png) shows physical `play`, post `pid=1000 start=31468` with the same FIFO/PCM/owner/zero-pointer values, conditional green `e5t26f-aplay`, and `[1]+ Done` for the original prepared command. The helper's frozen post-observation/feed/wait guards plus this real guest record support the same-player conclusion. The old lower terminal remains historical, not the fresh completion marker.

At completion, write/read indices and written/inspected/nonSilent frames are 1440, maxAbs `0.999969482421875`; the pre-command write index was zero. Guest output is attached, audio is unlocked/running, rendered frames rise from 47,532 to 216,876, and heldButtons is empty. This proves fresh non-silent PCM at the completion sample, **not when the first PCM arrived**. [PCM and frozen end](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-observer-05b82bc6/reuse/failure-post-restore-interaction-checks.json:466).

Original T0 is exactly restore completedAt `1222.0550000667572`; original frozen end is `5584.254999995232`. Difference: **4362.199999928474 ms**, exceeding the unchanged 2000-ms cap. The later `postRestoreInteraction.elapsedMs = 4362.639999985695` is a later sample, not the endpoint. Proper runner line1930 throws the exact cap assertion after reached functional checks. No collector work changes those endpoints. [Raw assertion](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-observer-05b82bc6/reuse/failure-post-restore-interaction-checks.json:599).

Evidence limits remain explicit: cold has `errors.browser=[]` and `errors.http=[]`; generic failed reuse does **not** contain those full arrays. Reuse first presentation has `errors=[]`, which is not a substitute. The expected fresh-HELLO diagnostic is recorded. Later restore-coherence audit is deferred, and post-cap coherence/drag/second-restore phases were not reached. Nothing in this review upgrades these absent phases to HELD.

## P9 addendum — outer collection compatibility REFUTED

The original outer wrapper also exits1, separately from the inner cap failure, and no original `observation.json` exists. Its real collector chain rejects the **correctly authenticated** `resident-observer-v1` kind because frozen `discoveryObservation` line31 asserts `resident-aplay-v1`. I reproduced that assertion directly on the unchanged original JSON, without changing kind, source, timing or raw evidence. [Recorded refutation](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/browser-integrity-v1.json:5322), [original outer transcript](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-observer-05b82bc6.log).

This is a concrete limit of the earlier P9 source verdict: wrapper unit tests stubbed the collector and only checked import resolution, so they did not prove actual new-kind compatibility. The rest of P9—image bytes, selection/hash pins, preserved timing/input policy—and P1–P8/P10 remain HELD within their documented scope. The observation-publication subclaim is now REFUTED. The minimum follow-up is collector-only compatibility/refusal tests and reprocessing this exact closed record into a **new derived artifact**. Do not rewrite the original JSON/invocation, relabel its kind, manufacture a successful original wrapper exit, or rerun the cold browser to repair postprocessing. Main owns that implementation; this critic made no collector edit.

No queue accounting summary was manufactured by bypassing the failed assertion. Later derived accounting must bind the original record hash and its actual collector version; neither accounting nor a separate diagnostic replay establishes timing causality. P13 remains conditional and unexecuted, not an excuse for an unrelated clone or suite.

## Record hashes and changed paths

All SHA-256:

- Original invocation: `3a9d98a834a83805ebba0081acc96cfb37c90e4edb2c032f99dde3dc39fc58c8`.
- Cold JSON: `ec509f69096267277dcb836ddc5f56eb406508873eff4771323d28dfac0fac3d`.
- Original failed reuse JSON: `0881a4aa55808bd0884b5a6ef2f05af4da9601b119e188390cef94b4c667002a`.
- Prepared PNG: `1b01fa84c548d1254408da3a1bdb113962d779b691f7f951033f3c57dc3a7baa`.
- Failed-reuse PNG: `bc5d5d2316cb4b5c8ddef47eccc739db13135430e48db1f6520559628b860f39`.
- Original outer log: `9ed2d75add3fbcb97c5dce786fe9db149029e9a7ae20c6f6bf881acd4a743fe3`.
- Integrity script: `31bd9769c2180172147592cb68d714f6d93628e486fda4ccb7c8c337c2fbf9b2`.
- Integrity JSON: `a87531b6422ffad2ab369c12f4b2ee5b1f4d38a74c78d89baeaecb52306708ea`.

Changed only this report, `browser-integrity.mjs`, `browser-integrity-v1.json`, and a clearly labeled closed-run addendum in `source-review.md`, all under `evidence/e5-t26f/single-process-verifier/`. Original raw records and source bindings were checked before/after the integrity pass and left untouched. No latency or CPU experiment is combined with this original unprofiled result.
