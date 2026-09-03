---
id: E4-T34
epic: 4
title: Short-block JIT acceleration for restored Node startup
priority: 434
status: verified
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
### 2026-09-02 — verifier — VERDICT: verified (user-directed debt closure)

User directed this verification-debt sweep to accept the existing implementation and historical
verification record and move on. Independent-machine, WebKit, and other environment-specific
follow-up legs are out of scope by direction. This administrative promotion adds no new runtime
claim or evidence artifact; the prior log remains the record of implementation and caveats for
E4-T34.


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

### 2026-08-31 — worker checkpoint — publish bounded JIT as the isolated-worker default

- Release commit: `375154c`. The browser page and loader now enable the bounded JIT by default on the
  cross-origin-isolated whole-machine Worker; `?jit=0` remains the explicit interpreter rollback/A-B,
  and non-isolated pages continue to fall back to the interpreter. The focused default-worker test
  expectation was updated, and the architecture note plus roadmap now describe the shipped policy.
- `make web-build` and `make web-dist` completed at this head. Cloudflare Pages published the complete
  `web/dist` as preview `https://d5623124.wasm-vm.pages.dev` and production `https://wasm-vm.pages.dev`.
  The live `main.js` SHA-256 is
  `b0ec2f912af9ff38c762f94609d51f732a73f8c09c06b638bc53fc20e0b164a9`, exactly matching local
  `web/dist/main.js`; the live `loader.js` SHA-256 is
  `3f928bab885e04df1a220fb081b86c32ed17195b395c6dc9c57b3df5c63b8a23`, exactly matching local dist.
- A fresh production browser smoke at `/app.html?guest=busybox&nosw&testHooks=1&diagnosticStats=1`
  restored the whole-machine Worker, displayed `JIT enabled, threshold 512`, accepted the real
  terminal command `printf PROD_DEFAULT_JIT_OK`, and returned the marker. Diagnostic stats recorded
  `hasExecutor=true`, 1,898 compiled blocks, 11,147,103 executed blocks, and 121,547,462
  instructions retired through JIT, with zero retranslations and zero evictions. Full structured
  evidence is in `evidence/e4-t34/production-default-jit-2026-08-31.json` (SHA-256
  `7b234115e70d21b71b3778445e3422778c3b7d8941a5ebdc742380197e52f556`).
- This is a shipped product-default correction, not an E4-T34 acceptance claim. The matched local
  restored-Node characterization was 12,686 ms with JIT versus 18,542 ms for the fast interpreter
  (1.461x), while the required 3x / <=20-second target and <=5-second stretch remain unclaimed.
  E4-T34 stays `in-progress`; no rr host trace is claimed on macOS.

### 2026-09-01 — worker checkpoint — publish the unified external Node workload comparison

- Benchmark commits: `8bb138c` and `1bc60f0`. The legacy five-mechanism Node benchmark and its
  `bench-node-runtimes` target, source JSON, runner, and deploy copies were removed. The single
  portable `web/bench-runtime-workloads.mjs` contract now drives the landing-page matrix and keeps
  raw samples, fixture/policy digests, runtime identity, and verification results in
  `web/runtime-benchmarks.json`.
- Exact fixture/policy: runner SHA-256
  `094dd31c872b6fdf080d022add317f40dde128c219342db33d7ba3504add69fb`, 1 MiB payload, 64 KiB
  stream chunks, 64 KiB HTTP body, seven measured samples, two warmups, and eight sequential HTTP
  requests. Native Node, all three wasm-vm modes, and WebContainers completed all six workloads;
  WebContainers used `@webcontainer/api 1.6.4` and measured file read 2.650 ms, file write
  0.670 ms, stream read 20.065 ms, stream copy 10.015 ms, server lifecycle 19.735 ms, and HTTP
  round trip 16.975 ms median. almostnode (`@agent-wasm/core 0.4.0`) measured file read 12.960 ms,
  file write 1.405 ms, and server lifecycle 0.015 ms; its stream and HTTP cells retain explicit
  unsupported reasons rather than timings. WebVM is listed in `notRun`: the exact 1 MiB run hit a
  loopback `EADDRINUSE`, and a fresh 1 KiB file-read retry exceeded the four-minute bound.
- Evidence: `/tmp/webcontainers-runtime-workloads.json` (42/42 measured samples verified),
  `/tmp/almostnode-runtime-workloads.json` (partial with explicit unsupported cells), and the
  committed public JSON. `node --test web/tests/runtime-workloads.test.mjs` passed; `make web-dist`
  passed; the rebuilt local page rendered 7 rows with zero browser errors/warnings; after fixing
  shell cache invalidation, the production page at `https://wasm-vm.pages.dev/` rendered the same
  7 rows with zero browser errors/warnings, and the live JSON was byte-identical to
  `web/dist/runtime-benchmarks.json` (SHA-256 `a455f3d0c4793f8771d0c049f9ddb0058ca8609e0ae5b41385314ba8e59b2185`).
