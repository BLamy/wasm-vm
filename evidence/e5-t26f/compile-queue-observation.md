# F read-only compile-queue observation

This increment exposes existing lifetime queue counters and gauges through the
existing shared WASM `jitStats` path. It changes no execution policy, scheduling,
queue order, profiling, clock, guest image or helper. L's independently verified
selection boundary remains unchanged. F still requires the original two-second
physical interaction, and this collector is never an F acceptance verdict.

## Reproduction

- `make verify-E5-T26f-compile-queue-observation`: scoped formatting/clippy,
  actual WASM queue/discovery/capacity tests, collector and runner safeguards.
- `make web-dist`, then one built-page `e5-t18e-demo-smoke.mjs` run for E5-T26f.
  Preserve this worktree's two unrelated dirty dist manifests using their known
  backup, and stage only owned generated files.
- `node tools/verify/e5-t26f-browser-compile-queue.mjs`: always a NEW cold
  resident checkpoint on origin61635, followed by one unchanged default4096,
  repack-off24, explicit-JIT1 reuse with actual physical `play` at5ms/key.
  `E5_T26F_COMPILE_QUEUE_OUT` selects a new output directory only. Existing
  attempts refuse; no old-seal option exists. Every child log/exit is retained.

The collector composes the held discovery observation checks. It requires the
actual nested authenticated head, same generation and safe monotone counters,
allows signed queue-depth changes, and checks conservation with exact BigInt
intermediate arithmetic. From successful nominations minus FIFO-depth change,
it derives staging and distinguishes incoming rejections from displaced
residents. Popped minus submitted is pre-submission refusal, not a count of
compiler failures or a per-PC timing explanation. Both original RPC endpoints
and lifetime values remain visible. A zero interval drop does not erase history.

The six collector and five wrapper unit tests use explicitly synthetic numbers
or child/filesystem stubs; they are not browser evidence. Luna's five actual
WASM tests instead exercise real guest execution in both wrappers, nonempty
backlog, backpressure/pop, detached object mutation, unchanged snapshots/digests/
guest clocks, and restore preserving queue lifetime counters before24 actual
stale cancellations. No counter reset is introduced for the projection.

## Evidence boundary

Daybreak's source predictions are in `compile-queue-verifier/preflight.md`.
Final frozen head, build/gate/demo/browser records and independent dispositions
will be appended after those runs close. No deployment or merge is performed by
this observation increment. The old42bb cold seal is invalid for this new served
runtime and must not be reused or relabelled.
