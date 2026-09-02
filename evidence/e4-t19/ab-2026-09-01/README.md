# E4-T19 native gcc batching A/B

Implementation head under test: `ba01dfd4c02aa173388747e89ba38f356236e8f2`.

The pinned overlay was rebuilt with `bash bench/mk-gcc-image.sh` twice after the image recipe
normalized ext4 inode ctime. Both rebuilds produced the same `gcc.ext4` SHA-256:
`f53445f65b5e32b9fe3c47e0f84c52c850da2c747edae0abca60e9592a758c4a`.

## Commands

```sh
WASM_VM_GCC_MAX_INSTRS=1000000000000 WASM_VM_BOOT_EXTRA="--jit-batch-size 1" \
  python3 tools/bench.py run gcc --engine native --jit --runs 1 \
  --json evidence/e4-t19/ab-2026-09-01/gcc-k1-ba01dfd.json

WASM_VM_BOOT_EXTRA="--jit-batch-size 64" \
  python3 tools/bench.py run gcc --engine native --jit --runs 1 \
  --json evidence/e4-t19/ab-2026-09-01/gcc-k64-ba01dfd.json
```

## Results

- K=1: failed before `GCC_RESULT`; the emulator returned `-5` (SIGTRAP) after gcc reached the
  pinned `-O2` compile and emitted the `miniz.c:3185` pragma note. See
  `gcc-k1-ba01dfd-failure.md`.
- K=64: passed with 164.0 guest seconds, 1106.951 host seconds, a 302,904-byte object, and
  object SHA-256 `97198b27557042fb84de54881c5fb577505b4ee77c41bc056612be6173e5faca`. The JSON
  SHA-256 is `0b3233d6b91633b4cef0789cc759ea3757fd03c3fb67564d6565119239f92e43`.

The pair is evidence that the batched arm completes and the K=1 control is not a valid completed
baseline. It does not establish a batching speedup factor; the K=1 runtime failure must be fixed
and re-recorded before AC2 can pass.
