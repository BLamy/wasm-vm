VERDICT: verified

Scope: **the recorded negative configuration diagnostic and corrected audit
guards only. Opacity remains unconfirmed; physical input was never tested;
desktop responsiveness is unresolved; T03q remains ineligible.** This verdict
does not approve a responsive result, new release, deployment or merge.

Worker submission: `1f2ab49e`. R1 recording head:
`94647c4993b062961b26e82bc2c8484431fe8c05`. R2/R3 recording head:
`20737fb7bd9051286629beafc2a4f15ae839ee64`. Offline auditor correction:
`ed7edad7e1bdfa627809c93dc11a4838311180b5`, made after all guests closed.

## Predictions and results

- **P1 provenance/boundary — HELD.** All 22 reported helper files per run match
  their frozen Git blobs; each run's 93 served resources rehash correctly,
  including the unchanged R3 pair/kernel/manifest and verified WASM
  `1bc7285239db053abdaaafe4c5869a5a2495c7c149d01a239ec020e1fedbf88d`.
  Actual URL/runtime selection is cap256, recyclingOFF, icount/div64; all final
  resources have the original 1280×800 visible rectangle and 1280×832 backing
  resource. `opaque-foot-r1-audit.json`, `opaque-foot-r2-audit.json` and
  `opaque-foot-r3-audit.json` record the independent audits. `source-audit.json`
  confirms the complete crates/web trees are unchanged from verified T03z and
  rehashes all 69 prior runtime/cold/deployment evidence files.
- **P2 actual properties — gate HELD; desired configuration FAILED/UNPROVEN.**
  R1 sends exactly one fixed batch and returns `ok,false,false,0.985`, which is
  rejected before any input. Raw values: `opaque-foot-r1/desktop/report.json`
  lines 8320, 8329; parsed receipt line 8654. R2/R3 send exactly one corrected
  command each, with rule update followed by a separate property request, but
  no complete fenced property response exists. R3's partial `ok` is insufficient
  and is never treated as opacity confirmation. No sweep or property substitution
  appears in the wire records.
- **P3 physical proof — fail-closed behavior HELD; actual input NEEDS EVIDENCE.**
  All three recordings have zero DOM key events, no keyboard receipt and no nonce
  read commands. R2 `report.json:1686`, R3 `report.json:1666` contain empty input
  arrays; every independent audit reports `startup-failed-input-not-tested`.
  Neither a nonce nor a trusted physical response is claimed. One auditor gap
  found with an explicitly synthetic success fixture (F1) is resolved below.
- **P4 timing — enforcement HELD; startup completion FAILED.** R1 rejects actual
  wrong properties at 03:56:01.416Z before its 03:58:52.927Z limit. R2 preserves
  its 04:03:24.613Z deadline and fails at 04:03:24.616Z; R3 preserves its
  04:10:07.629Z deadline and fails at 04:10:07.633Z. No input/readback clock starts
  after these failures. R2 report lines 14057–14059 and 14126–14133; R3 lines
  15407–15409 and 15476–15483. Failure images are captured within 20 seconds;
  owned cleanup takes 141, 724 and 212 ms, all inside 30 seconds. The original
  60-second typing and 120-second Enter-relative readback controls remain in
  source and pass deterministic guard tests; no runtime assertion that they
  succeeded is made.
- **P5 visible response — gate HELD; product response NEEDS EVIDENCE.** I personally
  viewed all six initial/final images. Each shows the same empty Foot prompt,
  with no entered command or response. Every initial/final PNG has SHA-256
  `97fc180d4d35c68ca5941dc591afb315220550165469f3c4ead7827989cc2f3f`.
  Frame counters of 5, 2 and 3 at the respective failure observations do not
  establish visible responsiveness. Image paths/hashes are in each run audit.
- **P6 lifecycle and honest disposition — HELD.** Every child exits 1, normally
  closes its owned browser/client, has no watchdog intervention and records zero
  browser errors. Both failed R2 and identical failed R3 remain in the worker
  seal. The claim explicitly has `desktopSolved:false` and `releaseEligible:false`;
  no publishing occurs. R1's 14-file seal and R2/R3's 24-file seal independently
  pass (`seal-audit.json`).
- **P7 changed-hunk sufficiency — HELD for the diagnostic claim.** `coverage.md`
  maps every changed hunk to real negative-run execution, deterministic helper/
  actual-orchestration tests or a declaration/logging waiver. Synthetic positive
  controls establish guard behavior only. They do not establish the missing
  configured-input/product path. Frozen worker checks pass 47/47 plus two syntax
  checks; the final focused critic rerun passes 12/12.

## Independent attacks and resolved finding

The bounded forged-property attack accepts a valid control and rejects (1) a
forged positive summary over false raw values, (2) false values in summary and
wire, (3) a late response under backdated metadata and (4) command echo without
a real reply. `attack.json` records each fixture, exact error and helper hash.
The independent late-readback fixture rejects a raw nonce response one millisecond
beyond the deadline despite an on-time summary, and rejects stale frame counts.

**F1 initially FAILED, now HELD.** The original auditor skipped physical-completion
checks when `keyboard.typedAt` was absent and could return machine acceptance
with zero keys. I reproduced that twice (`input-audit-test.json`,
`input-audit-recheck.log`; helper hash `4933a5ee…`). The worker's scoped correction
now requires completed typing, exact down/up/Shift/Enter events and consistent
timing. The same independent fixture now rejects, while the valid synthetic
control still passes (`input-audit-fixed.json`; helper hash
`17aeff63db4441fc45b996af66f8102cde630b9b7b04f14b045f679b4f74e38f`).
Original reproduction bytes remain intact; `seal-audit.json` verifies this.
`findings.md` retains the original source-line finding and its resolution.

## Evidence identities

| Recording | Raw report SHA-256 |
| --- | --- |
| R1 | `9127ede20f15a37205ecb896cfff9cf2b9ed68bc08cf4ddd7f76df12cbaa8b72` |
| R2 | `8252db4688dd509e5afc797ed900eb1ea1f47d20e8597127fb98e44878795d9c` |
| R3 | `4a83b9cf1a4ed360a0d0ab2e98c431019bc97df103a7724b631b6d24f8748db9` |

Worker seal indices: R1
`09dde7caab1023dfe531cce991e6fe873e587d5413bee6dec98b97821b5cc432`;
R2/R3/correction
`4d5bc22a99cf407a23ce30da34cdae4ec2033982437461d56ef4677fbb139a0a`.

No implementation, Git state, task status or queue was changed by this verifier.
Root owns applying this narrow verdict and continuing the unresolved product work.
