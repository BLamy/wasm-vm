# E5.5-T03bg independent static review

Runtime diff inspected after predictions, before the frozen run handoff.

- `set_memory_helper_imports`: the owner is `wasm_bindgen::exports()`; scalar functions are copied by reference into `env`. Both inline aliases select the same function object. Dynamic proof must check both import modes and reject wrappers/signature mutations.
- `require_active_host`: borrows HOST only long enough to copy a boolean requiring both hart and bus. The borrow ends before the JS null sentinel is thrown. Every raw entrypoint invokes this guard before helpers, timing, inline-cache or chain-pointer access.
- `jit_load` / `jit_store`: delegate unchanged to `with_ctx_load` / `with_ctx_store`; no address or value truncation is introduced.
- `jit_amo` / `jit_lr` / `jit_sc`: preserve previous closure bodies, including `mark_chain_abort()` only after a successful helper return; thrown faults unwind at the same helper call.
- The existing synchronous invoke path clears every HOST pointer after both successful and caught-exception returns. No changes to native runtime semantics are present in the inspected diff.
- Deleted closure fields, initializers and `set_fn` are ownership plumbing removed by direct imports. Documentation changes and deleted plumbing need no separate runtime execution; the identity/type/lifetime assertions prove their replacement.

Baseline integrity independently checked:

```
git show 96f30bdee9d0a98672336b223004054677baee36:crates/wasm/src/jit_browser.rs | shasum -a 256
6d6e8e69293b1077c6f4d833d97a4d05ea8e7fa2a7ddb8aaa0710d5069f44e42

git show 96f30bdee9d0a98672336b223004054677baee36:web/dist/pkg/wasm_vm_wasm_bg.wasm | shasum -a 256
70de75fd1a2cfb6b51893773a394c0276189a1e54fe9a57dca1fbc47dea1f873
```

The preserved baseline `/tmp/wasm-vm-direct-memory-baseline/pkg/wasm_vm_wasm_bg.wasm` and its `web/pkg/` copy both match this committed parent artifact. This binds the performance baseline to the parent runtime, independent of the worker's manifest assertion.

The benchmark harness at initial review uses fixed instruction budgets, two fixed warmups and seven alternating parent/candidate pairs per workload, checks the same interpreter/JIT state at a bounded oracle budget, and checks exact retired work in timed samples. It records speedups but does not itself fail on performance budgets; final acceptance therefore requires independent recomputation and an explicit keep/reject decision from the measured data.

No dynamic predictions are marked HELD by this static review.
