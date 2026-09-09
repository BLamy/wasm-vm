# E5-T26o worker evidence — actual wasm32

Command:

```text
wasm-pack test --node crates/wasm --test plic_sparse -- --nocapture
```

Result: `3 passed, 0 failed` in 0.08s.

The shared native/wasm fixture ran the same 152 selector context-cases, restore and
gateway checks, and exact 21-record guest trace/digest assertions. The command also
reported an unrelated pre-existing `hart_ctrl.rs` unused-import warning and the
platform's wasm-bindgen prebuilt-binary fallback; neither affected this fixture.

