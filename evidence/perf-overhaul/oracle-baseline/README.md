# Perf-overhaul equivalence baseline

Digests produced by `tools/perf/oracle.sh` from the pre-overhaul head `82978509` (plus only the
`--fixed-rtc-ns` CLI flag, which pins the one host-time input so boots are reproducible).

Every interpreter/JIT refactor in the overhaul must reproduce these files byte-for-byte:

| case | mode | expected state digest |
|---|---|---|
| busybox-legacy | per-instruction interpreter | `8f158c56…` |
| busybox-cache | `--block-cache` (identical to legacy by design) | `8f158c56…` |
| busybox-fast | `--block-cache --interrupt-batching` | `e1abd6fa…` |
| busybox-jit | `--jit` (native wasmtime executor) — timing-transparent vs fast | `e1abd6fa…` |
| alpine-fast | Alpine ext4 disk boot, 2B instructions | `b2b319f3…` |
| alpine-jit | same under `--jit` | `b2b319f3…` |

The JIT's state digest equals the batched interpreter's, so the batched interpreter digest is the
oracle for JIT coverage/engine changes too. (`--jit` records only a retired counter, not the full
per-instruction FNV — compare `state sha256` + `retired` for those cases.)
