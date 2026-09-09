# E5-T26i final-head pristine-clone proof

Date: 2026-09-08 UTC. Target: `faddd274c934e09aec18161758c690a3b87bde8e`. Clone: `git clone --no-local --no-checkout`, detached checkout in `/private/tmp/e5-t26i-final-clone.OWiaJX/repo`. Initial `git status --short` was empty. The diff from runtime source `99b8e692fddb7b1e82e4175e152ef5682c6b9373` contains only generated `web/dist` and task metadata; no runtime, harness-source, or Makefile change.

Inherited environment audit found only `RUST_LOG=warn` and no `CARGO_*`; every prescribed command ran with `RUST_LOG`, `RUSTFLAGS`, `RUSTDOCFLAGS`, `CARGO_TARGET_DIR`, and `CARGO_BUILD_TARGET` unset.

## Commands and status

1. `make verify-E5-T26i-runtime` — **exit 0**. Formatting and both clippy legs passed; 6 CPU-resume, 7 desktop-resume, 5 guest-clock, 6 filtered time/SBI, 3 JIT-time, and 1 native WASM-wrapper tests passed; 95/95 JS tests passed; harness syntax check passed.
2. `wasm-pack test --node crates/wasm --lib --test guest_clock -- guest_clock --nocapture` — **exit 0**. Three exported-wrapper and five shared guest-clock WASM tests passed. The known unrelated `hart_ctrl` unused-import warning remained nonfatal.
3. `make web-dist` — first sandboxed attempt reached the release build then exited 2 because wasm-pack could not operate its external cached optimizer (`EPERM`). Direct execution of that cached `wasm-opt` succeeded and produced SHA-256 `30c8f2ab3b1f3c25db77c03d6161d39e55de7ea3d88447f83f5d7942952c3a28`. Repeating the same scrubbed command with access to wasm-pack's user cache — **exit 0**. This establishes an execution-sandbox limitation, not a source/build failure.
4. `E5_T26I_WORKER_OUT=/private/tmp/e5-t26i-final-clone.OWiaJX/worker-proof node tools/verify/e5-t26i-clock-worker.mjs` — **exit 0** using Chrome `152.0.7977.76`; errors `[]`. Record SHA-256: `5fb33d391dee2c3bfd071b4e71e8772bece4148e1a2f29445503272b61f49a99`.

The rebuilt WASM is byte-identical at all three locations (`crates/wasm/pkg`, `web/pkg`, `web/dist/pkg`): SHA-256 `30c8f2ab3b1f3c25db77c03d6161d39e55de7ea3d88447f83f5d7942952c3a28`.

## Fresh browser recomputation

| Backend | Mode | Guest delta | Host delta | Ratio | Pause exact | Resumed wall delta | ICount final |
|---|---:|---:|---:|---:|---|---:|---|
| direct | icount | 110.000 ms | 731.525 ms | 0.1504 | yes | n/a | `retired/10` exact |
| direct | wall | 744.435 ms | 742.620 ms | 1.0024 | yes | 0.0499 ms | n/a |
| worker | icount | 100.000 ms | 668.735 ms | 0.1495 | yes | n/a | `retired/10` exact |
| worker | wall | 662.8899 ms | 663.845 ms | 0.9986 | yes | 39.205 ms | n/a |

All independently recomputed UART, pause, rate, and ICount invariants hold. Embedded loader/clock/protocol/WASM/harness digests match the rebuilt clone.

## Scoped cleanliness exception — not a T26i finding

Initial clone cleanliness **HELD**. After successful `make web-dist`, `git status --short` contains exactly:

```text
 M web/dist/artifacts-node-alpine.json
 M web/dist/artifacts.json
```

These two manifests are byte-unchanged across `65e99f2e..faddd274` (`git diff --quiet` exit 0), predate T26i/T19a, and are explicitly excluded from the clock release/cleanliness claim in `evidence/e5-t26i/submission/README.md`. The coordinator restores their exact user-owned bytes after builds. Neither the hash-bound synthetic UART manifest nor the authenticated desktop source manifest reads them. Under the verifier NO-FIRE rule this is a carried scoped exception, not a T26i refutation or remediation demand.

For reproducibility only, the post-build exception's combined diff SHA-256 is `640fedb322f8505f670ae2e77431b627b9e5c1beb96d3e853d27fb67f970175e`. Regenerated file SHA-256 values are `9e28ead1264e08a806ef7fd3159813163ca26d4caf85071923b20467f3fa35dc` and `86cd0e8049ca1943848bfe3215d36e53e705cdb986b61d37a6aa2e92d5c27543`; restored/committed values are `46b0201e3565d5c391f53eb4b8bc467f167ddeae735dcb5b4005f346b3c3a223` and `6804121c85af2abd5342857855d3568748b986de46b8c54cf70737820d10ec03` respectively. No gates or clone need repeating for this exception.

The external 1 GiB authenticated desktop comparison remains the coordinator's separate pending evidence. No T26i verdict or task status change is made here.
