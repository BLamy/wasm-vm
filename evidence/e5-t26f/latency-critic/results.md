# E5-T26f latency diagnostic — bounded fresh-critic review

RESULT: sufficient diagnostic localization; not E5-T26f acceptance and no criterion waiver.

Reviewed frozen harness diff `e714458a358c0452af0b8eeb21225217803f7f49..2e9d9771477bda265342ac928a25fc6e2d769b25` across only `Makefile`, `tools/verify/e5-t26f-browser-roundtrip.mjs`, and its Node test. Diff SHA-256: `a950e252db6ffc94b5f2f29fc53dd81dc0441c5874039833236bbb1bc54d874f`.

## Prediction results

- **P1 diagnostic isolation — HELD.** Latency mode is exact-`1`, reuse-only, and the record says `kind:diagnostic-iteration`, `acceptance:false`. The Make guard refuses both diagnostic create and reuse before any build/browser command; both tripwire tests pass.
- **P2 original clock — HELD.** `normalRestore.result.completedAt`, `postRestoreStart`, and `interactionLatency.restoredAt` are all `1129.4700000286102`. Probe installation is separately recorded at `1911.2450000047684`; its six-second diagnostic deadline remains `restoredAt + 6000`, and the unchanged acceptance measurement remains `postRestoreEnd - postRestoreStart`.
- **P3 first PCM semantics — HELD.** The last zero ring sample is at `2883.100000023842 ms` after restore. The first positive/non-silent sample is at `2933.0499999523163 ms`, with 1,920 written/non-silent frames and positive amplitude. Therefore actual fresh PCM appeared in the bounded interval `(2883.10, 2933.05] ms`, already after the two-second deadline. `firstPcm.completedAt` is only completion of that probe inspection, not playback completion.
- **P4 successful completion remains separate — HELD.** The existing conditional marker/guest-visible command record is accepted, and the immediate completion sample contains positive fresh PCM. The marker is first observed at `4439.319999933243 ms`; final PCM is sampled at `4452.754999995232 ms`; all interaction checks finish at `4488.444999933243 ms`. The runner still fails only its original `post-restore interaction exceeded 2 seconds` assertion. First write/PCM did not substitute for completion or acceptance.
- **P5 one probe RPC in flight — HELD.** Fourteen scheduler samples all settle, are spaced by at least `250.015 ms`, and have maximum request time `42.690 ms`; source and adversarial tests keep one probe `schedulerStats()` RPC outstanding and do not free its slot on local-stat rejection or timeout. Late settlement cannot mutate stopped evidence. These diagnostic RPCs may perturb timing, so the record is localization rather than a clean performance acceptance run.
- **P6 failure-first persistence — HELD.** The canonical failure retains the original assertion, exact phase, original clock, and complete latency report with no capture error. Node sabotage fixtures prove the initial failure write precedes new page collection, collection is bounded to one second, a stalled collection cannot pile up another call, and late data cannot overwrite the persisted report.
- **P7 bounded observation — HELD.** The record contains 73 PCM samples, 14 scheduler samples, and 218 marker calls. Marker storage caps at 120 while preserving the first later true observation. Marker reads total `9.245 ms`, maximum `3.665 ms`; scheduler progression is approximately 12.805 million retired instructions/second with zero fetch waits and maximum slice `50.25 ms`. This supports latency in guest progress rather than heavy marker-state inspection, without proving an uninstrumented acceptance time.

## Artifact authentication

- Canonical JSON SHA-256: `9ce88d0de2b848077f36fcc3b15bc99dce9ac31f0958f1084f80843e2b0438f0`.
- Inspected PNG SHA-256: `b91a764e90acadbc082b08d4e07c48d368986796da538b6909a5571e0c3c5d44`; it shows `sh /tmp/a`, ALSA format output, the conditional green marker, and returned prompt with no PREPARE error.
- Server log SHA-256: `74e5202bd745d30ae8d7fbc52476212c6c98ecb88b0ac70b96df93442b48fad9`.
- Pre-evidence predictions SHA-256: `3fe1faa7df1b41729e4982249a2dbb2a59003e4a4c261616a6307b7cb78087b5`.
- Independent command `node --test tools/verify/e5-t26f-browser-roundtrip.test.mjs`: 44/44 pass, including diagnostic guards, original-clock exhaustion, one-RPC serialization, first-PCM/marker separation, failure-first persistence, and late-settlement refusal.

The browser sound path remains functionally live: the command completes visibly, final PCM reports 3,360 written and 2,400 non-silent frames, output is attached, and no PREPARE error appears. This review does not claim an exact browser frame count, reopen T19a/H, change E5-T26f status, or waive the unchanged all-success two-second deadline.
