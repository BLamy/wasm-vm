# E5.5-T03ab — existing residency comparison after FP support

The one control/candidate pair at frozen harness head
`f730bc553ee63eec303aa36ab8291e3af2afac24` fails physical input in both arms.
The existing option changes only the module cap from24 to256. Both keep
recycling off, unchanged verified runtime/WASM/R3 inputs, desktop1280×800,
LP1, divider64, threshold512, cold capacity65536 and decoded capacity4096.
No runtime, production default or web artifact changes; no deployment.

## Source and commands

- `python3 .../residency-after-fp-gates/freeze.py` verifies the unchanged
  crates/web source against verified T03z `53103e762c6c4003a5976bfa90131a03702fd2e7`,
  all69 sealed T03z evidence files, and the committed experiment harness.
  WASM SHA remains `1bc7285239db053abdaaafe4c5869a5a2495c7c149d01a239ec020e1fedbf88d`.
- `python3 .../residency-after-fp-gates/record.py` records62 passing affected
  recorder/adapter tests and three successful Node syntax checks. Exact
  commands/times are in `commands.json`; unchanged cold/deployment/runtime
  evidence and the five inherited broad CI failures carry forward by digest.
- `node tools/verify/omarchy-residency-ab.mjs evidence/omarchy-profile/residency-after-fp-r1`
  runs exactly one fresh control then fresh candidate, with no competing build.
  Parent exit0 means pair completion; both children exit1. Normal close/no
  watchdog/no overlap are recorded in `ab.json`.
- `node .../residency-after-fp-gates/audit.mjs .../residency-after-fp-r1`
  independently checks the recorded policy/source/bounds and physical command,
  key acknowledgements, fenced read-only serial replies and actual outcome.
  `cache-observations.py` derives counters without a code-identity claim.

The fixed300/60/120/20/30-second phase bounds and T03m layers/pixels readiness
are retained. No recorder-only window query is added. The actual runtime
reports selected caps24/256; unchanged source proves all other cache budgets
remain code32MiB, table32768 slots and metadata8MiB. These latter values are
source-bound constants, not additional runtime measurements.

## Actual results

| Observation | cap24 control | cap256 candidate |
| --- | ---: | ---: |
| Startup qualification | 127,803ms | 66,718ms |
| Trusted physical transitions | 128 | 128 |
| Completed independent reads, all exit75 | 12 | 17 |
| Pending reads | 1 | 1 |
| Nonce replies | 0 | 0 |
| Frames | 2→2 | 2→2 |
| Input-interval retired instructions | 1,186,452,616 | 1,643,434,261 |
| Input-interval compiled retirements | 389,397,819 | 1,090,246,822 |
| Input-interval compiled share | 32.820343% | 66.339546% |
| Block installs, delta | 13,178 | 13,746 |
| Previously evicted-PC retranslation accounting, delta | 12,769 | 12,632 |
| Batch evictions, delta | 2,415 | 3,120 |

Control Enter/deadline:01:51:12.013/01:53:12.013Z; candidate:
01:54:27.208/01:56:27.208Z on2026-09-16. Failures arrive3ms/2ms after
the exact deadline. No nonce was injected through serial. Both browser error
arrays are empty. Root personally viewed all four actual baseline/failure
images: the original empty Foot prompt, no typed response. All have SHA
`97fc180d4d35c68ca5941dc591afb315220550165469f3c4ead7827989cc2f3f`.

Control report SHA:`65fb5dc0ac51e50702ea0583ea8bdb15f8bab98455c9068b1165581a2c86bdd5`.
Candidate report SHA:`33eaa82a64ade55c36efb27aca5ac021a3d028ab77dbdd696b83a4be6d8dc037`.

These are one pair's observations, not a comparative speedup estimate.
Retranslation accounting tracks recurring evicted physical PCs; it does not
prove equal instruction bytes or useful hot code discarded. Evictions count
batches, not blocks. The earlier September10 cap256 negative is retained.
Larger residency is not established as a responsiveness remedy; T03q remains
gated. Further work must measure the remaining execution cost, not promote
these counters as a successful desktop.
