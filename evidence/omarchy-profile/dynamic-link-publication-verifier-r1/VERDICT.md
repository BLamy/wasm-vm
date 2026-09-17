VERDICT: verified

# E5.5-T03bb — fresh-critic verdict

Worker submission: `d35217b4655d77fe762dd5ca98b98313e928c3c1`.
Runtime guard: `0d061fb4`; frozen physical source/harness:
`bd25d4546153b0d4d106960eb62f302a341c17da`.

The disabled dynamic-publication optimization is verified. The physical trial
is a **negative experiment**: desktop responsiveness remains unresolved and
T03q stays gated. No implementation was edited in the working repository.
The sole sabotage mutation was made in a separate temporary clone.

`PREDICTIONS.md` was written after the source/task review and before the worker
logs, recording, or candidate executions were inspected.

## Predictions

- **P1 disabled/enabled publication — HELD.** The exact worker regression passes
  in the clean clone (`cold-publication.log:6–10`). The real browser executor
  independently has zero installs, hits, and live dynamic entries after warm
  disabled execution (`browser-probe-r2.log:15,19,23`). Enabled execution
  publishes and hits the dynamic successor (`:16,20,24`).
- **P2 later toggles — HELD.** Three seeds traverse off → on → off → on on one
  executor per seed. The first enabled stage records one install and 859 hits;
  the next disabled stage leaves the entire public dynamic state unchanged.
  The final enabled stage, after a SUM context change, safely publishes again
  and reaches 1,718 cumulative hits (`browser-probe-r2.log:15–26`). The test
  compares the architecture after every bounded run, so a hit count alone
  cannot satisfy it.
- **P3 authority/remap — HELD.** The bounded novel probe enables a previously
  disabled executor, corrupts only a live target's authority word, and observes
  one refusal, zero hits, two retired caller instructions, and zero target
  side effects. Target invalidation/reinstall restores a valid publication;
  disabling still refuses to enter it, and re-enabling produces one safe hit
  and the expected target value 7. Seeds 3, 19, and 101 all hold
  (`browser-probe-r2.log:29–31`). The existing real-WASM remapped-target,
  SUM-change, and combined-authority cases also pass in the exact clean clone
  (`cold-browser-jit.log:110–111,128–129,138–139`).
- **P4 static chaining and guest equivalence — HELD.** With dynamic publication
  off, the first stage still follows 823/831/823 generated static links for
  seeds 13, 197, and 39729. In total, 51,900 candidate instructions across 180
  run boundaries match the independent interpreter's 32 registers, PC, sampled
  code/data RAM, `minstret`, `mcycle`, and `mstatus`. Quanta rotate through 257,
  511, and 97. Actual JIT calls are required in every stage. Recorded state
  digests include final values `45b177b845522589`, `161c67d7379bfd12`, and
  `502a5a043a83a380` (`browser-probe-r2.log:18,22,26`). The existing guest SMC
  trace retains hash `568b64d33599f3f5` / 20 retired instructions
  (`cold-capacity.log:5`).
- **P5 no hidden disabled publication and sabotage — HELD.** The guard at
  `crates/core/src/lib.rs:4440` encloses the entire `link_dynamic_target` call.
  `BrowserExecutor::dynamic_chaining` only reads its boolean; all target-map,
  authority-fill, and publication work is inside the skipped method
  (`crates/wasm/src/jit_browser.rs:2120`). Thus the absence is stronger than an
  installs counter check. Removing only this guard in the temporary sabotage
  clone fails the worker regression with the actual disabled publication
  `(2147483652, 2147483652)` (`sabotage.log:7–8`, expected exit 101 in
  `sabotage.json`).
- **P6 frozen physical run — HELD as negative.** `browser-check.json` binds 47
  helper sources, 67 deployed Git-backed resources, the exact prepared pair,
  source head, and WASM
  `f09e025172e4a426f45133b57fe3bdb59a4cebb5637396840c3fcbc6c63b9918`
  (1,605,093 bytes). Runtime remains cap 1024, recycling enabled, decoded 16384,
  dynamic chaining disabled, static region chaining enabled, ICount64,
  quantum 500,000, 1280×800, and budgets 300/60/120/20/30 seconds. Both recorded
  runtime observations have zero dynamic installs, attempts, hits, and
  refusals; static links rise from 31,815,972 to 174,679,732. The audit verifies
  all 128 trusted input events against 128 matching keyboard calls and their
  acknowledgments. Independent nonce `626cd9269cfacea8` has no successful raw
  serial fence; all 40 completed readbacks return 75, with one pending when
  the unchanged 120,000 ms deadline expires. The nonce is absent from injected
  serial input. I personally viewed `desktop/failure.png`: the old empty prompt
  remains, with neither typed command nor returned response. SHA256 is
  `431be977157bf77dcd21ca8bf3b640bce9e02dc8c54f09a30d58af78a8195b24`.
  Machine and desktop acceptance remain false. No latency improvement or
  responsiveness pass is claimed.
