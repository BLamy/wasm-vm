# E5-T26i critic — interim evidence review

This is not a verdict. The paired authenticated desktop comparison and coordinated final exact-head clone are still pending. Runtime/harness source remains frozen at `99b8e692fddb7b1e82e4175e152ef5682c6b9373`; browser bundle commit `bfebb8d42f065196735df088c6d4b2ed8da62e77` changes only generated dist/task metadata from that runtime head.

## Artifact authentication

- `evidence/e5-t26i/worker/guest-rdtime.json`: SHA-256 `e33a52f024c9031f82e3995175f973ed217655f519ea836f8bfbe3c32ecd059e`; embedded head `bfebb8d42f065196735df088c6d4b2ed8da62e77`; Chrome `152.0.7977.76`; errors `[]`.
- Every embedded digest for built `loader.js`, `guest-clock.js`, `linux-worker-protocol.js`, WASM, and the UART harness exactly matches `git show bfebb8d4:<path>`. This binds the execution to the frozen source's generated bundle rather than the working tree.
- `submission/runtime.log`: SHA-256 `49c8c420a40359d06b6a955793d78c72a9e1ca8d291fc8fa014c1856ed7c7a09`; records 6 CPU-resume + 7 desktop-resume + 5 guest-clock + 6 filtered time/SBI + 3 JIT-time + 1 native-wrapper tests, all passing, followed by 95/95 JS tests and the harness syntax check.
- `submission/wasm.log`: SHA-256 `a219b2a51b9668c43a4f6ba4c08ab7fbc0570bfe96d8f19b6ed8ec5500d0ed3d`; 3 exported-wrapper and 5 shared guest-clock WASM tests pass. The unrelated pre-existing `hart_ctrl` unused-import warning is not a T26i finding.
- `demo/demo-suite.json`: SHA-256 `47036998a0d7577fc54455ca8f326134cd9528fd23b2a165e120327b845ae489`; exact metrics 126 passed, 0 failed, 126 done, with browser/HTTP errors empty. The inspected PNG SHA-256 is `7ee1ac7b4ddf3ea4f723d7bf0aee03d16d86f15f454a9cdd55c582ffe433bcd8` and visibly shows E5-T26i as **IN PROGRESS**, making no default/speed/F claim.

## UART guest-clock proof

The fixture's instruction words contain a UART-LSR polling loop, one `rdtime`, eight byte stores, and a backward branch; there is no WFI. The returned UART byte arrays independently decode to each recorded decimal tick value.

| Backend | Mode | Guest delta | Host delta | Guest/host | Pause state | Resume wall delta |
|---|---:|---:|---:|---:|---|---:|
| direct | icount | 110.000 ms | 718.660 ms | 0.1531 | exact equal | n/a |
| direct | wall | 724.990 ms | 724.430 ms | 1.0008 | exact equal | 0.285 ms |
| worker | icount | 100.000 ms | 657.890 ms | 0.1520 | exact equal | n/a |
| worker | wall | 648.285 ms | 646.490 ms | 1.0028 | exact equal | 44.445 ms |

Both wall ratios satisfy the declared 0.7–1.3 real-monotonic bound. Both ICount final `mtime` values are exactly `13,000,000 retirements / 10 = 1,300,000`. Initial states report the selected mode, decimal-string `mtime`, 10 MHz timebase, and divisor 10. All four pause snapshots are unchanged across the real 500 ms pause; resumed wall deltas are nonnegative and below 250 ms. This is actual direct and whole-worker guest-visible `rdtime`, not query or host-timer evidence.

## Prediction disposition so far

- P1 default/selection atomicity — **HELD** by native wrapper, WASM wrapper, JS validation, and worker-protocol tests.
- P2 real realm-monotonic source — **HELD** for the built direct/worker route by exact bundle binding plus the near-1.0 wall `rdtime` ratios; no RTC/JIT profiler source substitutes.
- P3 busy rate and ICount control — **HELD** by the authenticated UART record and recomputation above.
- P4 backward jitter — **HELD** by shared native+WASM busy-guest fixtures.
- P5 explicit pause/resume — **HELD** by native/JS ordering tests and both real browser backends.
- P6 ordinary background gap — **HELD** by the deterministic core fixture; no browser gap is required to restate the unchanged E4-T24 policy.
- P7 successful fresh/same-machine restore and deadline — **HELD** by shared native+WASM fixtures; desktop execution remains part of P12.
- P8 rejected restore atomicity — **HELD** for CPU/RAM/CLINT/CLOCK and WASM malformed blob. Host reads remain unchanged on refusal.
- P9 portable wire and ICount oracle — **HELD** by byte-equal save/restore, trace hash, snapshot digest, sub-tick phase, and exact browser retirement control.
- P10 worker/WASM ownership — **HELD** by current-state RPC tests and real direct/worker UART execution.
- P11 conservative JIT/default/F boundary — **HELD** statically and by unchanged JIT-time tests; the final unprofiled desktop record is pending.
- P12 paired desktop sufficiency — **NEEDS EVIDENCE**. Require same authenticated image/checkpoint/snapshot, worker-reported mode/ticks, real marker/visual change, attached non-silent PCM, and honest unchanged F timing for both modes.
- P13 repeated-rebase novel attack — **HELD**; see `attack-results.md` and `novel-repeated-rebase.rs`.
- P14 frozen-source sabotage — **DETECTED**; the first expected 1,000,000-tick wall sample became zero and the test failed.

## Coverage remaining

Core/time/WASM adapter, JS validation/lifecycle, protocol RPC, direct/worker guest execution, roadmap, and demo hunks are exercised. The changed desktop query path and T26f diagnostic sampling/reporting hunks require the forthcoming paired desktop run. `tools/verify/e5-t26i-browser-clock.mjs` is syntax-checked but not behaviorally covered until that run. No task status change is warranted yet.
