# Bounded FP diagnostic, not desktop acceptance

This opt-in CLI diagnostic counts actual retired instruction encodings and
records a guest trace digest. It does not change core or WASM execution, and
does not establish the cause of the slow desktop.

`actual-spawn-provenance.json` records the exact optimized binary, argv,
environment, timestamps and expected exit 102 (`MaxInstrs`). `preparation.json`
binds the source kernel/image/RAM/delta and the private writable diagnostic
copy. Only that private snapshot's core/base coherence fields were zeroed for
the native diagnostic. The shipped artifacts were not modified; this run must
not be used as production resume/coherence acceptance.

The 10M-instruction bound produced 9,999,379 retirement records, including
849,572 FP-compute instructions. FNV64: `71287438799aa6f1`; final state SHA-256:
`802e862f976eb63e77bd6019b735673c08ccde3341a07f0de1c58494a21601f7`.
The requested browser hot region `0x7fffa4229b40` did not execute in this
bounded sample; different FP-heavy regions did. No JIT-policy or performance
conclusion follows from those counts alone.

Both the instruction-pair and 64-byte-region maps are limited to 65,536
entries, with explicit dropped-record counts. The sample's region map had
6,055 entries, so adding that cap does not alter the existing recording;
`boundedness-audit.json` binds this incremental source change honestly.

Final targeted checks passed:

```sh
cargo test -p wasm-vm-cli --bin wasm-vm --features gpu-trace fp_share_sink_tests
cargo clippy -p wasm-vm-cli --bin wasm-vm --features gpu-trace --no-deps -- -D warnings
```

Three tests passed, zero failed. Daybreak independently held bounded count
accuracy and evidence labeling; desktop interaction remains unverified.