- **P7 final clean clone — HELD with the existing trace-feature requirement
  made explicit.** The detached `d35217b4` clone has fresh build/npm directories
  and a scrubbed Rust/Cargo/Node environment. Formatting, 357 core tests
  (`cold-core.log:432`), eight capacity tests (`cold-capacity.log:29`), the new
  publication test, WASM checking, 38 browser JIT parity tests
  (`cold-browser-jit.log:151`), and 58 Omarchy harness tests
  (`cold-node.log:61`) pass. Strict all-target clippy passes with `--features
  trace`; strict clippy for the affected library/new test also passes with
  default features (`cold-clippy-affected-default.log`). The single existing
  ignored browser test is the unrelated long externref/eviction churn case;
  no ignored test was added or changed.

## Probe corrections and environment audit

The worker's literal all-target clippy command does not reproduce in a clean
default-feature build: the unchanged `retirement_capture_baseline` example
imports `trace::VecSink`, which requires `trace` (`cold-clippy.log`).
`resume-cold.py` records the explicit `--features trace` correction and completes
the remaining gates without changing source. Default-feature strict clippy for
the affected code is independently clean. This is an existing example feature
dependency, outside the changed boundary; the original failure is retained.

The initial standalone probe allowed dependency resolution to select newer
compatible cached packages. The final probe starts from the frozen workspace
lockfile. `integrity.json` confirms every final dependency version/source is in
that lockfile, with only the verifier package added. The preliminary metadata
network failure and initial probe log/lockfile are retained as setup history.

The first authority probe wrongly assumed that publishing the identical target
would repair a deliberately corrupted private authority word. Existing
`DynamicLinkCache::publish` returns early for the same physical target/table
index (`jit_browser.rs:467–475`), so the guard continued to refuse safely.
That supplementary rearm assertion failed, while the forbidden target never
executed (`browser-probe-r1.log:55–58`). The final attack uses the supported
target invalidation/reinstall path before demanding rearm. The original probe
source is retained in `browser-probe-initial.rs`; this correction changes no
runtime code or acceptance criterion.

## Coverage and retained suite

- The one runtime guard executes both outcomes in the native hook test and
  real WASM machine probe. Static edges exercise its short-circuit case. The
  physical run executes the disabled production path with the original guest.
- New harness experiment selection, option construction, URL generation,
  runtime assertions, source identity, and failure recording execute in the
  58-test suite and exact physical run. Fixed settings and one-candidate
  rejection are asserted by the promoted harness test. No deadline, input,
  geometry, or renderer policy changed.
- Generated WASM/service-worker identity is derived data, checked against
  frozen Git bytes. Declarations and experiment-name lists are structural;
  they introduce no separate unexecuted runtime claim.
- The fake native executor proves the call boundary only. The independent
  probe uses the actual `BrowserExecutor`, compiled WASM, actual guest machine,
  and interpreter oracle. Its authority fixture supplies decoded operations
  and asserts externally visible side effects; it is not a replacement
  executor. Static and dynamic state assertions cannot pass without compiled
  execution.

Retain the worker publication regression and harness identity test. Retain
`browser-probe/` as the reproducible bounded verifier test: run
`CARGO_NET_OFFLINE=true wasm-pack test --mode no-install --node
evidence/omarchy-profile/dynamic-link-publication-verifier-r1/browser-probe
--locked --offline --test boundary -- --nocapture` with the recorded Node path
and `DEVELOPER_DIR=/Library/Developer/CommandLineTools`.
`run-sabotage.py`, `run-cold.py`, and `resume-cold.py` record their exact commands.
`integrity.json` binds source/dependencies and the eight physical evidence files;
`sha256.txt` seals this verifier directory. No deployment or T03q release gate
is opened by this verdict.
