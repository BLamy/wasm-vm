# E5-T26n — SPP cache-context proof

Runtime freeze: `84fd5190832924a0f609b4a10d1bfaee2704dc0e`.
This is a worker/integration record, not the independent verdict or a latency claim.
The only production change adds saved supervisor previous privilege (bit 8) to
the cached mstatus projection. Current mode, live mstatus, all other status bits,
satp, PMP, TLB flushes and trigger state remain authoritative.

## Frozen source and build

- `crates/wasm/src/jit_browser.rs`:
  `62f0599f20d8faeb26dcb6d0664b795bf27daed562d27ce86b29860bb42fc7b0`.
- `crates/wasm/tests/jit_browser_parity.rs`:
  `ecaca332a6d0474eb67614c2dd7e295de8da0b14520d8d43f8ca5f5d6fad3016`.
- `Makefile`:
  `c4a4da2a59db318ddc90d49244db7f5f92d4b3f3ff511e1785ba31399afe691f`.
- Release WASM, 1,550,137 bytes:
  `84b2c17c9b6ab9d86c85912f82bd0b4b4533178fc27a0724d47565cb40974b4d`.

`worker/claim.md` identifies the exact guest words, checkpoints and raw focused
records. The three new private actual-WASM tests prove real SRET-to-S reuse,
U-fetchable compiled entry followed by an S-only store fault, and pending STIP
preemption followed by authentic guest SBI timer cancellation and nested SRET.
They compare the required architectural fields, all RAM and actual CLINT mtime
to the interpreter; JIT/cache observations are separate. The superseded full CPU
serialization comparison included a polling-time shadow and is explicitly not
claimed. No clock was normalized and no runtime timer behavior was changed.

## Frozen runtime and demo records

`env -u RUSTFLAGS -u RUSTDOCFLAGS -u RUST_LOG make verify-E5-T26n` passes scoped
format/clippy, 29 native tests, both target builds and 50 actual-WASM tests
(12 library plus 38 parity). The pre-existing E4-T33 long churn ignore and
out-of-scope `hart_ctrl.rs` warning are unchanged, not new proof or waivers.
`main-gates/05-frozen-runtime.log` includes the exact head/source/build hashes;
log SHA256 `afdbf4431d99274d09fdcc6e5ba49b23f9b434cf6d530b871afe7b1c69378d96`.

`E5_DEMO_TASK=E5-T26n E5_DEMO_OUT=evidence/e5-t26n/demo-84fd5190 node tools/verify/e5-t18e-demo-smoke.mjs`
loads the built demo once: 126 passed, 0 failed, empty collected console/page/HTTP
errors, and the task visible as in progress. Main viewed the actual PNG.
JSON SHA256 `a458cbf70dc97312e4859c43ac23ecfdacd71deb189711fda8536aacd66a5be3`;
PNG SHA256 `9c180395102fa34e02feaabab09468a02f97de467f71c64ff9d0858b18c0420d`.

## One unsafe-SUM negative control, isolated and restored

An initial in-place test command was rejected by safety review before execution
because it did not contain guaranteed restoration. Main immediately restored
the correct source, confirmed its SHA256, and froze the runtime above. No test
ran under that rejected command and no weakened build was published.

The one executed sabotage used a `git archive` of the frozen head at
`/private/tmp/e5-t26n-sum-sabotage.V25LdQ1A`, not a portability clone. Only its
private copy of the mask added SUM (bit 18); source SHA256 became
`8836344d412aac35e04edff752a227ae61a728ac29c37d6af79c39f952c2ba2c`.
Separate local target output was used. An EXIT/signal trap restored the archived
correct source from its hash-checked backup. The real workspace stayed unchanged
throughout both runs.

Commands, each with `env -u RUSTFLAGS -u RUSTDOCFLAGS -u RUST_LOG -u CARGO_TARGET_DIR`:

- `wasm-pack test --node crates/wasm --lib -- --nocapture inline_tlb_context_masks_exactly_interrupt_stack_bits`:
  exit 1, the bit-18 retained-authority assertion fails at log line 85.
- `wasm-pack test --node crates/wasm --test jit_browser_parity -- --nocapture browser_inline_dynamic_link_retains_across_interrupt_stack_bits_and_sum_invalidates`:
  exit 1, the actual generated target retires 4 rather than the required 2
  (log lines 18–20). The test detects stale target entry, not merely a helper mismatch.

Raw logs `main-gates/02-sum-sabotage-private.log` and
`03-sum-sabotage-dynamic.log` have SHA256 values
`99dc84c60f09300f295e051d778597c3589acea28459f664f0f51881dbfd8507` and
`1c6db881a182198ccf3a42c6670f5a6743bf2c802e0207f8e9f6658da0c566e7`.
The parent command explicitly required both exit codes to be 1 and both semantic
failure messages, then exited 0. `07-restored-source.log` records both scratch
and real workspace restored/correct at the frozen source SHA256; its digest is
`203a56d91de6aff66660d5cb10c3126255c627b943a50e24f94c9108e97901c3`.

## Promoted test and final clean proof

The critic's independently passing SSIP variant was promoted, with rustfmt only,
at final test head `b50491ceafc5be9029ee96dc9229085efd354e22`. Its only new source
hunk is a private test; production WASM remains byte-identical. Final source
SHA256 is `0b0830a1ea2f0c979ca4ae662b281b5e6c0044b7ce6964a52715ed887861deb8`;
the parity and Makefile digests above remain unchanged. The promoted harness
passes 51 actual-WASM tests (13 library plus 38 parity), scoped fmt/clippy;
`main-gates/08-promoted-harness.log` SHA256 is
`e4703396e8b1f5d8d7d1d7da7d69444efb8ddd14cc72684ed65fe8310dcf6c9a`.

The one final pristine proof is
`bash evidence/e5-t26n/run-final-clone.sh b50491ceafc5be9029ee96dc9229085efd354e22`.
It passes the full scoped target: 29 native and 51 actual-WASM tests, format,
clippy and both target builds. It checks a clean exact checkout, no object
alternates and fresh target, scrubs compiler/test environment overrides, and
ends clean with exit 0. Retained clone:
`/private/tmp/e5-t26n-final.s8BFQMCn/repo`.
`main-gates/09-final-clone.log` SHA256 is
`d58a1ff05e933b7f28dc9d9563702e7e5bf534cf2db2dcb89b17173bc2f86b06`.

The pre-evidence predictions and provisional audit are in `verifier/`.
Only the fresh critic may issue the final task verdict. No F deadline, speedup,
deployment or Epic 5 completion is established here.