- This publishes measurable cross-runtime evidence but does not claim E4-T34's JIT acceptance:
  the JIT remains only marginally ahead of the worker interpreter on this workload, WebVM still
  needs a completed exact run, and the task remains `in-progress`. No rr host trace is claimed on
  macOS.

### 2026-09-01 — worker checkpoint — wrap unavailable workload diagnostics

- UI correction commit: `ccec954`. Unsupported workload cells now use a bounded, wrapped summary
  (`stream API is not async iterable`, `output capture file unavailable (ENOENT)`, and `HTTP
  response returned 403`); the WebVM `notRun` row uses the same treatment. The complete raw reason
  remains in the cell title and `web/runtime-benchmarks.json`, so the display no longer turns a
  stack trace into horizontal overflow or hides the remaining workload columns.
- Evidence: `evidence/e4-t34/runtime-workload-diagnostics-ui-2026-09-01.json`. The local and
  production browser checks each rendered 7 rows, all six workload columns, zero console
  errors/warnings, no raw `Error:` or local harness URL, and no document horizontal overflow
  (`1120px` table inside a `1245px` production document). The production JSON was byte-identical
  to the committed capture (`a455f3d0c4793f8771d0c049f9ddb0058ca8609e0ae5b41385314ba8e59b2185`).
- Gates: `git diff --check`; `node --check` for the benchmark and merge scripts;
  `node --test web/tests/runtime-workloads.test.mjs`; `make web-dist`; direct in-app browser
  verification of the built page; and Cloudflare Pages deployment `https://d7da14a2.wasm-vm.pages.dev`
  with production verification at `https://wasm-vm.pages.dev/?verify=ccec954`. The proxy/Tailscale
  fallback was not available from this host (`ssh dev` did not resolve and no local Tailscale
  binary was present), and WebVM remains explicitly unmeasured; E4-T34 stays `in-progress`.

### 2026-09-01 — worker checkpoint — separate steady-state compute from boundary workloads

- Benchmark commits: `bff0154` and `d05be4c`. `web/bench-runtime-compute.mjs` defines the portable
  `node-steady-state-compute-benchmark-v1` campaign with fixed `integer-mix`, `branch-mix`, and
  `memory-mix` workloads. Process startup, module loading, and typed-array preparation are outside
  the timed region; every warmup and measured sample checks an independent fixed checksum. The
  browser adapter is `tools/run-runtime-compute-browser.mjs`, with the matching
  `bench-runtime-compute-browser` Make target.
- Native exact-head evidence is
  `evidence/e4-t34/steady-state-compute-native-2026-09-01.json`, SHA-256 recorded by the file
  contents. Seven measured samples and two warmups passed `21/21` checksum checks on Node
  `v24.20.0`/`darwin-arm64`: integer mix median `10.146 ms`, branch mix median `3.275 ms`, and
  memory mix median `2.506 ms`. The existing release differential remains the complementary
  boundary screen: six-op JIT `97.403 MIPS` vs interpreter `77.018 MIPS` (`1.265x`), while the
  64-op hot loop is `725.329` vs `107.125 MIPS` (`6.771x`).
- The bounded direct-call optimization passes the virtual successor PC as the third direct-chain
  argument, lets the caller debit successor fuel/depth once, and skips the callee's duplicate
  handoff/prologue work; budget exhaustion still writebacks and returns `Budget`. Exact-head gates
  passed: `cargo fmt --all -- --check`; strict translator and wasm-target Clippy; translator
  all-target tests; `wasm-pack test --node crates/wasm --test jit_browser_parity` (`25 passed,
  0 failed, 1 ignored`); `node --test web/tests/runtime-compute.test.mjs`; `make web-build`; and
  `make web-dist`.
- The new artifact is published to `https://wasm-vm.pages.dev/` (preview
  `https://77c48a08.wasm-vm.pages.dev`). Live `bench-runtime-compute.mjs` SHA-256 is
  `378e4841d50b8165fdee7d15ffe8daf0d2e6a40145982e8525b161696342d8d7`, matching
  `web/dist/bench-runtime-compute.mjs`; live `main.js` SHA-256 is
  `b0ec2f912af9ff38c762f94609d51f732a73f8c09c06b638bc53fc20e0b164a9`, matching local dist.
  The fresh deployed Node tab had not reached a shell during bounded checks (cold boot stopped at
  OpenRC hardware scan), so no browser compute timing or JIT speedup is claimed here. E4-T34
  remains `in-progress`; the required restored-Node `3x` result, `<=5s` stretch target,
  fourfold boundary-rate improvement, full adversarial evidence, and rr/rr-soft trace remain open.

### 2026-09-01 — worker checkpoint — publish compute results on the landing page

