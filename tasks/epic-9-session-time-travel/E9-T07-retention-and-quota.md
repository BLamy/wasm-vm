---
id: E9-T07
epic: 9
title: Manage session quotas retention and shared-data deletion
priority: 524.907
status: in-progress
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
