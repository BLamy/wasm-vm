# E5-T26e remediation 3 verifier results

Implementation under review: `ea14c48f12a323ff60fb21744a34c10e814cd68a`.
Submitted evidence head: `ebc9c91ecc8d56dfbaa27d10ee12c0ca0e21c794`.

## Commands and observed results

1. `env -u RUSTFLAGS -u RUSTDOCFLAGS -u CARGO_ENCODED_RUSTFLAGS -u CARGO_TARGET_DIR
   -u CARGO_BUILD_TARGET -u RUST_LOG make verify-E5-T26e`
   - Exit 0. Passed 12 desktop-restore tests, one console restore fence test, one live
     Machine/console integration test, 9 envelope tests, 6 GPU tests, 12 input tests, 6 sound
     tests, format, both core clippy legs, and the no-default-features wasm32 build.
2. `node --test web/tests/agent-channel.test.mjs web/tests/e5-t26e-desktop-restore.test.mjs
   web/tests/e4-t32-worker-protocol.test.mjs`
   - Exit 1: 42 passed, 1 failed.
   - Failure: `every explicit controller method crosses the runtime...` stopped in the worker
     runtime's `startBoot` fixture with `AssertionError: fake must implement confirmAgentHello` at
     `web/tests/e4-t32-worker-protocol.test.mjs:201`. The test therefore never dispatched either
     new restore RPC across the worker boundary.
3. `cargo check -p wasm-vm-wasm --target wasm32-unknown-unknown`, syntax checks for all changed
   modules, and source/dist `cmp` for `agent-channel.js`, `desktop-restore.js`,
   `linux-worker-protocol.js`, `loader.js`, and `main.js`.
   - Exit 0.
4. `cargo test --manifest-path evidence/e5-t26e/verifier-r4/native-attack/Cargo.toml --
   --nocapture`
   - Exit 0: 6 passed. Transport-only READY refused; one confirmed HELLO could not be reused;
     disconnect erased the HELLO fence; missing GPU/input/sound/agent all selected cold fallback;
     the missing-agent attack began with a dirty sink plus non-cold input and sound snapshots and
     ended with zero retained frames and byte-exact power-on device snapshots.
5. `cargo test -p wasm-vm-core --lib --features gpu-trace dev::virtio::console::tests --
   --nocapture`
   - Exit 0: 5 passed, including lifecycle reset and restore re-handshake.
6. `node --test evidence/e5-t26e/verifier-r4/presentation-attack.test.mjs`
   - Exit 0: 2 passed. The real `PresentationController` moved from 640x480 to retained 1024x768,
     entered fixed-viewport mode, discarded its dirty retained frame, and preserved the 1280x720
     guest scanout in the report; a mismatched report cleared the same real owner and refused.
7. `shasum -a 256 evidence/e5-t26e/native-remediation3.json`
   - Observed `f2dcfeea18f12dcfd190ad0028e3a780b313cc80909405612bfe06101f3cffc8`, matching the worker log.
   - JSON `implementationCommit` is the exact real implementation hash above. `git diff
     ea14c48f..ebc9c91e` contains only evidence/task/queue metadata.

## Prediction classifications

- **P1 HELD.** Core readiness is the intersection of transport readiness and an unconsumed
  application HELLO (`console.rs:218-230`); commit consumes that generation (`:337-354`). The
  public-API attacks prove transport READY and a previously consumed HELLO both refuse.
- **P2 NEEDS EVIDENCE.** The real T22 owner attack and the page closure at `web/main.js:2268-2277`
  held. The wasm and loader methods compile, but the mandatory all-method worker integration test
  fails before it can dispatch `confirmAgentHello` or `restoreDesktopSnapshot`; the claimed
  production worker leg is therefore not demonstrated at this head. Pixel CRC and reload remain
  outside this verdict under E5-T26f.
- **P3 HELD.** All pre-backend missing-component branches call the shared cold fallback
  (`crates/core/src/lib.rs:1778-1803,1841-1867`). The independent six-test harness exercises each
  branch, including dirty presentation/input/sound state and present-agent restart.
- **P4 FAILED (coverage), HELD (identity).** The evidence names the exact implementation hash and
  semantic core/page hunks are exercised. The changed worker allow-list hunk is not covered because
  its repository integration fixture is stale and red.
- **Novel attack HELD.** Reusing the still-open transport after one successful restore, without a
  second application HELLO, returned `agent_refused` and selected cold fallback.
