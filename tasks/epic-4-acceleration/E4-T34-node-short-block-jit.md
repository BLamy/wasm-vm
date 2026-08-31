---
id: E4-T34
epic: 4
title: Short-block JIT acceleration for restored Node startup
priority: 434
status: in-progress
depends_on: [E4-T32]
estimate: S
risk: high
capstone: false
---

## Goal

Make the JIT accelerate the real restored node-Alpine workload rather than merely report high
translated retirement. Remove the measured boundary cost of Node/V8's short, memory-heavy and
indirect basic blocks with one bounded execution seam (for example guarded dynamic-target fusion,
shared compiled-state chaining, or the equivalent measured design) while preserving exact budgets.

## Acceptance criteria

- The validated deployed-R2 Node ELF and snapshot run a non-echo-spoofable fresh
  `node -e` computation in the foreground worker in <=20 seconds median, complete in <=25 seconds,
  and at least 3x faster than the same-head browser main-thread fast-interpreter path. Record the
  remaining gap to the <=5-second stretch target.
- JIT wall time is faster than worker interpreter wall time on the same restored image, with positive
  compiled/executed/retired deltas and no threshold-1-style compile/RSS storm.
- The measured host-boundary rate improves by at least 4x over the current approximately five guest
  instructions per compiled dispatch, without hiding work, counter, interrupt, or fault accounting.
- Precise faults, timer/device interrupts, dynamic-target changes, SMC invalidation, eviction, and
  CLI/Node architectural output remain exact across native and browser executors.

## Adversarial verification

Change a previously monomorphic `jalr` target mid-run, fault in the middle of a fused short-block
chain, make an interrupt pending at every remaining-budget tail, rewrite a linked page, and churn the
smallest cache budget. Compare exact counters/PC/registers against interpreter and require the real
Node result, not a synthetic ALU proxy. Any stale target, duplicated side effect, budget overshoot,
compile pause storm, or JIT wall-time loss refutes the change.

## Verification log

### 2026-08-12 — worker checkpoint — hidden-primer regression removed

- This is a bounded product correction inside the still-open E4-T34 lane, not a claim that the
  task's JIT or 20-second acceptance criteria are complete. The restored Node guest no longer starts
  a full invisible Node process by default; `?nodeWarmup=1` keeps the old behavior available only for
  controlled experiments. Switching to the Demo tab now re-fits xterm locally instead of clicking
  the manual Fit action and injecting `stty` into a command already in flight.
- Frozen wasm: `055fcde43e90dcfe8ee265fe19050b6ba387f607eccfa6430ebdf21247613b61`
  in both `web/pkg` and `web/dist/pkg`; the regenerated service-worker version is
  `3de893a6aaa1`. Source and dist copies of `main.js` and `tabs.js` are byte-identical.
- Accepted default-URL evidence (no `nodeWarmup` query):
  `/private/tmp/e4t34-prime-ab/default-c/E4T32_NODE_DIAGNOSTIC_RESULTS.json`, SHA-256
  `f65bbb5daa701b04d184b8f9ea57216106d0f60212acf140c7e95b057fae14cc`. It records a
  restored whole-machine Worker, `nodeWarmupStateAtCommand=disabled`, zero production-R2 requests,
  zero browser errors, clean pre/post CPU calibration, exact PID 839 and byte-framed output `3` from
  the real `node -e 'console.log(3)'`: 94,063.015 ms first output and 97,373.315 ms completion.
- Two additional clean explicit-off screens were consistent: 90,564.715/93,634.785 ms and
  92,790.730/95,887.740 ms (first/completion), median 91,677.723/94,761.263 ms. Three opt-in-primer
  controls were rejected by the host-capacity gate and are not benchmark evidence; their diagnostic
  timing suggested overlap was neutral-to-worse, never a valid speedup. The measured first-command
  time therefore remains far above the task target and the next slice must improve it directly.
- Gates: `make web-dist`; JS syntax and `git diff --check`; focused Playwright tab test 1/1.
  A fresh critic independently validated the default artifact, source/dist/Wasm binding, and
  sabotaged the tab test with the old implicit Fit behavior; the sabotage was rejected. Verdict:
  verified for this correction only, while E4-T34 remains `in-progress`.

### 2026-08-12 — worker checkpoint — warm first-command release screen

