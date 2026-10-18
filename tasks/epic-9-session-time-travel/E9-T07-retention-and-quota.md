---
id: E9-T07
epic: 9
title: Manage session quotas retention and shared-data deletion
priority: 524.907
status: verified
depends_on: [E9-T03, E9-T04, E9-T06]
estimate: S
risk: high
capstone: false
---

## Goal

Keep local recordings within explicit user-controlled storage limits without corrupting shared history.

## Boundary

Quota handling and reference-aware session deletion/garbage collection; no cloud storage. Expose origin usage, persistent-storage request outcome and retention controls.

## Acceptance criteria

- [x] Quota exhaustion stops or pauses recording with a clear state and preserves the last committed prefix; do not silently discard a named session.
- [x] Delete one branch and reclaim only unreachable chunks; shared checkpoints, disk roots and sibling sessions still restore.
- [x] Interrupt garbage collection and reopen storage safely; surface browser eviction or missing data honestly and provide delete/retry actions.

## Deterministic acceptance

`make verify-E9-T07`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Force quota failure during append and interrupt GC after reference updates. Check every surviving session against its original content hashes and disk roots.

## Verification log

### 2026-10-18 — worker — started

Dependencies E9-T03/T04/T06 are independently verified. This S/high-risk slice owns
browser session-storage maintenance: explicit payload/point limits and origin persistence
feedback, quota-safe recording pause/retry, and locked reachability-based deletion/cleanup.
No named history is automatically discarded. The planned proof includes real browser quota
failure during append, shared machine/disk/event references, interrupted cleanup and reopen,
varied two-tab lock schedules, actual guest restores and a final pristine-source run.
The retained GPU runtime stays pinned; accelerated history remains gated to T17/T18.


### 2026-10-18 — worker — implementation ready for recorded submission

Implemented schema-v2 atomic unique-chunk accounting, explicit byte/point limits,
shared writer/read maintenance leases, and exclusive nonblocking delete/GC. Cleanup
marks authenticated machine/assets, out-of-line event payloads and complete disk-root
leaves from every surviving raw session row. It refuses corrupt or unknown extension
references before sweeping. Row deletion is durable first; a single strict sweep
transaction reclaims only unmarked data and updates usage, so interruption leaves
recoverable orphan storage. Version-one migration preserves existing rows and payloads.
The visible library reports origin estimates and persistence outcomes, preserves missing
named rows as incomplete, and exposes limits/delete/cleanup. Quota pauses release the
writer and keep the guest paused; Retry checks both cursor and manifest identity before
appending. Open holds a read lease through admission and actual owner replacement.

Development-only self-validation (`--development`, not the final evidence) passed in
`target/evidence/e9-t07-browser-inner-2`: 127/0, no errors, genuine Chromium quota failure
during a real guest append, same committed prefix, successful retry, deletion with exact
sibling tuple/file/RAM restoration, migration, two renderer crashes and 16 varied lease
schedules. Separate independent parsing in `target/evidence/e9-t07-files-inner` validated
all native sections and reconstructed shared/private/reopened ext4 files. The first quota
trial is retained as a failed harness run: Chromium's cached bucket allowance required a
31-second expiry before the override could produce a genuine failure. The small
`target/e9-t07-quota-expire-probe.mjs` isolated that behavior. `make verify-E9-T07` now
records the affected native/Wasm/browser gates at a frozen clean head. Final submission,
pristine clone, deployment and adversarial verdict are still pending.

### 2026-10-18 — worker — recorded submission

Frozen implementation: `2c9c0a5657dd0ab0d2a7d3a72f2c9742cd90521b`.
`GIT_OPTIONAL_LOCKS=0 E9_RETENTION_EVIDENCE_DIR=target/evidence/e9-t07-worker-final make verify-E9-T07`
passed all 21 recorded gates (affected storage/native/Wasm/codec/build/protocol and
built-browser integration). Original report SHA-256
`f0a9b8544b110bd2918a781adcc98830c3be2f1bc0fecb9b719e1d5202f9351b`;
browser report `a412e98be088f27439831f10f9d8d1becd641a75aa03db0c3a7c1ed4e2e0fddc`.
Compact receipts, logs, original sources, screenshots, unique compressed frames and
independent filesystem witnesses: `evidence/e9-t07/worker/`. Original full recording,
profile, coverage and reconstructed images remain in `target/evidence/e9-t07-worker-final/`.

