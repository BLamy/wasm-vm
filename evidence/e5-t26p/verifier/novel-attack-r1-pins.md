# E5-T26p verifier novel attack r1 — frozen pre-execution pins

Prediction frozen before fixture inspection: `lw x0, 0(x1)` against an ordered MMIO device
performs exactly one width-4 read and retires with x0 unchanged. Public traced APIs with a custom
sink whose `wants_records()` is false still emit exactly one successful record with `rd: None` and
the load `MemOp`. When the same device read returns `BusFault::Access`, direct and run-loop APIs
preserve x0/PC, report `LoadAccessFault` with the exact MMIO address, retire zero instructions,
perform exactly one read attempt, and emit no callback. This must hold for direct Hart execution
and ordinary/cached Machine unit and traced execution, natively and in actual WASM.

Canonical native baseline admission preceding this attack:

- `semantics-r1/result.json`: `e85693bb07f4726252b9930d31a3c7f21c213ae27d70af1c31dc572f57d29385`
- independently executed old/candidate stdout and copied golden:
  `5587b4d8fc786ea48a87a2c004466fe7fb2b9a7630c408548fcb264414446cc2`
- 266 `CASE` rows on each side; `identical: true`

Frozen source/config SHA-256 values:

```text
fc7cbaedc583510a98e1ce66875c32af7fe9aa43bc80cb16b298168dd0c61479  Cargo.toml
593066d089878547aace500f8eb93f7989c93eba3b050b634b4f8ad1e55bc4a7  Cargo.lock
693000886a9f8195d7dbfbba41d9ffa19147b18233b83f52c4626d92a54c2b7b  .cargo/config.toml
0a7758acebb8cbcc2ba66675476f1c4dff67d31c5d662fccca504f19d2e6aef9  rust-toolchain.toml
828e4d59f7f29f2cbfa98b3cdea67e530cc4b3f51132e4e0d9fc22de280c4c6c  crates/core/Cargo.toml
ee9a0e90a0d447f06571fe203772a51bd4b491d3d42dfabb81befee2516b3d69  crates/wasm/Cargo.toml
ab15c6a854441fc99f28a3c2e34d60fea3c5d2450d2db3577f1b185a7be7cd39  crates/core/src/hart/mod.rs
9e2d235163d528112ab0375886e2bdf4e602c0dbdceaf7e486abad0b6d78b053  crates/core/src/lib.rs
676941521e8882e17b242384ce7d2a737918750b46ec6b302f120d5cfaa92034  crates/wasm/src/lib.rs
46badec8faabdc9bacb30a2f35545015e7b50c52611de54e7af53d2a6f1af748  crates/core/tests/retirement_capture_verifier.rs
a1e214654f8714feee758dec09b30d83067cfa9666f2829c95441127ee6c7892  crates/core/tests/support/retirement_capture_verifier_support.rs
d7645b3c4805532dd63319a5904a682b85b4b0457fb9de2aee0d5e965996b57a  crates/wasm/tests/retirement_capture_verifier.rs
```

Toolchain: rustc 1.96.0 commit `ac68faa20c58cbccd01ee7208bf3b6e93a7d7f96`, LLVM 22.1.2;
Cargo 1.96.0; wasm-pack 0.15.0.

Exact commands authorized for r1:

```sh
cargo test -p wasm-vm-core --features trace --test retirement_capture_verifier -- --nocapture
wasm-pack test --node crates/wasm --test retirement_capture_verifier -- --nocapture
```

No broad gate, clone, browser, sabotage, producer rerun, task edit, gate edit, or runtime edit is
authorized by this record.
