# E5-T26n scoped worker submission

Worker implementation and focused self-validation complete; **not a verifier verdict**.
No commit, branch, task/status/queue, demo/dist, image, harness, polling, budget or clock
implementation edits. Only `crates/wasm/src/jit_browser.rs`,
`crates/wasm/tests/jit_browser_parity.rs`, `Makefile`, and this worker evidence directory
were written. Existing unrelated tracked dirt is listed in `tracked-status.log`; M's
worker narrative directory was not touched.

Activation was `fbf21d4c1e0e10705e515986080f5015715e3b0f` on
`codex/e5-t26n-spp-context`. Main advanced metadata/preparation to
`5ebcc9df69b16885fd4c35f9c3a43c673080340a` during implementation. Final records are for
the uncommitted three-file diff on that base, **not an exact committed-head submission**.
See `base-head.log`, `source-diff.log`, `source-sha256.log`, and `log-sha256.log`.

## Frozen source identity

| File | SHA-256 |
| --- | --- |
| crates/wasm/src/jit_browser.rs | 62f0599f20d8faeb26dcb6d0664b795bf27daed562d27ce86b29860bb42fc7b0 |
| crates/wasm/tests/jit_browser_parity.rs | ecaca332a6d0474eb67614c2dd7e295de8da0b14520d8d43f8ca5f5d6fad3016 |
| Makefile | c4a4da2a59db318ddc90d49244db7f5f92d4b3f3ff511e1785ba31399afe691f |

The only production Rust behavior change is additional ignored bit 8 at
[jit_browser.rs:135](/Users/blamy/Documents/Codex/wasm-vm/crates/wasm/src/jit_browser.rs:135).
Mode/satp/PMP revision/flush count/trigger-idle comparisons and all other mstatus bits
are unchanged; the projection never writes live mstatus. Existing M's private matrix
at line 2365 now expects exactly `{1,3,5,7,8}` and includes bit 8 in its mixed
ignored-plus-retained control. This supersedes, rather than reuses as SPP proof, M's
historical exact-four-bit assertion. Existing static/dynamic reuse loops and combined
SUM control are extended in place at parity-test lines 1152, 2016 and 2105. No duplicate
64-bit matrix or broad new authority matrix was introduced.

`verify-E5-T26n` at [Makefile:1229](/Users/blamy/Documents/Codex/wasm-vm/Makefile:1229)
depends on the **unchanged** `verify-E5-T26m-runtime` recipe.

## Recorded commands and results

All test/check output was captured directly with `2>&1 | tee <log>` under
`set -o pipefail`; these logs are not reconstructed narratives. Paths below are under
`evidence/e5-t26n/worker/`.

| Actual command | Raw log | Result |
| --- | --- | --- |
| `wasm-pack test --node crates/wasm --lib -- browser_guest_sret --nocapture` | `sret-check-3.log` | exit 0; 3 passed, 0 failed |
| `wasm-pack test --node crates/wasm --lib --test jit_browser_parity -- --nocapture` | `wasm-focused-final.log` | exit 0; library 12 passed; parity 38 passed, 1 pre-existing ignored |
| `cargo fmt --check -p wasm-vm-wasm` | `fmt-final.log` | exit 0; empty stdout/stderr |
| `cargo clippy -p wasm-vm-wasm --lib --test jit_browser_parity --target wasm32-unknown-unknown -- -D warnings` | `clippy-final.log` | exit 0 |
| `git diff --check -- crates/wasm/src/jit_browser.rs crates/wasm/tests/jit_browser_parity.rs Makefile` | `diff-check-final.log` | exit 0; empty stdout/stderr |
| `make -n verify-E5-T26n` | `make-dry-run.log` | exit 0; recipe inspection only, not execution of the full runtime gate |

The affected WASM gate is real Node `WebAssembly.Module`/`Instance` execution through
the BrowserExecutor, not a mock or a browser-screen claim. Its final totals are at
[wasm-focused-final.log:79](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26n/worker/wasm-focused-final.log:79)
and [line 161](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26n/worker/wasm-focused-final.log:161).
The ignored test is unchanged `browser_handles_remain_bounded_across_retranslation_churn`
(E4-T33 long churn). wasm-pack's build phase reports the existing out-of-scope
`hart_ctrl.rs` unused `Exception` import and its wasm-bindgen prebuilt-install fallback;
neither prevented actual execution. No warning or ignore was introduced or suppressed.

## New guest evidence

All new tests are private actual-WASM tests in `jit_browser.rs`, starting at line 2441.
Guest words are written to RAM and decoded from those same words. SRET remains the
encoded `0x10200073`, executed through Machine, never a host call to `csr.sret()`.
Cache/JIT knobs are configured before installing/attaching the stable boxed executor;
`is_compiled` is asserted immediately before every fixture run. A private NonNull
observer only reads/borrows the same Box outside Machine execution; no production API
or substitute executor was added. Warmup populates decoded metadata, then performs real
S-mode compiled R/W accesses and successful successor fetches before publishing links.
Blocks are installed in separate batches, preventing an intra-batch bypass of guards.

