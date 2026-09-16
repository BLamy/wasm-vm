VERDICT: verified

Scope: the fixed existing-option experiment and its honest negative outcome.
**Desktop responsiveness fails in both arms; T03q remains gated.** This is
not promotion of cap-256 or a performance/cause claim.

Reviewed worker submission `9245901f0d0e9dfbba2f0e937acf6e02929f6dfb`, frozen
recording source `f730bc553ee63eec303aa36ab8291e3af2afac24`, and predictions
R1-R8 written before either arm. Every one of the 32 sealed worker files
rehashes against index SHA-256
`3bbc03e8e0138754100d48c05d1735ce70fc567801a6cc5342e499456e5a4548`.

## Predictions and observations

- **R1 — HELD.** Original recycling defaults and tests are retained. The
  explicit residency mode constructs only cap-24 control/cap-256 candidate,
  recycling off. The actual option/URL/runtime functions run in the 62-test
  gate and both browser arms. Unsupported experiment, inherited URL tuning
  and runtime policy drift reject. Two independent actual-CLI checks reject
  use outside input-trial and mixed residency/checkpoint before output setup.
  Citations: `../residency-after-fp-gates/recorder.log`,
  `preflight-checks.json`; implementation coverage is in `source-review.md`.
- **R2 — HELD.** Actual report samples select repack-off/24 versus cap-256/256,
  with recycling false, threshold 512, capacity 65,536, cache 4096, icount
  divider 64, display 1280x800 and observation/timing off. Source/artifact
  continuity proves that only `budget.max_batches` varies; code 32 MiB,
  table 32,768 and metadata 8 MiB budgets and other runtime policies remain
  unchanged. LP1 carries from the pinned R3 pair, not a new GL probe.
  Citations: control `report.json:126,1244`; candidate `:116,1279`;
  `carry-forward.json` and selector `crates/wasm/src/lib.rs:503-544`.
- **R3 — HELD.** Independently hashed both arms' 95 served receipts, 86
  browser request routes, 14 recorder-helper pins and all four exact R3
  inputs. Same committed recording source and 1,597,495-byte WASM, SHA
  `1bc7285239db053abdaaafe4c5869a5a2495c7c149d01a239ec020e1fedbf88d`.
  Runtime crates/web/Cargo are unchanged from verified T03z and T03aa. All
  69 sealed T03z files, 29 T03aa files and selected T03k/T03m pins rehash;
  cold/deployment and unchanged semantics carry forward. The September 10
  diagnostic remains present and hashed. Citations: `carry-forward.json`,
  `pair-inspection.json`, `seal-inspection.json`.
- **R4 — HELD.** One control then one candidate, separate owned launches,
  normal browser/recorder closure, no overlap, retry, extra arm or watchdog.
  Source and raw receipts preserve 300/60/120/20/30-second bounds; the parent
  accepts pair completion while retaining child exit 1 in both arms.
  Citations: `../residency-after-fp-r1/ab.json`; control `report.json:25879`;
  candidate `:24802`; unchanged `omarchy-owned-trial.mjs` in the source audit.
- **R5 — HELD.** Real app readiness and restored state precede physical
  input; startup qualifies in 127,803/66,718 ms. T03m's recorder-only window
  queries remain absent. Independent literal key-code reconstruction matches
  all 128 trusted, nonrepeat, focused transitions and 256 ordered keyboard/
  sync calls and acknowledgements per arm. Nonce filenames are independent.
  Raw serial commands contain only app layers and read-only file lookups;
  no command writes a nonce through serial. Citations: control raw input
  `report.json:2898`, keyboard `:25857`; candidate `:2973`, `:24780`;
  the full reparse is in `pair-inspection.json`.
- **R6 — HELD as faithful failure; nonce acceptance FAILED.** Control has
  12 completed reads returning exit 75 and one pending; candidate has 17
  returning 75 and one pending. No raw guest reply contains either nonce.
  Control's last complete fence is `report.json:25026`, followed by deadline
  `01:53:12.013Z` at `:25868`; candidate's last fence is `:24069`, followed
  by deadline `01:56:27.208Z` at `:24791`. These are exactly Enter+120s.
  Failures at +3/+2 ms do not extend acceptance. `raw-citations.json`
  records precise fence IDs, sent/completed times, lines and report digests.
- **R7 — HELD as faithful failure; visible response FAILED.** I personally
  viewed each actual baseline and final failure image. All show the original
  empty Foot prompt and cursor, with no typed command or response. Frames
  and successful presents stay 2->2. All four PNGs have SHA
  `97fc180d4d35c68ca5941dc591afb315220550165469f3c4ead7827989cc2f3f`.
  Citations: `visual-inspection.json`; control presentation at
  `report.json:255,1373`; candidate `:245,1408`. Input-window JIT shares of
  32.820343%/66.339546% are recorded observations only. They cannot override
  failed absolute input acceptance or establish a comparative speedup.
- **R8 — HELD.** Frozen affected checks pass 62/62 with zero skipped,
  cancelled or failed and three syntax checks. No runtime hunk changed.
  The bounded novel attack forges favorable control result fields in memory
  while giving its first runtime observation the candidate cap 256; the
  audit rejects at `assertInputTrialRuntime` with expected 24/actual 256.
  Original raw evidence is unchanged and no additional browser/guest runs.
  Citations: `worker-audit-attack.json`, `preflight-checks.json`,
  `source-review.md`, `seal-inspection.json`.

Raw control report SHA:
`65fb5dc0ac51e50702ea0583ea8bdb15f8bab98455c9068b1165581a2c86bdd5`.
Raw candidate report SHA:
`33eaa82a64ade55c36efb27aca5ac021a3d028ab77dbdd696b83a4be6d8dc037`.
`outcomes.json` independently derives counters and preserves the distinction
between physical-PC recurrence and equal code, and batch versus block counts.

## Coverage and permanent disposition

Both new real selections execute in the recorded pair. Existing default
selection and negative guards execute in focused tests. New recorder
preflight rejection branches execute through the actual CLI; unchanged
physical success/deadline/presentation guards retain their prior tests and
source proof. Worker freeze/record/audit/counter/seal scripts execute on the
retained artifacts and their results have been independently checked.
Task/queue/log changes are metadata and waived. No unproven runtime hunk or
remaining evidence gap exists for the bounded experiment.

Retain the three new fixed-selection regression tests, original tests,
offline audit and honest failed pair. The verifier scripts are reproducible
read-only checks, except writing their own receipts. No duplicate build,
cold clone, deployment, browser arm or broad CI run is required. The five
inherited broad CI failures remain historical limitations, not green gates.
No implementation was edited by this critic.

Independent commands, with `DEVELOPER_DIR=/Library/Developer/CommandLineTools`:
`python3 .../audit-carry-forward.py`; `node .../check-preflight.mjs`;
`python3 .../audit-pair.py`; `node .../attack-offline-audit.mjs`;
`python3 .../audit-seal.py 3bbc03e8e0138754100d48c05d1735ce70fc567801a6cc5342e499456e5a4548`.
All paths abbreviated here are within this verifier directory.
