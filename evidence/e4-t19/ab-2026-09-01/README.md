# E4-T19 native gcc batching A/B

Implementation head under test for the completed control pair: `d2497e36ccdea05db79b2d4665864a987e0c3079`.

The pinned overlay was rebuilt with `bash bench/mk-gcc-image.sh` twice after the image recipe
normalized ext4 inode ctime. Both rebuilds produced the same `gcc.ext4` SHA-256:
`f53445f65b5e32b9fe3c47e0f84c52c850da2c747edae0abca60e9592a758c4a`.

The earlier exact-head pair at `ba01dfd` is retained below as the failure record that motivated
the runtime fix. The fixed pair adds `--profile`, which enables the existing JIT pause timer; the
harness records the raw `JIT_STATS_JSON` line and projects `jit_compile_stall_s` into each result.

## Commands

```sh
WASM_VM_BOOT_EXTRA="--jit-batch-size 64 --profile" \
  python3 tools/bench.py run gcc --engine native --jit --runs 1 \
  --json evidence/e4-t19/ab-2026-09-01/gcc-k64-d2497e3.json

WASM_VM_BOOT_EXTRA="--jit-batch-size 1 --profile" \
  python3 tools/bench.py run gcc --engine native --jit --runs 1 \
  --json evidence/e4-t19/ab-2026-09-01/gcc-k1-d2497e3.json
```

## Results

- K=64: 163.96 guest seconds, 1,633.807 host seconds, and 607.910136 seconds of measured
  JIT-attributable compile/install stall (`jit_pause_sum_ns=607910136400`). The run recorded
  2,643 compiled blocks and 1,778,465 evictions.
- K=1: 164.00 guest seconds, 1,853.322 host seconds, and 942.132398 seconds of measured
  JIT-attributable compile/install stall (`jit_pause_sum_ns=942132397625`). The run recorded
  219 compiled blocks and 3,132,025 evictions.
- Both arms reached `GCC_RESULT`, emitted the same 302,904-byte object, and produced the same
  object SHA-256 `97198b27557042fb84de54881c5fb577505b4ee77c41bc056612be6173e5faca`.
- The measured stall ratio is `942.132398 / 607.910136 = 1.549789x`; K=64 reduces the
  compile/install stall by `35.475%` (334.222262 seconds). The exact JSON SHA-256 values are
  `5ab71aa13484eed271e0a69b891da8734871b46da833453a11430ca49aaa2e66` (K=1) and
  `f6b962118d68d8df480aea08ea7aca317829a92b011601ec6147fae33cadf2b7` (K=64).

These results close the native AC2 denominator/runtime gap and establish a measured A/B factor.
They do not by themselves close the independent-machine robustness attack, the browser practical
cliff beyond the tested 10,000-instance lower bound, or the first-execution warm-up check.
