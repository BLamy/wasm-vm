# E9-T11 verifier refutation

VERDICT: refuted at runtime 7d52129e9277468cb2d8e8cfc83571d9d7fb8334.

The admitted actual Wasmtime configuration records an armed RTC poll every 6 transitions under budget 6, but replay budget 1 requests its second poll at 385 instead of recorded 390. Same-budget replay is an exact positive control. Both replay cases make 0 live RTC calls. The source tape, native frames, exact reproduction and repeated failing transcript are retained here; receipt.json authenticates this capsule.

The permanent failing regression is in the already-selected `e9_event_clock_critic` binary:

```sh
cargo test -p wasm-vm-jit-runtime --test e9_event_clock_critic time_entropy -- --nocapture
```

It also covers an unarmed guest RTC read after compiled compute. The independent byte quota regression is permanently selected in `e9_time_entropy`:

```sh
cargo test -p wasm-vm-core --features trace,virgl-renderer --test e9_time_entropy critic_byte_budget -- --nocapture
```

Earlier fixed-board/native/browser/persistence results remain HELD at their recorded digests in held-ledger.json. Runtime semantics must be corrected and recorded again before this task can be verified. The verifier changed tests/evidence/task metadata only.
