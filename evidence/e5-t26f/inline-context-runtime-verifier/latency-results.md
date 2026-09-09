# Closed latency-only follow-on review

**VERDICT: sampled localization HELD within its bounds; original 2000-ms endpoint FAILED;
no causal, exact-arrival, speedup, or E5-T26f acceptance claim follows.**

Fresh Daybreak Blue addendum, 2026-09-08. Scope is only
`evidence/e5-t26f/single-process-observer-657fb5a2/run-latency.mjs` and its closed
`latency/` directory at head `657fb5a23b411bf02832b2d10ef943b43d0becf1`. The original unprofiled review
and evidence are unchanged. I did not rerun the driver, browser, build, image, task gate, or any
profile; no source, seal, metadata, task, branch, or HEAD write was performed. I did not inspect
or assess an SPP candidate.

## Driver, isolation, and pins

The driver SHA-256 is
`540476887db497f8648ad56c76e7dccb58f55299fd75490f891ccdd35d236282`; its closed invocation
is `991ce05d…`. Source inspection confirms it reads the original authenticated invocation,
requires the prior cold/reuse exits, enables only `E5_T26F_DIAGNOSTIC_LATENCY=1`, and scrubs
`E5_*`, `CARGO_*`, `RUSTFLAGS`, `RUSTDOCFLAGS`, and `RUST_LOG` before restoring the explicit
task configuration. It rehashes all inputs before and after the child.

All 12 recorded pins independently rehash exactly, including the five added runtime/probe inputs:

- `jit_browser.rs` `5a83c426…`
- served WASM `18e53caa…`
- CPU-profile import `f75fb382…`
- guest-profile import `1b9d202b…`
- decoded-cache import `fc6dde98…`

The proper runner, resident proof, helper, C source, observer binary/build-info, and latency driver
pins also match. The raw binding retains served runtime tree `f3a4fbe4…`, head 657f, and sealed
baseline profile digest `3d1f4671…`. Execution used a new copied profile
`…/e5-t26f-single-process-observer-9IMCYn/iteration-VrryWr/profile`, not
`checkpoint-profile`; mode is reuse, latency true, CPU/guest profile/JIT/residency/clock/divider/
command/completion overrides absent, and physical `play` remains at 5-ms pacing. Child exit is
1 with no signal. Main's outer-exit-0 observation is not separately encoded in an outer exit file;
the complete closed outputs and final driver print are consistent with that handoff.

## Frozen endpoint

T0 is exactly restore `completedAt = 1192.7849999666214`; frozen end is
`4830.579999923706`; elapsed is **3637.7949999570847 ms**, failing the unchanged 2000-ms cap.
The raw record contains only the expected
`AssertionError [ERR_ASSERTION]: post-restore interaction exceeded 2 seconds` at
`tools/verify/e5-t26f-browser-roundtrip.mjs:1930:12`. Raw SHA-256:
`8064f99fce17507fded7ee9324fbac420ff5a697b5b6a54b8aefc004745a919a`.

The diagnostic still matches first-present CRC `fa67bb62`, has fresh HELLO generation 2, no
`booting`, physical input, visible completion, attached/running audio, and 1440 fresh non-silent
frames at completion. Those facts merely show the sampler reached the same narrow functional
path; they neither replace nor amend the original unprofiled run.

## Sampled localization

The probe starts at T0+756.365 ms. Its declared maxima are 120 PCM samples at nominal 50 ms,
24 scheduler samples at nominal 250 ms, and 120 retained marker detail samples. It stops when the
command wait settles, retaining 57 PCM samples and 11 scheduler/worker windows.

- The last observed zero write index is at **T0+3108.2949999570847 ms**.
- The first observed positive write is at **T0+3156.6549999713898 ms**: write index 480,
  480 written/inspected/non-silent frames, max amplitude `0.999969482421875`.
- Therefore PCM arrival is bounded only between those observations. The latter timestamp is not
  the exact first guest write or first audible/rendered frame.
- The completion marker is first observed true at **T0+3613.4500000476837 ms**. The probe made
  170 marker calls but retained only the first 120 detailed samples; `firstMarker` is a separate
  scalar. It is not an exact render, guest-exit, or command-completion timestamp. Recorded marker
  reads total 9.500000238 ms, max 4.620000005 ms.

All 11 scheduler samples report scheduler and worker-RPC availability, quantum 500000, JIT
available, entry-cost timing disabled, and cumulative `fetchWaits = 0`,
`fetchRequestedChunks = 0`, `fetchWaitTotalMs = 0`. This validates the narrow zero-fetch-wait
claim for the sampled worker states. It does not mean the worker/RPC path had zero latency:
individual scheduler-state requests span 2.335–48.330 ms and samples retain one or two pending
RPCs. Nor can eleven cumulative snapshots identify or exclude another dominant host cost.

## Limits and disposition

The sampler performs periodic PCM reads, marker reads, scheduler RPCs, and JIT-stat RPCs, so this
is a perturbed diagnostic, not a second unprofiled timing arm. Its numerically different endpoint
cannot establish a speedup or regression against the original run. Zero sampled fetch waits do
not assign causality; first-positive PCM and first-true marker values are observation bounds, not
exact arrivals. The diagnostic remains `acceptance:false`; after the cap failure, coherence,
drag phases, second restore, and full F acceptance remain unproven. No durable policy or runtime
conclusion is promoted.

Verifier parser `latency-audit.mjs` SHA-256:
`0b6a88b69e8d84b2014f5a5b692023973bf00c9dba835aeb164bc373adcf9c03`.
Passing `latency-audit-result.json` SHA-256:
`9c48b7916879fa3f9c79fbc7e974c75ab9de5486e00d49c3b9cceaeda69ea476`.
