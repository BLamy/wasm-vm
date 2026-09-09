# E5-T26k — frozen native/WASM, portability and adversarial results

Bounded stage complete: no runtime refutation found. **Final verdict awaits new
built-browser/cold-seal/ABBA evidence for P4–P7.** No task status change or F
verification. Predictions are the earlier `preflight.md` ledger, not captions
written after inspecting these runs.

## Exact boundary and worker recording

Reviewed frozen `a53e51a6caf6eb542e4fa2ef4c039f84298a5ec6` against `a3792366` before
the worker logs. Mechanically compared all 19 preflight file hashes to this commit:
all match. Additional generated wrapper/export changes expose the strict raw
JsValue setter; the roadmap labels K in progress. No new runtime discrepancy.

Read all three worker logs: runtime contains 7 new native tests, 16 affected
integrations (6 CPU resume, 7 desktop resume, 2 predecode including 127 official
ELFs, 1 SMC), 60+168 JS tests, fmt/clippy and no_std wasm build. WASM contains
3 capacity + 5 guest-clock + 11 divider tests. No ignored/skipped selected tests.
The official-ELF differential uses 4096/1/off; it is not evidence that all 127 ran
at 16384. The new capacity tests independently cover both supported sizes.

Worker hostile-SMC trace: `runtime.log:13` hash `568b64d33599f3f5`, 20 retirements;
both supported sizes match the legacy trace/retirement/snapshot tuple. The clone
reproduces it. The ordinary hello/loops/memops differentials reproduce 83/48/117
retirements and hashes `ec6e61a286135dfd` / `b39f666fdc661b5d` / `7b228482bdef09dd`.
The inherited desktop continuation remains `9865e79b681ad970`, one retirement.

Worker web-dist log is build evidence, not a browser proof. Read-only parity checks
match source/dist decoded-cache.js, loader.js and desktop-terminal.js. Served and
dist WASM match SHA `041a86da41dbbd66b887dc480a93e25c60316c77030f6e1044cd46f4db31999f`.
No web/pkg or dist build was performed by this critic.

## One pristine local proof — HELD

`run-pristine.mjs` made one file-transport shallow `git clone --no-local` of the
frozen branch into `/private/tmp/e5-t26k-verifier-SrjasM/repo`. It asserted exact
HEAD and empty `git status --porcelain=v1 --untracked-files=all` before work.
Target `/private/tmp/e5-t26k-verifier-SrjasM/target` was absent, then created empty;
no shared or existing built target was reused. Normal dependency downloads/caches
were allowed; pinned npm dependencies installed offline with lifecycle scripts
disabled and browser downloads disabled.

All inherited `CARGO_*`, `RUSTFLAGS`, `RUST_LOG`, wrapper/rustdoc overrides and
task/Node options were filtered. Only RUST_LOG was present among the removed keys;
the sole effective CARGO_* key was the explicitly assigned scratch target.
The wasm-pack runner adds its required target runner for its child normally.
Tools: cargo/rustc 1.96.0, wasm-pack 0.15.0, Node v24.20.0.

Commands (full argv/env disposition/timestamps/statuses in `pristine-run.json`):

```text
npm ci --offline --ignore-scripts --no-audit --no-fund --prefix web
make verify-E5-T26k-runtime
wasm-pack test --node crates/wasm --test decoded_cache_capacity --test icount_divider --test guest_clock
```

All exited 0: the same 7 new core + 16 integration + 228 JS + 19 WASM tests pass,
including the real compiled-cache assertions and 127-ELF differential. Clone began
11:58:27 UTC; runtime completed 12:00:29; WASM completed 12:00:49. Final tracked
and untracked status remained empty. The unrelated existing hart_ctrl unused-import
warning did not require a code change. The pristine checkout was never mutated.

## Bounded novel pending-patch attack — HELD

After pristine acceptance completed, copied that checkout to a separate
`attack-repo`; only this copy received the included verifier test. Its target reuse
was the critic's own just-built target, never the coordinator's target.
`pending_patch_attack.rs` tests 12 combinations: two capacities, same-size versus
invalid 8192 selection, and independently chosen immediates 7/127/1021.

Each case warms a live cursor at the next cached instruction, writes a replacement
`addi x2,x0,immediate` through the logged bus code-page path, then performs selection.
It requires unchanged cursor/discovery/counters/pending log/snapshot before guest
execution, then exactly one retirement with x2 equal to the new immediate, unchanged
x1, PC+4 and increased invalidation count. The old cached addi would give a distinct
value. This is the logged DMA/host-write seam, not a new full DMA-device claim.

