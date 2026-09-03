# E4-T35 local verification record

Implementation head: `6b3cca5` (`feat(jit): add edge-local static links`).

This is the exact local Node/Wasm evidence for the edge-local static-link slice. Per the user's
direction, independent machines, WebKit, and host-layer rr evidence are out of scope. The browser
execution evidence is the real `wasm-pack test --node` path with WebAssembly compilation,
instantiation, inline-TLB imports, link publication, invalidation, and register/memory readback.

## Acceptance and adversarial observations

- `browser_inline_static_cross_batch_load_store_matches_interpreter` executes caller and target in
  one warm engine call, retires 8 instructions, and matches the interpreter's complete register
  file and data word (`5 -> 8`).
- `browser_inline_static_chain_reaches_five_blocks_in_one_engine_call` executes six separately
  installed modules, five edge-local links, and 12 instructions in the warm call; it records at
  least five logical direct-chain entries and five links.
- `browser_inline_static_cross_batch_link_executes_and_misses_safely` proves the op-zero/unarmed
  target miss: the caller retires exactly 2 instructions, resumes at the target PC, and leaves the
  target register unchanged before the link is published.
- `browser_inline_static_cross_batch_target_fault_is_precise` proves a linked target fault returns
  `Trap` at the target PC with exactly the 2 caller instructions retired and no target destination
  register write.
- `browser_inline_static_code_store_cuts_link_before_target_reuse` proves a raw store to the
  compiled target page stops before the target and records exactly that physical page; draining the
  record through `invalidate_page` removes the target and clears the source link.
- `browser_inline_static_link_unlinks_and_rearms_after_target_reinstall` proves the cleared link
  misses safely, then a target reinstallation and republish execute correctly after table-index
  reuse.
- `flat_memory_abi_rejects_static_edge_slots` validates that the frozen SoftMMU/flat-memory ABI
  emits no static `call_indirect`; the inline translator test also observes zero dynamic
  virtual-target hash-probe shifts for static edges.

## Exact commands

```text
cargo fmt --all --check
cargo clippy -p wasm-vm-core -p wasm-vm-jit-translate -- -D warnings
cargo clippy --target wasm32-unknown-unknown -p wasm-vm-wasm --lib -- -D warnings
cargo test -p wasm-vm-core
cargo test -p wasm-vm-jit-translate
cargo test -p wasm-vm-jit-translate --test batch
wasm-pack test --node crates/wasm --test jit_browser_parity
bash tools/build-web-dist.sh
git diff --check
```

Results: all listed commands passed. The final browser run reported `31 passed, 0 failed, 1
ignored`; the batch translator run reported `6 passed, 0 failed`. The build regenerated the
committed `web/dist/pkg/wasm_vm_wasm.js`, `web/dist/pkg/wasm_vm_wasm_bg.wasm`, and `web/dist/sw.js`
artifacts. The existing warning in the unrelated `crates/wasm/tests/hart_ctrl.rs` test target is
not from this slice.

The attempted all-workspace all-features clippy gate remains blocked by pre-existing macOS
`wvseccomp` libc API errors; excluding that crate still exposes pre-existing `live_blocks` and
`fetch_phys` dead-code diagnostics. The changed core/translator and wasm-target library strict
clippy gates above pass.