The actual offline guest hit Chromium's genuine quota limit during append. The saved
revision-one frame stayed `e0d396a6823b2de8bdd50ba7a3cd39daa2b759741eeb88d604ea9e0a1dee420a`;
the guest paused, released its writer and visibly distinguished unsaved memory from the
committed point. Explicit Retry added revision two. Deleting the original session
preserved a real sibling's exact frame/disk/RAM and `shared-prefix` file, while its
private later state held `private-later`. Ten raw tuples, all sixteen native sections,
sparse RAM and canonical disk roots were independently parsed and actual ext4 files
read with read-only debugfs. Two renderer-crash cuts, sixteen writer/read/GC schedules,
v1 migration, unknown/malformed/missing references, deduplication, atomic accounting,
partial deletion, stale Retry, eviction and persistence feedback passed. Browser:
127 passed / 0 failed, zero unexpected errors, desktop and 390px screenshots. The
unchanged pinned 47-file GPU runtime also restored, executed instructions and drew a
fresh physical epoch without loss or poisoning.

Final clean-source proof:
`GIT_OPTIONAL_LOCKS=0 python3 -B target/e9-t07-cold-wrapper.py` passed the same 21 gates
from a pristine local clone with scrubbed Rust/Cargo/Git environment and no inherited
target or node_modules. Receipt SHA-256
`b96a3ec4552ec304798ea18f7485ea39ed5e8079723bd12ed65ee8409a313690`;
acceptance report `2cfc7894e4b8d269b33e370280d94b6b6c583db003d785b98998625f6b6e1ddd`.
`evidence/e9-t07/cold/` records the wrapper, exact inputs and cleanup receipt. The fresh
verifier authenticated all payloads and released only the disposable source checkout;
the external original evidence remains in `target/evidence/e9-t07-cold-final/`.

`bash tools/deploy-cloudflare.sh` published the frozen committed dist to
<https://50fb93f5.wasm-vm.pages.dev> and <https://wasm-vm.pages.dev/>.
The production composite is `evidence/e9-t07/public/provenance.json`, SHA-256
`8d1334f0c0148f2090b1e930995ecdf9f2a870111dc02ef3af53631d292b5bab`.
The original full public run remains **failed**, report
`794798af15f1c2a0dae16710164a8740874ce55df7d62ae1418cd31e2e768d9e`:
all storage/control checks, 127/0 and zero unexpected errors completed before the
unchanged GPU boot's R2 pair download reset (`trace.network` line 879,
`net::ERR_CONNECTION_RESET`; call@655 returned `TypeError: network error`). The missing
public filesystem oracle passed separately on APFS copies of its ten original frames.
The bounded real-public GPU retry then passed, report SHA-256
`508cb4029ba568193836b68f7b962b61669613eaaf14c40a28e3c52f4d47097c`:
all 57 current/archive assets matched, actual boot succeeded, 2,999,712 instructions
retired and a fresh epoch-four physical draw completed qualified, without loss or
poisoning. Original failed and supplementary traces/profiles remain at their recorded
paths; no failed report was relabeled and no storage behavior was substituted.

Independent final verdict and promoted regression remain the fresh verifier's work.


### 2026-10-18 — verifier — VERDICT: verified

- **P1/P2 quota, prefix and Retry — HELD.** Predictions were recorded before evidence
  inspection in `evidence/e9-t07/verifier-final/predictions.json`. Genuine Chromium quota
  failure during a real append pauses the owner, releases all writer/maintenance locks,
  preserves revision one and exposes Retry. Independent decoding authenticates the public
  original/after-quota frame
  `d89e519af2d3916674135a0e1783ef083c98ac9bf508b4ad05912afd1d4d8ae5` and its original
  disk root; Retry produces revision two while preserving point one.
  Citation: `verifier-final/raw-tuples-public.json:414,421`, relative to this task's
  `evidence/e9-t07/` packet; original local trace `trace.trace:892` / `after@call@275`.
  Independent same-revision manifest replacement returns HistoryChanged with zero owner
  calls and no locks, so a cursor match alone cannot resurrect changed history.