- The shipped Node snapshot had deliberately dropped Linux's file page cache before capture. A paired
  post-Node snapshot screen reduced the real fresh `node -e 'console.log(3)'` command from the clean
  91,677.723 ms first-output baseline to 27,420.160 ms, with zero lazy-disk chunk fetches and
  246,120,921 retired instructions instead of roughly 390 million. Its post-run host calibration was
  contaminated, so this is a release-screen/mechanism result rather than final task acceptance; it
  nevertheless clears the bounded keep threshold by a wide margin and preserves the exact PID-bound
  112-byte output oracle, exit 0, restored Worker backend, zero browser errors, and zero R2 requests.
  Evidence: `/private/tmp/e4t34-warm-screen/candidate-b/E4T32_NODE_REJECTED_worker_interp_prime_default.json`,
  SHA-256 `aace01a33f15d55bf6afdea3fbf1c5c58a66201abf98ba8bb9e0ce52a43b6200`.
- Promoted pair: snapshot 36,865,908 bytes / SHA-256
  `f28f90de26bbe35d927a3f53767b3c0469964d1803d0ab21f2c4d5f008dce37f`; overlay 20,341 bytes /
  SHA-256 `aaa8a967e7191f8dfbf3033646a18e354dced181c0afa0720c1672918fac57a6`.
  Both bind to the exact Node base `ac6a2988…b1c1`, generation 0; raw replay exports are byte-identical.
- A release-safety guard now arms the RAM restore only for a wholly fresh overlay or an existing
  valid overlay whose complete block index/value set exactly matches the paired delta. Changed,
  added, missing, malformed, orphaned, or duplicate state is preserved and cold-boots. Large boot
  artifacts use an immutable content-addressed R2 key with full-body size/SHA verification; smaller
  boot artifacts remain on Pages.
- Gates: storage overlay-delta tests 7/7; wasm32 package check; `cargo fmt --all -- --check`;
  `node --check` for loader and benchmark harness; `bash -n` for serving/deploy scripts;
  `git diff --check`; fresh `make web-dist`. E4-T34 remains `in-progress`: this product win does not
  claim the JIT-specific <=20-second or dispatch-density acceptance criteria.

### 2026-08-30 — maintainer — parked as verification-debt

The historical E4-T34 work is being returned to the parked lane because the task still has no exact-
head proof for its JIT-specific acceptance criteria. A direct-chain prototype passed focused native
tests, strict clippy, and the browser parity suite, but the required real restored-Node wall-time
screen and full adversarial evidence were not completed; the Playwright benchmark runner hung before
producing a run. No `verified` claim is made. The prototype and generated artifacts are preserved in
the recoverable stash `WIP E4-T34 direct-chain prototype — narrow gates only; not acceptance evidence`
for a future fresh worker slice.

### 2026-08-30 — worker checkpoint — bounded direct-chain and inline-memory pass

- This exact-head checkpoint advances the implementation, but does not satisfy E4-T34 acceptance;
  the task remains `in-progress`. The production browser executor now uses bounded direct chaining,
  dynamic-target linking, inline RAM loads/stores with an explicit raw-store commit log, partial
  cross-page code invalidation, and a wider but bounded 64 MiB/1024-batch production code working
  set. The existing E4-T32 per-quantum limits remain unchanged at eight translation attempts and
  64 staged nominations.
- Implementation commit: `ff007d2c4fa680829f7c5fc4d72269cf79fb1026`. The follow-up bookkeeping
  commit records this hash without changing the runtime implementation.
- The real restored Node foreground command `node -e 'console.log(3)'` produced exact PID-bound
  byte-framed output and exit 0 in 17,317.110 ms on the worker JIT path. The matched same-head
  main-thread interpreter completed in 22,773.495 ms, a 1.315x completion speedup rather than the
  required 3x. The foreground <=25 s criterion held; the <=5 s stretch and 3x criterion did not.
  JIT deltas were positive (2,209 compiled blocks, 14,523,809 executed blocks, 143,132,801 JIT
  retired instructions); cache evictions and retranslations were zero in this screen. Full details
  and hashes are in `evidence/e4-t34/node-optimization-screen-2026-08-30.json`.