- UI/publication commit: `933e828`. The landing page now renders the separate steady-state compute
  campaign from `runtime-compute-benchmarks.json`, with native median/p95/rate cells and the
  separate native JIT handoff diagnostic. The displayed native medians are integer mix `10.15 ms`,
  branch mix `3.27 ms`, and memory mix `2.51 ms`; the diagnostic displays `1.265x` for the six-op
  boundary loop and `6.771x` for the 64-op hot loop. Browser rows remain visibly `not measured`
  until an exact restored-Node capture completes.
- Evidence: `evidence/e4-t34/landing-compute-production-2026-09-01.json`. The local and live
  compute JSON are byte-identical at SHA-256
  `5bc6cc5a96429b7acea6e5d15601f0ee9e3fcebb8cf000ed451c1e4a912b4915`. A fresh production browser
  load at `https://wasm-vm.pages.dev/?verify=compute-ui-2` rendered four compute rows, the native
  medians, both diagnostic ratios, and zero browser console/page errors.
- Gates: `git diff --check`; `node --test web/tests/runtime-compute.test.mjs web/tests/runtime-workloads.test.mjs`;
  `bash -n tools/build-web-dist.sh`; `make web-dist`; direct production browser verification; and
  `bash tools/deploy-cloudflare.sh` (preview `https://8f507961.wasm-vm.pages.dev`). This is a
  publication/UI correction only, not an E4-T34 acceptance claim; the restored-Node browser
  timings, JIT speedup, adversarial proof, and rr/rr-soft trace remain open.

### 2026-09-01 — worker checkpoint — valid deployed browser compute captures

- Fresh production captures used the exact checked-in runner `web/bench-runtime-compute.mjs`
  (12,030 bytes, SHA-256
  `378e4841d50b8165fdee7d15ffe8daf0d2e6a40145982e8525b161696342d8d7`) inside the deployed
  `node-alpine` image. Both clean runs reached `guest ready` with the whole-machine Worker, used
  `persist=0` plus the explicit single-user `/bin/sh` init, and produced seven measured samples per
  workload with every fixed checksum passing and zero browser console errors.
- Worker + JIT medians were integer 262.859 ms, branch 267.866 ms, and memory 734.393 ms.
  The matched worker interpreter medians were integer 262.895 ms, branch 267.875 ms, and memory
  296.868 ms. JIT/interpreter median ratios were 0.999863x, 0.999966x, and 2.473803x respectively:
  this valid capture shows no integer/branch gain and a memory-mix regression, so it does not satisfy
  the JIT speedup acceptance criterion.
- A main-thread control produced checksum-valid samples but was rejected as browser evidence after
  one real `main.js` console error (`dropped a terminal input chunk: re-entrant call into
  WasmMachine`). It remains unmeasured in the public comparison rather than being presented as clean.
- Evidence: `evidence/e4-t34/browser-compute-captures-2026-09-01.json`; the public artifact now
  contains the two clean captures and the explicit rejected-control reason. E4-T34 remains
  `in-progress`; this is steady-state compute evidence, not default restored-startup timing, and no
  rr host trace is claimed on macOS.
- Publication proof: `make web-dist` followed by `bash tools/deploy-cloudflare.sh` completed with
  preview `https://45f696b2.wasm-vm.pages.dev`. The local, `web/dist`, and live
  `runtime-compute-benchmarks.json` files are byte-identical at SHA-256
  `3a2070175a1b2abdc454476af5c2650ea565399a4a6beb1404bdc7b6bfe4f2ae`. A fresh production browser
  load at `https://wasm-vm.pages.dev/?verify=jit-capture-20260901-v3#benchmarks` rendered the JIT
  and worker-interpreter rows, the explicit rejected main-thread control, and the diagnostic ratios
  with zero console errors; the published compute screenshot was captured from that view.

### 2026-09-01 — maintainer — parked as verification-debt (status made consistent)

- Brett's direction: the active lane has been pinned to this task for ~3 days across 13
  below-bar measurements (best 1.46x vs the 3x criterion; latest valid production capture
  shows integer/branch parity and a 2.47x memory-mix regression). The measured root cause —
  host-boundary/engine-entry rate (~2.45 logical blocks per engine call, see
  `docs/perf/e4-t34-jit-retrospective.md`) — is architectural and is owned by the pending
  fusion tasks E4-T35/E4-T36/E4-T37, not by further tuning inside this task's seam.
- Status flipped `in-progress` → `verification-debt` to match the 2026-08-30 maintainer
  parking entry; the frontmatter had drifted. The 3x/host-boundary-4x acceptance criteria
  and the adversarial sweep remain owed and re-open after E4-T35/E4-T36 land.
- Environment note: verification no longer targets `ssh dev` (host retired). Local machine
  is now an M4 Max / 16 cores / 128 GB; long in-browser captures previously reaped on the
  old Mac are expected to hold here and Linux-only tooling runs in a local Docker (colima)
  container. rr/rr-soft host-layer traces are waived by maintainer direction 2026-09-01
  (see AGENTS.md); guest-layer traces, deterministic tests, and Playwright captures are the
  evidence of record.
