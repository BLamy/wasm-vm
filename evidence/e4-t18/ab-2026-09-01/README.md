# E4-T18 AC1 — CoreMark chaining ON vs OFF A/B, 2026-09-01 (verification-debt payoff)

Worker checkpoint measurement of block chaining (AC1: CoreMark with chaining on ≥ 1.4x
chaining off), rerun locally on the native wasmtime JIT backend per the 2026-09-01 policy
update (rr waived, `dev` retired, everything on this Mac). The browser executor form
(E4-T19 funcref-table epilogues) remains unmeasured — this is the native realization of the
identical link-slot/unlink protocol (see the task's 2026-08-06 design note).

- Machine: Apple M4 Max, 16 cores, 128 GB RAM, macOS 26.6.2 (25G83), rustc 1.96.0.
- Commit + patch (IMPORTANT): `Machine::set_chaining` (the A/B flag the 2026-08-06 entry
  wired) has NO CLI passthrough at HEAD — `wasm-vm boot` cannot turn chaining off. To run
  the prescribed A/B without a proxy harness, a minimal additive `--no-chain` boot flag
  (default off; `--jit --no-chain` calls `m.set_chaining(false)` after `set_jit(true)`) was
  applied as an UNCOMMITTED patch; the exact diff is in `no-chain-flag.diff` and the release
  binary was rebuilt with it before these runs. Chaining-ON runs use the same patched binary
  with the flag absent (defaults unchanged: chaining ON under --jit).
- Harness: `tools/bench.py run coremark --engine native --runs 1 --jit --json <sample>.json`,
  5x per arm, strictly alternating chain-OFF (`WASM_VM_BOOT_EXTRA="--no-chain"`) /
  chain-ON (no extra flags), sequential, idle machine, cold mode (fresh empty translation
  cache each run, compile stalls paid inline in BOTH arms).
- Workload/rootfs: identical to evidence/e4-t05/ab-2026-09-01 (pinned CoreMark ELF
  sha 4db593b8…, reassembled production rootfs sha dfdb7b7c…, same image both arms).
- The guest score is instruction-count-derived and identical across configs; the chaining
  uplift is the HOST wall-clock ratio of the benchmark region
  (`timing_check.host_elapsed_s`), median-of-5 per arm.

Files: `coremark-jit-chainoff-s[1-5].json`, `coremark-jit-chainon-s[1-5].json`,
`no-chain-flag.diff`, `summary.json`.