- Gates completed: `cargo fmt --all -- --check`; strict Clippy for the wasm-facing and native JIT
  crates; full native core/runtime/translator tests; `wasm-pack test --node crates/wasm
  --test jit_browser_parity` (20 passed, 0 failed, 1 ignored); and `make web-dist`. The direct
  headed Playwright manual run passed the Node oracle. The repository Playwright test runner was
  separately attempted against the built page but hung before launching Chromium and was stopped;
  it is not counted as evidence. No rr host trace is claimed on macOS.

### 2026-08-31 — worker checkpoint — guarded cross-batch and safe inline-store pass

- Implementation commit: `2b14a3cc6641e232ec94869dc90e8b2cdb7526d1`. This is a bounded worker
  checkpoint, not a verification claim; E4-T34 remains `in-progress` because the required 3x
  restored-Node speedup and exact-head adversarial evidence are still outstanding.
- The browser inline-TLB ABI now publishes static cross-batch successors through the guarded
  virtual-PC funcref map after resolution, while retaining the host-return path for `fence.i`
  successors. Raw aligned RAM stores stay inside a chain for ordinary data pages through a bounded
  host commit log. A one-byte-per-RAM-page compiled-code bitmap raises the existing chain barrier
  before a raw store can re-enter stale code; pending raw stores also stop before LR/SC/AMO imports
  so host-owned reservation invalidation is committed before an atomic observes it. The focused
  translator and browser parity tests exercise each path.
- Exact-head gates completed: `cargo fmt --all -- --check`; `cargo check -p wasm-vm-wasm
  --target wasm32-unknown-unknown`; `cargo test -p wasm-vm-core --lib` (173 passed); all-target
  translator tests (batch, inline-TLB, and differential suites green); all-target runtime tests
  (including chaining, invalidation, lockstep, precise-trap, timekeeping, and JIT matrix suites
  green); `wasm-pack test --node crates/wasm --test jit_browser_parity` (23 passed, 1 ignored);
  targeted strict Clippy for `wasm-vm-core`, `wasm-vm-jit-translate`, and `wasm-vm-jit-runtime`;
  and `make web-build`.
- The full `make ci` gauntlet remains environment-blocked at the pre-existing macOS
  `wasm-vm-wvseccomp` libc API errors. A full-workspace all-features Clippy fallback excluding
  that crate also stops on pre-existing `live_blocks` and `fetch_phys` dead-code diagnostics.
  These unrelated platform/configuration failures were not changed in this slice.
- The repository Playwright runner was retried with a unique diagnostic environment and again
  blocked in Node before starting its web server; the exact restored-Node screen therefore remains
  characterization only. The prior same-head screen measured 1.315x completion speedup, not the
  required 3x. No fresh six-slot ledger, deployed claim, or rr host trace is asserted here.

### 2026-08-31 — worker checkpoint — preserve valid browser compile batches

- Source/test commit: `15b4b746e5c799d0eb04a6e93a60fac74e32df28`. The browser installer now probes
  each nominated block before translation, removes unsupported members from the module candidate,
  and remaps intra-batch edges only across the remaining translatable members. Unsupported blocks
  stay on the interpreter path instead of forcing every valid neighbor into one-block WASM modules.
  The new `browser_batch_skips_unsupported_members_without_fragmenting_valid_blocks` parity test
  proves two supported blocks share one module around an unsupported CSR block and that the CSR
  block is not registered. The mechanically equivalent `contains_key` cleanup is included so the
  affected wasm-target lint gate is clean.
- Deployable artifact commit: `d7a90a5be64fc7601afdad37224a3fbc14d63622`; `make web-dist` refreshed
  the generated browser JS/Wasm and service-worker cache version. No Cloudflare deployment or
  acceptance claim is made from this checkpoint.
- Exact-head focused gates completed: `cargo fmt --all -- --check`; `cargo clippy -p wasm-vm-wasm
  --target wasm32-unknown-unknown --lib -- -D warnings`; strict Clippy for
  `wasm-vm-core`, `wasm-vm-jit-translate`, and `wasm-vm-jit-runtime`; translator all-target tests;
  `wasm-pack test --node crates/wasm --test jit_browser_parity` (24 passed, 0 failed, 1 ignored);
  `make web-build`; and `make web-dist`.
- A fresh local built-page smoke used `tools/serve-dev.sh 8141` with the Node asset bundle and the
  exact PID-bound `node -e 'console.log(3)'` oracle. It reached a real root prompt, emitted the
  completion marker with exit 0, and produced no browser console errors; completion elapsed was
  `39,877 ms`. The renderer was visibly host-contended and this was not a matched JIT/interpreter
  ledger, so it is characterization only. E4-T34 remains `in-progress`: the required <=20-second
  / 3x restored-Node result, <=5-second stretch, six-slot ledger, adversarial evidence, and rr
  trace are still outstanding.

