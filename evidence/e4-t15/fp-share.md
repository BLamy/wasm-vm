# E4-T15 — measured F/D dynamic share

All numbers reproducible from this repo; the classifier is independent of `wasm_vm_core::decode`
(raw RISC-V opcode map), so it doubles as the adversarial "recompute the share independently" check.

## Dynamic — busybox Linux boot to userland (native, release)

Command:

```
WASM_VM_FP_HISTOGRAM=1 target/release/wasm-vm boot \
  --kernel releases/kernel/6.6.63/Image \
  --initrd releases/initramfs/initramfs.cpio.gz \
  --append "console=ttyS0 earlycon=sbi" --no-input --profile-boot --max-instrs 8000000000
```

Result (`FP_SHARE_JSON`, boot-scoped — the `--profile-boot` profiler stops at the busybox-userland marker):

| metric | value |
|---|---:|
| total retired instructions | 322,388,374 |
| F/D instructions | 1,284 |
| — of which FP load/store (fld/fsd/flw/fsw + C forms) | 1,284 |
| — of which FP compute (arith/fma/cvt/cmp/sgnj/minmax/mv/class) | **0** |
| **dynamic F/D share** | **0.000398 %** (≈ 1 in 251,000) |

The entire FP footprint of a Linux boot is 1,284 loads/stores (kernel FP-context save/restore and
the odd `memcpy` that spills through an FP register) and **zero** floating-point *arithmetic*. The
hard-to-translate ops (the ones with NaN-boxing / fflags / rounding-mode divergence risk — arith,
fma, convert, compare, min/max, sqrt) execute **0 times** in a boot.

## Static — CoreMark / Dhrystone (the two committed integer benchmarks)

`.text` opcode scan (`/tmp/fpscan.py`, same opcode classifier):

| workload | `.text` insns | FP insns | static FP share |
|---|---:|---:|---:|
| `bench/guest/coremark.rv64` | 94,868 | 233 | 0.246 % |
| `bench/guest/dhrystone.rv64` | 93,245 | 226 | 0.242 % |

CoreMark and Dhrystone are integer benchmarks *by design* — their scored hot loops contain no FP;
the ~0.24 % of FP in `.text` is confined to the libc `printf`/float-formatting used once at
score-report time, not in the measured loop. Dynamic hot-loop FP share ≈ 0.

Classifier sanity (validates the scanner): `rv64ud-p-fadd` scans 18.87 % FP, `rv64ui-p-add` 0.00 %.

## Amdahl bound on any FP-translation speedup

Boot: max speedup from making *every* FP op infinitely fast = 1 / (1 − 0.00000398) ≈ **1.000004×**
(< 0.0004 %). CoreMark/Dhrystone hot loops: 0 % FP ⇒ **0 %** benefit. Translating F/D cannot move
any target-workload benchmark measurably.

## Decision

**(a) side-exit-all.** Every F/D op keeps its block out of the JIT (`translate_block` →
`Unsupported` ⇒ the interpreter runs the whole block on the proven `rustc_apfloat` softfloat with
exact NaN-boxing / fflags / rounding). Provably identical (FP only ever runs in the audited
interpreter), zero added correctness risk, and the measurement shows the upside of translating is
below 0.001 % — far under the cost of replicating RISC-V softfloat corner cases (canonical NaN,
FLEN-64 NaN-boxing of f32, the 5 accrued fflags, dynamic `frm`, fma rounding) in wasm f32/f64 whose
NaN payloads are engine-nondeterministic.
</content>
</invoke>
