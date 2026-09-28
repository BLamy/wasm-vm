# R3 checkpoint wait inspection

Frozen inspector: `f3e0bba9a84091e64eca56de5dc3b42dd604e2f8`.
This is an offline read of the existing boot checkpoint, before T03m's failed
physical-input interval. No guest ran and no runtime, image or public site changed.

## Recorded commands

```
node --check tools/verify/omarchy-wait-checkpoint.mjs
python3 -m py_compile tools/verify/capture-omarchy-kernel-layout.py
node --test tools/verify/omarchy-wait-checkpoint.test.mjs
node tools/verify/omarchy-wait-checkpoint.mjs evidence/omarchy-profile/checkpoint-wait-r1
```

All commands passed at the frozen head. Eight focused tests cover container and
sparse corruption, wrong layout/kernel identity, Sv39/Sv48/Sv57 translation,
reserved/invalid PTEs, superpage alignment, noncontiguous reads, broken lists and
invalid frame chains. Exact command receipts and output are in
`../checkpoint-wait-gates/`. On this Mac, commands use
`DEVELOPER_DIR=/Library/Developer/CommandLineTools`; Python's bytecode cache uses
`PYTHONPYCACHEPREFIX=/private/tmp/omarchy-wait-pycache`. An earlier exploratory
Python compile failed only because its default cache directory was outside the
sandbox; the recorded scoped compile above succeeds.

Layout receipt generation, before the frozen inspector run:

```
docker run --rm --read-only --tmpfs /tmp --network none \
  -v wasm-vm-kbuild-6.6.63:/build:ro \
  -v /Users/blamy/Documents/Codex/wasm-vm:/repo:ro \
  --entrypoint python3 wasm-vm-kernel-build:local \
  /repo/tools/verify/capture-omarchy-kernel-layout.py \
  > evidence/omarchy-profile/checkpoint-wait-layout/layout.json
```

The receipt preserves the exact prior kernel compiler arguments and the probe
arguments, actual assembly constants, generated offsets, stacktrace source and
source-header digests. Only the standalone offset probe is compiled; the kernel
build volume and repository mount are read-only. Image, System.map and config
digests match the released files. The inspector also checks ten instruction-byte
anchors in actual snapshot RAM before following task fields.

## Observed bytes

`checkpoint.json:49` records actual saved SATP `0xa00ca000000848b0`: Sv57,
root physical `0x848b0000`. The actual current task is Bash PID174, on_cpu 1.
Reciprocal list traversal finds 82 process groups and 144 unique tasks.

- Hyprland 417/417 at task `0xff60000004793c00` has state `0x2001`, on_cpu 0.
  Its saved switch stack traverses `__schedule`, `schedule`, `futex_wait_queue`,
  `futex_wait`, `do_futex`, `__riscv_sys_futex`, `do_trap_ecall_u`, then
  `ret_from_exception`. Every saved FP/RA includes physical bytes and a page
  table walk (`checkpoint.json:3894` onward).
- Its top-of-stack trap has cause 8 and user SPP, original a0
  `0x55555efbb948`, a1 `0x189`, a2 `0`, a3 `0`, a5 `0xffffffff`, a7 `0x62`.
  Original a0 is physically at `0x8e44dff8` (`checkpoint.json:5353`). The
  futex word maps through Hyprland's own page tables to `0x87e2d948`, and is
  zero (`checkpoint.json:5454`). The saved user continuation is
  `0x7fff81815bd8`; no library or condition-variable owner is inferred.
- Renderer 462/417 is `llvmpipe-0`, state0, on_cpu 0. Its saved stack comes
  from the interrupt return/reschedule path, with saved user EPC
  `0x7fff6c08ac7e` and interrupt cause `0x8000000000000005`
  (`checkpoint.json:5497` onward). Its EPC maps to executable user bytes at
  physical `0x9cab1c7e` (`checkpoint.json:6882`). It is runnable at this
  checkpoint; Bash is current. This is not proof of renderer execution at
  that instant or identification of a specific shader.

## Identity

- Compressed R3 snapshot:
  `2231a21eb8ebc8d3965d1352a3523501faebc87bda31e2c8dc184320219235f5`.
- Decoded RAM, 1073741824 bytes:
  `7b4695440b7bb6bfaa07b19e90afb758692627bd571fa2d6dd40d2e68e37616b`.
- Kernel layout receipt:
  `0ee696d2e47cf290bf57d1648a7cbe99144f2dff95e4aa3b2a7844e0bd405d82`.
- `checkpoint.json`:
  `1278b8bdd81471590bbb37cccdf6c392c09132fd0bfc24f274b26981cfb1b49a`.

## Conclusion and remaining probe

The earlier boot checkpoint contains a concrete compositor futex wait and an
independently identified runnable renderer's saved interrupt context. The new
artifact makes those states inspectable without guest execution or `/proc`
observer traffic. It does not show that this same wait persisted throughout
T03m, identify the userspace caller/wake dependency, or demonstrate a remedy.

The next causal probe must observe the same PID/starttime and stack/wait address
during the later failed input interval, then bind the userspace caller and
renderer work. Preserve the unchanged 120-second physical nonce test and all
prior HELD negative results. T03d responsiveness remains unresolved.
