# Canonical instruction-trace format (v1)

The frozen, versioned serialization of a retired instruction (E0-T16). It is designed to
diff **byte-for-byte** against a normalized Spike `--log-commits` log (E0-T20) and to be
identical from native and wasm builds. **Changing this grammar invalidates every golden
file** (`docs/golden/*.trace.txt`) — bump the version and regenerate deliberately.

## Grammar

One retired instruction per line, `\n`-terminated (the caller adds the newline;
`fmt_canonical` writes the line body):

```
core 0: 0x{pc:016x} (0x{insn:08x})[ x{rd} 0x{val:016x}][ mem 0x{addr:016x}[ 0x{sval}]]
```

- **`core 0:`** — hart id (single hart at Level 0).
- **`0x{pc:016x}`** — the retired instruction's own address, 16 lowercase hex digits.
- **`(0x{insn:08x})`** — the raw 32-bit instruction word, 8 hex digits.
- **register field** ` x{rd} 0x{val:016x}` — present **iff** the instruction wrote a
  register other than `x0`. `rd` is decimal (0–31, but 0 never appears — see rules);
  `val` is the 64-bit written value, 16 hex digits.
- **memory field** ` mem 0x{addr:016x}` — present iff the instruction accessed memory.
  For **loads**, the address only. For **stores**, followed by ` 0x{sval}` where `sval`
  is the written bytes masked to the access width, printed with exactly `2 * len` hex
  digits (`sb`→2, `sh`→4, `sw`→8, `sd`→16).

Field order is fixed: `pc (insn)` then optional register then optional memory. A load
therefore emits `... x{rd} ... mem 0x{addr}` (register before memory).

## Rules

1. **Faulting instructions emit nothing.** A trap does not retire, so no line is produced
   (the trap-purity contract). Only `Ok` retirements are recorded.
2. **`x0` writes omit the register field.** Instructions whose architectural `rd` is `x0`
   (and instructions with no `rd` at all — stores, branches, FENCE) write no register, so
   the ` x{rd} ...` field is absent. `x0` therefore never appears in a trace.
3. **Store value is width-masked.** A `sb` of `0xABCD` logs `0xcd` (2 hex digits); a `sh`
   logs 4; `sw` 8; `sd` 16. Only the bytes actually written appear.
4. **Loads log no value**, only the effective address — matching Spike's commit log,
   which likewise omits load data in the base format.
5. **Lowercase hex, zero-padded, no separators.** `cmp`, not `diff`: any whitespace or
   width drift is a format regression.

## Examples

```
core 0: 0x0000000080000050 (0x00550533) x10 0x0000000000000001          # add a0,a0,t0
core 0: 0x0000000080000058 (0xfe62cce3)                                 # blt (branch, no rd)
core 0: 0x0000000080001000 (0x00e68023) mem 0x0000000010000000 0x48     # sb of 'H' → 0x48
core 0: 0x0000000080001004 (0x0007c703) x14 0x0000000000000048 mem 0x0000000010000000  # lbu
```

## Regenerating goldens

The committed `docs/golden/loops.trace.txt` is the first 40 retired instructions of
`guest/prebuilt/loops.elf`. After a deliberate format change:

```sh
cargo test -p wasm-vm-core --features trace --test trace_golden regen -- --ignored
```

then re-review the diff before committing.
