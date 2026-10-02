# Browser JIT register handoff — October 2026

No production optimization was retained. Six candidates were investigated against
current main `0a5f7bd7` (stack parent `ec178d57` has identical runtime code).
The final rebuilt production wasm is byte-for-byte identical to that baseline:
`f8b40d93039a9bb454250df40592e8c1d62144cac600bdcd82ea74098d7bb516`.

The proposed boundary was `XRegs::jit_commit_words_mask`, which visits 31 writable
integer registers at a browser direct-chain exit. Variants tried empty-mask
elision, sparse set-bit iteration, full-mask bulk copying, a density threshold,
the original fixed-slice scan, and forced inlining. Public ABI, guest clock and
chain policy were unchanged. Native execution uses the full-register commit path;
large native microbenchmark gains here are **not native emulator speedups**.

The retain gate required a repeated sparse paired median above 1.02x, every tested
density at least 0.98x, and real boot/shell paired timings at least 0.95x. The last
two limits formalize the original no-material-regression requirement; the sparse
gate was never lowered. A passing screen alone did not qualify.

| Candidate/run | Sparse paired ratio | Worst density paired ratio |
|---|---:|---:|
| Sparse bit iteration | 1.01045x | 0.93911x |
| Sparse + full bulk copy (expanded run) | 1.00884x | 0.93143x |
| Threshold + iterator scan | 1.01129x | 0.85795x |
| Threshold + fixed-slice scan | 1.01577x | 0.98571x |
| Empty/full fast paths + fixed-slice scan | 1.00427x | 0.97617x |
| Threshold + forced inlining (screen) | 1.02005x | 0.98824x |
| Threshold + forced inlining (repeat) | 1.01383x | 1.00583x |

Ratios are baseline time / candidate time; larger is faster. Each row retains
seven alternating A/B pairs and warmups, with CPU, RAM, CLINT and clock checks
outside timing. Early screens used 40 million retired instructions per sample;
the fixed-slice and subsequent runs used 400 million to reduce timer noise.
Eight browser densities cover zero, one, three, eight, nine, fifteen, thirty and
thirty-one writable registers. Earlier screens had four or six densities, which
is why a promising first result was not accepted. All runs used host clocks and
Chrome 154.0.8037.93 on this Apple M4 Max.

The last candidate passed once at 1.02005x and then failed its exact-source,
exact-wasm repeat at 1.01383x. Some dense loops improved, but that does not meet
the task's repeated sparse-speed criterion. The earlier bulk-copy candidate's
five-pair BusyBox experiment showed approximately neutral boot time and a 1.03x
paired shell-loop ratio; its near-dense regression still disqualified it. Those
numbers do not describe the restored final production implementation.

## Retained proof and tools

- `make verify-E5.5-T03be` checks native/wasm register oracles, stamp wrap, bounded
  compiled resumes, precise-fault parity and FP regression coverage.
- The independent register-array oracle checks 10,598 masks, including every
  single/two-bit combination, every density, x0-only, high-bit and seeded masks.
  Its final SHA-256 is
  `4dace58378d14297762d010665b9d3bf1ac0fd376e5565ccbe4f122f34e6d1f2`.
- The compiled-resume fixture records interpreter instruction hashes and compares
  full snapshots and an independent register/PC oracle at ten budgets. Its timer
  is deliberately absent to isolate handoff: the existing CSR time-shadow sample
  boundaries differ. The production Chrome benchmark separately compares CPU,
  CLINT and clock sections with a timer enabled.
- `tools/verify/jit-sparse-handoff-benchmark.mjs NEW_OUTPUT_DIR BASELINE_DIR`
  checks baseline artifact hashes, alternates arms, requires real JIT retirement,
  saves every measurement/state check, and rejects identical browser binaries as
  evidence of an optimization. The baseline directory contains `baseline.json`,
  the preserved core rlib and `pkg/`; it came from the preceding clock investigation.
  This benchmark's timing decision is recorded separately from deterministic
  state correctness. Native word previews are now hexadecimal strings so JSON
  parsing preserves all 64 bits. Historical reports used numeric previews; the
  Rust producer asserted exact values before printing, and fixture digests retain
  full precision. The earlier BusyBox experiment also recorded one generic 404
  in each arm's first sample; it is not a zero-console-error demo proof.

The fresh critic also promoted 5,952 independent rotated-mask/complement cases,
including repeated same-value commits, and confirmed the new high-register
regression detects an intentionally dropped bit 31.

The [selection manifest](../../evidence/omarchy-profile/sparse-handoff-final/selection.json)
links exact raw reports and digests. Historical candidate source/harness copies
are evidence only; they are not compiled into the emulator. The worker and fresh
critic record final-head gates, environment limitations, novel attacks and
publication in the [task](../../tasks/epic-5.5-omarchy/E5.5-T03be-jit-sparse-handoff.md).
The fresh critic additionally ran the mask/resume and precise-fault fixtures
in actual Chrome: 41 passed, one pre-existing ignored, zero page errors. The
wasm/Node fixtures, Chrome fixtures and production Chrome workload tests are
recorded separately; no Node-only result is described as an in-browser run.