### 2026-08-31 — worker checkpoint — bound direct-chain depth

- Source/test commit: `2adc78caea70043b4f964df9e82445a88a8f192f`. The browser-only auxiliary ABI now
  reserves `chain_depth` at `0x260`, after the existing chain header and before the raw-store log;
  the store-log base moves to `0x268` and the frozen register handoff remains unchanged. Each
  generated compiled-block entry rejects a zero remaining depth before executing guest code,
  decrements the depth on entry, and requires a nonzero remainder before making either a static or
  dynamic direct successor call. `BrowserExecutor` initializes the field from its configured depth
  budget, and `browser_inline_direct_chain_honors_depth_budget` proves two linked blocks execute
  exactly four instructions and return at the boundary rather than recursing indefinitely.
- Deployable artifact commit: `3395bb4ad8580cdeb60355e4a2d6135b48fe01c5`; `make web-build` and
  `make web-dist` regenerated the browser Wasm and service-worker cache version. No deployment or
  acceptance claim is made from this checkpoint.
- Exact-head focused gates completed: `cargo fmt --all -- --check`; `cargo test -p wasm-vm-core
  --lib` (173 passed); all-target translator tests; `cargo test -p wasm-vm-jit-runtime --all-targets`
  (all non-ignored tests passed); strict Clippy for `wasm-vm-core`, `wasm-vm-jit-translate`, and
  `wasm-vm-jit-runtime`; wasm-target Clippy for `wasm-vm-wasm`; `wasm-pack test --node crates/wasm
  --test jit_browser_parity` (25 passed, 0 failed, 1 ignored); `make web-build`; and `make web-dist`.
- This slice closes a boundedness/proof gap, not the performance debt. The prior matched restored-Node
  screen remains 1.315x; the later local smoke was 39,877 ms under renderer contention and was not a
  matched ledger. E4-T34 remains `in-progress`; the <=20-second / 3x result, six-slot ledger,
  adversarial proof, and rr/rr-soft host trace remain outstanding.

### 2026-08-31 — worker checkpoint — retain live register handoff seam

- Implementation commit: `7323fbb`. The browser direct-chain ABI now keeps the integer register
  image, chain budget/depth, and enabled flag in per-module globals across same-module calls. Root
  and cross-module entries reload only the statically required source/destination registers;
  host-boundary writeback uses the generated dirty mask, and the Rust handoff skips unchanged
  register marshaling using a non-architectural mutation stamp. The legacy ABI remains unchanged.
  Added deterministic core tests for masked commit/x0 preservation and equality ignoring the stamp,
  plus direct-chain ledger assertions in the browser parity suite. `web/dist` was regenerated.
- Exact-head gates: `cargo fmt --all -- --check`; strict Clippy for native JIT crates and the
  wasm target; `cargo test -p wasm-vm-core --lib` (175 passed); translator all-target tests (10
  passed, 2 ignored) and inline-TLB tests (7 passed); runtime all-target tests (20 JIT/config,
  3 lockstep, 5 precise-trap, 3 timekeeping, plus the other non-ignored tests passed);
  `wasm-pack test --node crates/wasm --test jit_browser_parity` (25 passed, 0 failed, 1 ignored);
  and `make web-dist`.
- Evidence: `evidence/e4-t34/register-handoff-screen-2026-08-31.json`. A fresh restored Node
  worker screen at threshold 2048 emitted exact `node -e 'console.log(3)'` output with no browser
  console errors in 12,686 ms; the matched main-thread fast-interpreter screen completed in
  18,542 ms, a 1.461x speedup. The diagnostic worker screen recorded positive deltas of 3,662,853
  executed blocks and 128,040,640 JIT-retired instructions, 23,993,000 generated direct-chain
  entries, zero retranslations, and zero cache evictions. This proves the handoff seam and safety
  counters, but does not meet the required 3x speedup or <=5-second stretch target: E4-T34 remains
  `in-progress`. No rr host trace is claimed on macOS, and no full `make ci` claim is made because
  the known macOS `wasm-vm-wvseccomp` libc API errors still block that workspace gate.
