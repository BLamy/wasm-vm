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
