# E4-T32 fresh-verifier predictions (2026-08-10)

Frozen before inspecting the worker evidence artifacts at submission
`ab3e6fc4ee68179a197d9f82d3a124a043d9e27d`.

- **P1 default and fallback:** with no `worker` query the page must own exactly one
  `whole-machine-worker`; `?worker=0` must own a working `main-thread` controller. A Worker boot
  failure must not silently start a second/main-thread machine.
- **P2 explicit policy and bounded execution:** the page must send concrete interpreter, JIT,
  threshold, profiling, and quantum values to the Worker. Every Worker quantum must be in
  `1_000..=500_000`; one browser `runChunk` must stage at most 64 nominations, attempt/submit at most
  8 blocks across all internal sub-runs, and perform at most one final pump. A terminal outer result
  must perform no final compile pump. Explicit isolated JIT evidence must show nonzero compiled,
  executed, and retired-via-JIT counts; no-isolation must remain a working interpreter.
- **P3 controller parity and ownership:** all allow-listed controller methods must return async
  results across a FIFO lifecycle/input/RPC boundary. Byte arguments/results must transfer exact
  privately-owned ranges: mutating or detaching a caller's larger backing buffer must neither alter
  the sent payload nor corrupt caller accounting.
- **P4 lifecycle and storage:** stop, natural completion, and fatal handling must serialize the
  active loader task before writer-lock release and storage close; no post-termination RPC may run.
  A bounded cleanup failure must fail closed by terminating the Worker rather than closing storage
  under a live task.
- **P5 file-transfer generations:** uploads/downloads must await async controller methods. Replacing
  a controller must abort the old generation, keep reused stream/download IDs separate, and prevent
  a delayed old writer close from overwriting the new generation's same destination.
- **P6 UI/controller methods:** terminal input, pause/resume, persistence, snapshot save/read/
  decision/import/export, chunk stats, upload, and download must all be exercised through the real
  async Worker controller without a Promise being consumed as a synchronous value.
- **P7 responsiveness:** accepted whole-worker runs must have foreground rAF gap p99 <= 20 ms and
  a terminal-input completion plus cheap controller RPC that complete while sustained guest work is
  active. The exact measured latencies must be finite and must come from an accepted identity-bound
  slot, not a calibration/discarded attempt.
- **P8 Node matrix structure:** the accepted ledger must contain exactly six ordered slots across two
  counterbalanced sessions: pass 0 main/interpreter, worker/interpreter, worker/JIT512; pass 1
  worker/JIT512, worker/interpreter, main/interpreter. Each accepted variant must contain two fresh
  processes per session using a nonce/fenced `node -e` command whose output cannot be satisfied by
  shell echo. There must be exactly four accepted runs per variant and no duplicate process identity.
- **P9 Node parity math:** recomputation from accepted raw runs must yield worker/main first-output
  and completion medians <= 1.10, including the claimed cold/subsequent bounds. Both worker sessions
  must satisfy rAF p99 <= 20 ms; JIT512 must report nonzero translated blocks and retired-via-JIT.
- **P10 evidence identity:** results, aggregate, physical ledger, embedded logical ledger, attempt
  sidecars, guest artifacts, browser artifacts, and rr manifests must hash to their declared values
  and bind to runtime/evidence head `aca44846c85ea1e07c9c6d7534203fbab3f3b9f5` (with final
  harness-only head `2b2c34018cfdc546bb32f7f5d6c27e52d89301cc` accounted separately).
- **P11 rr-soft anchors:** all three traces must be packed/replayable. Event 459 in the compile-budget
  and terminal traces must expose the claimed bounded/terminal state; the protocol trace must reach
  clean exit at event 7021 after 22 passing cases, with trace source digests matching `aca4484`.
- **P12 browser/guest parity:** the default Worker and explicit main-thread fallback must restore the
  same immutable BusyBox guest to a real prompt, execute computed output, and expose equal initial
  RAM digests when paused before the first slice. Worker failure must become one clean fatal state.
- **P13 coverage:** every behavioral source hunk must be exercised by accepted browser/Node/rr or
  deterministic focused evidence; generated dist mirrors, declarations, pure reporting, and static
  metadata may be waived only when source-to-dist identity or direct tests cover them.
- **P14 cold clone:** a pristine exact-submission clone with `RUSTFLAGS`, `RUST_LOG`, and all
  `CARGO_*` variables scrubbed must pass task policy plus the focused Rust/Wasm/Node/browser gates
  without relying on ignored/untracked implementation or harness files.
- **P15 bounded novel attack:** an exact subarray of a larger byte buffer will be sent through the
  protocol, then the original buffer will be mutated immediately. The receiving controller must see
  only the original subarray bytes and the caller's backing buffer must remain attached and retain
  its full original length.
