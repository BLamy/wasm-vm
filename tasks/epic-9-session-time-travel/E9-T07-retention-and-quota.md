---
id: E9-T07
epic: 9
title: Manage session quotas retention and shared-data deletion
priority: 524.907
status: implemented
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

- [ ] Quota exhaustion stops or pauses recording with a clear state and preserves the last committed prefix; do not silently discard a named session.
- [ ] Delete one branch and reclaim only unreachable chunks; shared checkpoints, disk roots and sibling sessions still restore.
- [ ] Interrupt garbage collection and reopen storage safely; surface browser eviction or missing data honestly and provide delete/retry actions.

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