- **P3/P4 accounting, migration and reachability — HELD.** Shared fixture payload is
  9,010 bytes before and after sibling publication; point/byte refusal preserves its
  original commit and atomic counter. Two identical MiB parts count once. With one MiB already held,
  only one of two competing unique MiB chunks fits the two-MiB total budget. Actual parent deletion
  reduces saved data from 60,970,545 to 46,484,443 bytes while every surviving original
  machine/assets, complete-map disk leaf and out-of-line event payload retains its hash.
  Public original/restored/reopened frames, all sixteen native sections, sparse RAM,
  canonical disk roots, shell memory and shared/private/reopened ext4 files independently
  agree. The additional surviving post-publication-label-quota session also retains the
  original frame/root. Citation: `verifier-final/raw-tuples{,-public}.json`,
  `promoted-report.json` accounting/graph checks, and `raw-tuples-public.json:442,475`.
- **P5/P6/P7 interruption and adversarial recovery — HELD.** Real renderer crashes after
  durable row deletion and before strict sweep commit reopen safely; all original hashes
  and canonical surviving manifests agree, then cleanup succeeds. Missing, malformed or
  unknown surviving references refuse sweeping. The independent collector-held attack
  excludes readers/writers/deletion/cleanup; 32 genuinely simultaneous three-page schedules
  exercise both lease winners with no divergence. Visible Delete while busy preserves its
  row; partial deletion says cleanup refused and exposes repair/delete/retry; repairing
  the leaf then Cleanup succeeds. A failed display-label removal remains visibly incomplete,
  disables Open and clears on repeat Delete. A generic Retry-save failure preserves its
  paused prefix and releases the lease. Citation: `verifier-final/promoted-report.json`
  crashes/schedules/inverse/ui checks and the two error screenshots.
- **P8/P9 controls, identity and coverage — HELD.** Public 127/0 suite, zero unexpected
  errors, quota/persistence/eviction feedback and 390px controls pass. Detailed V8 samples
  use UTF-16 offsets and exact-source identity; function-only samples after profiler restart
  are excluded. Every added executable runtime line region has evidence, including a private
  direct-loader restore from a cloned original profile: exact 23,860,091-byte original frame,
  paused, zero scheduler slices, no locks. Residual guarded alternatives and generated metadata
  are explicitly classified in `verifier-final/coverage-and-hunks.md`; full branch coverage is
  not claimed. Source/dist mirrors and software runtime cb49b911 match their actual inputs;
  the original 47-file factory remains 22295002 with its original authenticated bytes.
- **P10 provenance, cold source and production — HELD.** Authenticated all 578 worker,
  583 cold-receipt, 757 original public and 469 GPU-supplement payloads plus the compact
  packets and source identities. The clean-source checkout was inspected before disposal;
  all 31 inputs match, no inherited build/node state or Git alternates, all 21 gates pass.
  Public storage's original failed report remains failed on the recorded R2 reset at
  `trace.network:879`; its completed storage assertions, independent original-frame oracle
  and successful real-public GPU supplement form the authenticated composite. All 57 public
  current/archive assets match; qualified epoch-four physical draw follows 2,999,712 retired
  instructions without loss/poisoning. No claim was substituted for missing evidence.
- **SUITE — promoted.** `tools/verify/e9-session-retention-critic{,-ui}.mjs` now runs after
  the built-browser proof in `make verify-E9-T07`, with syntax gates and source receipts.
  The actual promoted command passed against the original frozen local recording;
  report SHA-256 `29d77431cefbe35a0f49e2e8f3d5eb92c8362abb9775c1162ac1037255799860`.
  Dropping disk-leaf marks fails on caef6174..., dropping indirect-event marks fails on
  2e293f0b...; both exact hashes are asserted. New harness syntax/compile and this exact
  post-browser command pass. The frozen native/runtime/cold/public results carry forward
  across these test/evidence/status-only changes under the incremental policy.

Final verifier packet: `evidence/e9-t07/verifier-final/`, provenance SHA-256
`58174c1d02cb1c7e3192668208e07c2f50b6b58ee1811dc69534952e3f7db99c`.
Original full worker/cold/public recordings and profiles remain local and unchanged;
the promoted critic's two original traces/profile remain in
`target/evidence/e9-t07-verifier-promoted/`. No remaining acceptance or coverage finding.