The native test exits 0, all 12 cases pass (`pending-patch.log:7` onward).
The one-retirement trace hashes are `ccf9f08b9d663d89`, `a6814ebb10165a01`,
`efda15432ec439d3` for 7/127/1021, identical across both sizes and selections.
Keep this deterministic source as a candidate regression artifact; it has not
been inserted into shared test source while the runtime is frozen.

## Executor-invalidation sabotage — test sensitivity HELD

Only the scratch copy's real-resize `executor.invalidate_all()` block was removed;
exact mutation is retained in `executor-invalidation-sabotage.patch`. Ran only
the new real-WASM resize regression with its existing assertions unchanged:

```text
wasm-pack test --node crates/wasm --test decoded_cache_capacity -- resize_clears_real_compiled_and_discovery_state_preserving_guest_bytes_and_policy --nocapture
```

Predicted nonzero test exit and a live compiled block surviving resize. Observed
exit 1: `executor-invalidation-sabotage.log:24`, test source line 126 reports
`compiledBlocks` **1.0 instead of 0.0**. One test failed; two were filtered, not
silently treated as passing. The identical unmutated regression passed in the
pristine WASM run. This is successful falsification of the mutant, not a product
failure. Scratch source was then restored byte-for-byte; its build target may
still contain the deliberately mutant build and is not an acceptance artifact.

All heavy commands finished at **12:02:46.996 UTC**, under six minutes from the
11:57:02 review start, before the requested eight-minute boundary. No browser was
launched, no shared runtime/web/pkg/HEAD changed, and no second clone was made.

## Coverage disposition

- P1/P2 HELD for primitive-only selection, invalid nonmutation, exact no-op,
  bounded/public versus pathological/core-only capacity and actual reporting:
  deterministic native + real JsValue/WASM tests plus scratch pending-patch case.
- P3 HELD for changed resize boundary: native snapshots/traces, live core state,
  aliases/PMP/SMC, real compiled WASM state and mutation-sensitive regression.
  Unchanged device and architectural evidence carries; no unrelated expansion.
- P4 HELD for native/WASM restore/capacity retention and deterministic loader/
  linked-protocol ordering/refusal. Actual built Chromium pre-pump/restore path
  remains NEEDS EVIDENCE, as planned.
- P5/P6 HELD for deterministic admission/observer/collector and unchanged T0/cap
  wiring; actual post-restore worker capacity/clock/PCM/physical input still awaits
  the new run. Fixture-shaped Node records are not actual capacity measurements.
- P7 NEEDS EVIDENCE for the new authenticated cold seal and all four raw ABBA
  arms. No result from the old F seal or successful local build substitutes.

No remaining native-stage blocker. Do not repeat this pristine proof or held
gates absent a relevant changed boundary/portability finding. Wait for the central
browser evidence; no current task status or default-policy recommendation.

## SHA-256 pins

Relative to `evidence/e5-t26k/` unless prefixed with `web/`.

| Artifact | SHA-256 |
| --- | --- |
| gates/runtime.log | 7594cf1f865a12f231489a77bfcf676ff46ca34a00aca07b41946ed5c81e8ab7 |
| gates/wasm.log | 24e285e1585b7f9cf3a4f903b54e16c31e9169a4490c07ca219e4aebc3afb6e8 |
| gates/web-dist.log | 3d0f5b71f885f5d94ab09fa2bcf8e0ba949c845522c449047d7b1ec062232eb9 |
| verifier/pristine-run.json | 686d75d33465a5f2f089cf0005842fd804eb61404af620e36197f1ebbfd525ea |
| verifier/pristine-runtime.log | 3bf67a0a926ad5bbf4fb9091e7506d15f2f43fb32329ad1bc7ddd2937e6f7960 |
| verifier/pristine-wasm.log | 203fcaddacaaaade8f47dd6895ec3a790d4e50b664c05e4a2cce3730e0818099 |
| verifier/pending-patch.log | a0abcb64c3ee9d27d0ce95740e441acdebf82c38294149367dc51dd9ead27211 |
| verifier/executor-invalidation-sabotage.log | 949130be7eed1c7592c05419153dd43f8407ea99a01b293331dd9b6ecae0c0d0 |
| verifier/pending_patch_attack.rs | 4a9f27f14655ebc344da2202f900a7ddaf66126d39c6789b35d4551fcaf2284a |
| verifier/run-pristine.mjs | d3e50aad26265f951fa074a272e7ed5b0b4f6df33d28ff8ebd42fc27f1af00dd |
| verifier/run-focused.mjs | 446b902d3e9998844b36aed77ee72998b496173bbceb2847ecea214e41c1fbbe |
