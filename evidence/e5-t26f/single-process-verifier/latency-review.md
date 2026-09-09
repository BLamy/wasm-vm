# Separate closed latency-only replay

VERDICT: HELD as bounded sampled-observation evidence; its unchanged 2000-ms endpoint FAILED at **4264.784999966621 ms**. This is not the original unprofiled result (4362.199999928474 ms), a new acceptance run, a speedup estimate, or a timing-cause attribution. The CPU-only replay was not reviewed here.

The coordinator had already reported this replay's timing values before this read-only review. No blind timing prediction is claimed. Checked the unchanged sampler's semantics and the separate launcher before interrogating raw samples; `latency-check.mjs` then checked source-binding relationships, the exact producer/seal/fixture, sample order and original endpoints without launching or rehashing a profile/tree.

## Identity and measurement boundary

The [launcher](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-observer-05b82bc6/run-latency.mjs:14) binds original HEAD05b, the six existing proper-runner/proof/helper/C/binary/build-info pins and its own script hash. It checks pins before/after, inherits the original common frozen image/profile/origin, scrubs E5/Rust/CARGO overrides, and enables only the existing latency mode in a fresh iteration. Raw uses `iteration-7nse0r/profile`, distinct from unprofiled `iteration-BMmq9l/profile`; both refer to the already-authenticated checkpoint-profile digest `f7a2bc52…`, envelope `87477fbf…`, CRC `9c53f290`, runtime `f897f349…` and original observer fixture. No new cold seal was made.

Diagnostic latency=true, cpu=false; command/guestClock/icountDivider/jit/residency overrides are null, complete=false; physical `play` remains at5-ms pacing. The proper runner's ordinary query defaults to JIT1. Unlike the original explicit-JIT accounting run, this replay has no `jitBefore`/`jitAfter` endpoint RPCs; the latency sampler makes its own bounded scheduler/JIT observations. Thus even small duration differences between these runs are not an isolated observer-performance comparison.

The child exits1 with the original cap assertion; the launcher accepts that known diagnostic failure as a closed result. T0 remains actual restore completedAt `1180.4750000238419`; frozen end is `5445.259999990463`. No sampler boundary replaces them. [Raw T0](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-observer-05b82bc6/latency/record/failure-post-restore-interaction-checks.json:291), [end](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-observer-05b82bc6/latency/record/failure-post-restore-interaction-checks.json:2565).

## What the samples establish

| Observation | Elapsed from original T0, ms |
| --- | ---: |
| Sampler installed | 803.8799999952316 |
| Last recorded zero write-index before first positive | 3305.210000038147 |
| First sampled positive/non-silent PCM | 3355.899999976158 |
| First recorded successful marker observation | 4248.325000047684 |
| Frozen proper-runner end | 4264.784999966621 |

There are68 PCM samples and13 completed scheduler/JIT samples, within the 120/24 bounds. The nominal PCM poll interval is50 ms. Every PCM sample before the first positive is available with writeIndex0 and no error. FirstWrite and firstPcm refer to the same poll: writeIndex1440, written/inspected/nonSilent frames1440, maxAbs `0.999969482421875`; the non-silent read completed approximately0.095 ms after its sample timestamp. [Actual first samples](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-observer-05b82bc6/latency/record/failure-post-restore-interaction-checks.json:2468).

These polls bracket the observed transition; **3355.900 ms is a first sampled observation, not an exact production/arrival timestamp**. The ring is still recorded zero at3305.210 ms, already beyond the cap, so this trace does not merely show a late completion marker with on-time sampled audio. Marker observation follows first sampled PCM by892.4250000715256 ms. That interval is not attributed to any particular C, shell, guest, renderer or host operation.

The marker array is capped at120 entries and ends at2846.3949999809265 ms with all stored entries false. That does not refute the later firstMarker: [sampler source](/Users/blamy/Documents/Codex/wasm-vm/tools/verify/e5-t26f-browser-roundtrip.mjs:928) continues counting calls and updating firstMarker after the array cap. Raw has204 marker calls, firstMarker=true at4248.325 ms, then stopReason `command-wait-settled`. Aggregate state-read time10.114999055862427 ms and max5.174999952316284 ms measure only those reads, not total instrumentation cost or the entire marker delay. The full post-cap marker-poll history is not retained. [Marker summary](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-observer-05b82bc6/latency/record/failure-post-restore-interaction-checks.json:2493).

Physical command accepted/inputSequenceMatch/marker are true with10 keyboard/DOM frames, no red marker,8,510 changed pixels. Completion independently retains1440 non-silent frames and attached audio output; heldButtons is empty. These scalar checks do not replace the original run's independently viewed same-player screenshots. Generic failure still lacks full browser/HTTP error arrays, and this review adds no claim for later coherence/drag/second restore. No new screenshot, profile or source suite was required.

## Integrity record

Executed only `node evidence/e5-t26f/single-process-verifier/latency-check.mjs`; input bytes remain unchanged. SHA-256:

- Raw latency failure: `974433f28a914edfe6258e3c389eec5bc2e3ffd42e9b6c184b0453dad8562dff`.
- Latency invocation: `e08826ba0fe0bbf0a21cf3eeb199f78f9a96804023f18ac0c446d1edce76e812`.
- Launcher: `16af6ce3b4bc61a0775095a675c527911d2268cc7249310ecfc986f1b70ab209`.
- Outer latency log: `afd52c38388bc51e8f381bcd305477f7e540e4b8d51766ef2b2fecb29bd20f4e`.
- Independent result: `eef36d73b521c8b738bfc04af15c0d9eafef4512f63dd61610ead7daa8ecd930`.

Changed only this report, `latency-check.mjs`, and `latency-check-v1.json` under `single-process-verifier/`. No raw replay, original unprofiled record, runtime, profile or collector source changed.
