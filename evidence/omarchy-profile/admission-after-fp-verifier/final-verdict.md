VERDICT: verified

Scope: the completed bounded experiment and its honestly negative outcome.
Desktop responsiveness fails in both arms; T03q remains gated. Reviewed worker
submission `a933ed5f2509d03a92e9b7691e083b32531959c4`, recording head
`81f01ba31171b8d670f3842948e556b62bcb0d75`, task/queue-only source submission
`b5a455a276f042cbb1506873aa3874d465384003`, and the complete task and source diff.
Predictions A1–A8 were written before either browser arm. No product code or
recorder was edited by this verifier; no extra browser/guest run was launched.

- **A1 — HELD, source/artifact identity.** Runtime and recorder are unchanged
  from verified T03z `53103e76`. Exact WASM SHA-256 is
  `1bc7285239db053abdaaafe4c5869a5a2495c7c149d01a239ec020e1fedbf88d`.
  Independently rehashed all 29 sealed worker files, with complete index SHA
  `259068acb1383a640be7a3b725813dab649350cf95803d68c4c3b3a281b45a06`.
  Both arms' 95 served response receipts, 13 helper pins, loader base binding,
  browser requests and pinned kernel/R3 snapshot/delta/chunk manifest match
  actual bytes. See `seal-inspection.json`, `pair-inspection.json` and
  `carry-forward.json`; no stale evidence or changed runtime hunk remains.
- **A2 — HELD, sole policy selection.** Actual recycling is false/true at
  both runtime samples. Threshold 512, capacity 65,536, decoded cache 4096,
  repack-off cap 24, icount divider 64 and 1280×800 agree. Admission observation
  and timing remain off with zero timer reads; profiling is not selected.
  LP1 is carried from the pinned R3 pair, not freshly GL-attested.
  Raw control `report.json:165,1283`; candidate `:165,1288`.
- **A3/A4 — HELD, bounded independent arms and real readiness.** The driver
  records exactly control then candidate, normal owned-process closure before
  the next launch, no watchdog, retry or overlap. Both use fresh launchServer
  processes/contexts and qualify inside the same 300,000 ms budget, in
  128,411/128,564 ms. Real layers/pixels readiness, restored snapshot, baseline
  image and canvas focus precede keys. Source retains T03m's omitted recorder
  clients/activewindow queries. Capture and normal cleanup remain within the
  20,000/30,000 ms bounds. `ab.json`; control `report.json:25802,25896,25946`;
  candidate `:26169,26263,26313`.
- **A5/A6 — HELD; actual nonce acceptance FAILED.** Each raw event sequence
  exactly matches the independently reconstructed command, Shift transitions,
  and Enter: 128 trusted/nonrepeat focused events, 128 keyboard calls and 128
  ordered sync calls with same-worker matching acknowledgements. The only
  serial commands are the app's layers query and independently named-file
  read-only lookups; none supplies the nonce. Raw guest response fences show
  control 12 completed exit-75/empty replies plus one pending, and candidate
  13 plus one pending. No successful nonce reply exists. Enter fixes the
  original deadlines at `2026-09-16T01:25:27.477Z` and
  `2026-09-16T01:29:46.053Z`; no later acceptance is credited. Raw control
  `report.json:25874`; candidate `:26241`. Exact RPCs, response timestamps and
  payloads are preserved in `pair-inspection.json`.
- **A7 — HELD, honest visible negative.** I personally inspected all four
  baseline/failure PNGs. Every image shows the same original Foot prompt and
  cursor, with no typed command or application response. All four hash to
  `97fc180d4d35c68ca5941dc591afb315220550165469f3c4ead7827989cc2f3f`.
  Both arms' frames and successful presents remain 2→2. Input pending/drop/
  rejection counters remain zero but do not prove guest consumption. Raw
  control runtime points `report.json:76,1194`; candidate `:76,1199`.
- **A8 — HELD, carried proof and novel attack.** T03k's unchanged dispatch
  and policy proof, T03m's user path, and all 69 sealed T03z files independently
  rehash. Narrow gates record 7 policy tests, 1 wrapper test, 54 recorder/
  adapter tests and runner syntax, all passing with no skips/ignores. The one
  bounded novel attack forges an on-time successful receipt in memory while
  preserving the actual missing nonce replies. The worker's actual exported
  `auditReport` rejects it with `no timely nonce on the raw wire`. The original
  report remains byte-identical. See `worker-audit-attack.json` and its
  executable `attack-offline-audit.mjs`.

## Attribution and coverage

Candidate epochs advance 1→2 and full-map refusals remain 0→0, yet desktop
acceptance fails. Its input-window JIT share is 32.169244% versus control
33.469566%; this fixed-order pair does not establish a speedup or the stall's
cause. Translation recurrence is keyed by physical PC, without equal-byte
identity, and evictions count batches while installs count blocks. These
limitations are retained in the task and `outcomes.json`.

The diff contains evidence and task/queue metadata only. Metadata is waived
from execution. `record.py` runs its four logged commands; the A/B executes
both selected existing policy paths; the new offline audit executes on both
actual negatives and rejects the forged success; `seal.py` executes on the
final 29-file bundle. JSON/log/image additions are evidence, not implementation.
No changed runtime line lacks exercise. Unchanged native/private/shared/build/
cold/public proof and known broad CI failures carry forward; no repeated build,
cold clone or deployment is required for this medium-risk local evidence task.

**SUITE:** retain the actual failed pair, direct raw-wire audit, counterfeit-
success attack and existing policy/recorder tests. These failures do not become
success goldens. No runtime test or implementation change is introduced by
this verifier. Pending T03ab is a separate existing-option efficacy experiment;
T03aa authorizes no additional arm, default promotion or responsiveness claim.

## Reproducible independent commands

All Python/Git commands use `DEVELOPER_DIR=/Library/Developer/CommandLineTools`.

```text
python3 evidence/omarchy-profile/admission-after-fp-verifier/audit-carry-forward.py
python3 evidence/omarchy-profile/admission-after-fp-verifier/audit-pair.py
node evidence/omarchy-profile/admission-after-fp-verifier/attack-offline-audit.mjs
python3 evidence/omarchy-profile/admission-after-fp-verifier/audit-seal.py
```

Final raw report SHA-256 values:

- Control: `d07c1228c8181a6828bc88a1408bda8036fd0aa2695a342a694c6fa99fa05713`.
- Candidate: `cb8147bcdea6c4bf36481b0a374d6386477e6462a7bbb536b93135f51454c1c0`.
- A/B receipt: `f6278a310f7834b53dd3b778e58904ec149116d81961d951ca7fbc057d8c6e75`.

Raw paths above are relative to `evidence/omarchy-profile/admission-after-fp-r1/`.
Other evidence filenames are relative to this verifier directory. This final
verdict supersedes the pre-seal provisional review.
