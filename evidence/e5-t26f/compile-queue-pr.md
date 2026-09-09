## Scope

Adds a read-only view of existing compiler queue counters/depth to both WASM
wrappers' shared `jitStats`, plus exact offline conservation checks and a new-only
cold/reuse recorder. No execution, priority, cache, clock, profiler, guest-image
or helper policy changes. Continues PR364; L remains verified.

## Validation at 2ace1353

- Formatting and core/WASM clippy pass.
- 14 actual WASM tests pass, including5 new queue/read-immutability/restore tests.
- 69 focused Node tests pass.
- Built Chromium demo:126 passed,0 failed, empty error arrays, F IN PROGRESS.
- Daybreak independently holds all observer/gate/demo/new-cold accounting
  predictions. Evidence index: `evidence/e5-t26f/compile-queue-observation.md`.
- New authenticated cold/reuse records actual fresh audio/input/matching CRC,
  but F still fails the original cap at **4313.125 ms**. Actual2773 staged jobs
  account for73 increased backlog,1908 backpressure drops and792 pops;240 pops
  are not submitted. Counts identify neither unique PCs nor elapsed-time causes.

This is diagnostic plumbing, **not F verification or a claimed speedup**. The
original2-second post-restore criterion is unchanged. The recorder retains the
original cap failure and does not reuse/relabel an old runtime's checkpoint.

No GitHub Actions, merge, auto-merge or production deployment. Epic5 completion
and the user's agreed merge/Omarchy release milestone remain ahead.