- **S return and live checkpoint** — [test:2796](/Users/blamy/Documents/Codex/wasm-vm/crates/wasm/src/jit_browser.rs:2796),
  final log lines 30–34. Initial `SPP=1/SPIE=1/SIE=0/MPRV=0`. After `run(1)`:
  PC `0x80001000`, mode S, full mstatus `0xa00000022` (SPP0/SIE1/SPIE1),
  retire/cycle `[8,8]`, unchanged registers/RAM/trap CSRs, zero new compiled entries.
  Subsequent eight instructions produce PC `0x80006000`, x5=42, x6=x7=1, RAM DATA=42,
  retire/cycle `[16,16]`. Independently: one compiled host entry, eight JIT retires,
  PIC hit +1/live=1, and byte-identical R/W/EXEC words plus static/dynamic publication
  and authority arrays. Both generated target effects occurred.
- **U entry then S-only store refusal** — [test:2830](/Users/blamy/Documents/Codex/wasm-vm/crates/wasm/src/jit_browser.rs:2830),
  final log lines 24–28. Encoded SRET lands at U-fetchable `0x80001ffc` in mode U;
  the one-op compiled block ends at the page boundary and attempts an S-only DATA store.
  Actual compiled host entries increase by one, its cached context records mode U, and
  the store faults precisely: PC handler `0x80005000`, sepc `0x80001ffc`, scause 15,
  stval `0x80004000`, SPP0/SIE0/SPIE1. The failed store does not retire; counters remain
  `[8,8]`. All RAM is unchanged, neither successor effect occurs, all R/W/EXEC and both
  link-publication/authority arrays are zero, PIC live=0, no new hit/indirect dispatch.
  This is not merely a denied landing fetch.
- **Authentic timer source, preemption, nested return** — [test:2882](/Users/blamy/Documents/Codex/wasm-vm/crates/wasm/src/jit_browser.rs:2882),
  final log lines 36–42. Encoded guest SBI TIME `set_timer(0)` drives STIP from the real
  CLINT/SBI deadline source; no fixture `set_mip_bit` remains. STIE is enabled while
  SIE=0, and STIP is asserted before the outer encoded SRET. `run(2)` retires only SRET
  then takes the pending interrupt: sepc `0x80001000`, scause `0x8000000000000005`,
  stval0, mode S, full mstatus `0xa00000120` (SPP1/SIE0/SPIE1), no target effect or
  compiled entry, retire/cycle `[17,17]`, mtime10. The handler executes guest
  `TIME.set_timer(u64::MAX)`; SBI success is asserted, the next timer boundary clears
  STIP, and STIE remains enabled. After restoring SBI argument registers, nested encoded
  SRET is checkpointed at LAND in S with SPP0/SIE1 and `[21,21]`, mtime14. The compiled
  chain then produces the same target effects with `[29,29]`, mtime22, and preserved
  authority/PIC reuse. No raw pending-bit clear, mask/delegation change, host clock write,
  budget change, or source relabeling is involved. The source contract is
  [core/lib.rs:3429](/Users/blamy/Documents/Codex/wasm-vm/crates/core/src/lib.rs:3429)
  and [sbi/time.rs:22](/Users/blamy/Documents/Codex/wasm-vm/crates/core/src/sbi/time.rs:22).

At every named checkpoint, exact interpreter equality covers PC/current mode/all 32
integer registers/full mstatus/S and M trap CSRs/minstret/mcycle, the live CLINT mtime
when present, and **all RAM bytes**. JIT counters are asserted separately, never placed
in the oracle-equal architecture record.

## Superseded attempts and comparison boundary

Retained raw attempts: `fmt-initial.log` failed formatting (then scoped rustfmt was
run); `sret-initial.log` rejected a misplaced wasm-pack filter before running tests.
`sret-check-1.log` passed the first draft but used the subsequently rejected raw STIP
clear and lacked the requested immediate positive checkpoint: it is **not final proof**.
`sret-check-2.log` passed S/U but failed an extra full serialized-CPU comparison in the
real-timer case. That serialization includes the cached CSR `time` shadow: at the
timer baseline it was 6 in the batched machine and 8 in the interpreter, despite equal
architectural retire/cycle counts and equal actual mtime9. Existing device sampling is
boundary-based ([core/lib.rs:4650](/Users/blamy/Documents/Codex/wasm-vm/crates/core/src/lib.rs:4650));
the shadow is refreshed by `sync_clint` at line 3387. The final tests compare the
requested architectural fields plus the actual CLINT source, not full serialized CPU
equality or an out-of-band cached `time` shadow. No clock was normalized or modified.
The excluded shadow comparison is explicitly not claimed as proven by this submission.

## Remaining integration/proof work

Main owns the one SUM sabotage, final integration/freeze, remaining native/runtime
gates, demo and the final pristine-clone record. Daybreak owns fresh independent
review and its pending-source variant after the frozen diff. This worker did not run
the sabotage, full gauntlet, native gate, demo, browser screen, or clone. Earlier
unchanged M authority results are regression context, not fresh SPP evidence.

No correctness-verifier verdict or performance causality is claimed. The recorded F
3701.995 ms failure and separate latency/PCM observations do not identify a cause;
this submission neither promises a speedup nor satisfies/weakens F's two-second gate.
