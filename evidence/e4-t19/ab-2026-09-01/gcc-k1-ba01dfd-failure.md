# E4-T19 K=1 failure evidence

- Commit under test: `ba01dfd4c02aa173388747e89ba38f356236e8f2`
- Command: `WASM_VM_GCC_MAX_INSTRS=1000000000000 WASM_VM_BOOT_EXTRA="--jit-batch-size 1" python3 tools/bench.py run gcc --engine native --jit --runs 1 --json evidence/e4-t19/ab-2026-09-01/gcc-k1-ba01dfd.json`
- Outcome: exit 2; the emulator terminated with `emulator_rc=-5` (SIGTRAP) before emitting `GCC_RESULT`.
- Reproducible console tail: gcc reached the `GCC_CMDLINE` for the pinned `-O2` miniz compile and emitted the source pragma note at `miniz.c:3185`; the compile sentinel was never reached.
- The harness diagnostic is from `tools/bench.py`: `Console.expect` now reports the child status and tail when the guest exits before the sentinel.

This is a failed K=1 stress/control run, not a timing datapoint. The paired K=64 run must still
complete successfully before the batching claim can be assessed.
