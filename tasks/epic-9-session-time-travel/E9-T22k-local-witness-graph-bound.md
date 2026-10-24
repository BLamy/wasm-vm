---
id: E9-T22k
epic: 9
title: Admit bounded large local histories without widening portable archives
priority: 524.922027
status: in-progress
depends_on: [E9-T22j]
estimate: S
risk: high
capstone: false
---

## Goal

Let a genuinely retained local exact-GPU history grow past the portable
archive's 4 GiB logical graph cap while keeping every local reference
authenticated and bounded.

## Boundary

One policy split in complete witness-graph inventory and its local consumers.
Local publication, reopen, cleanup, library preview and bounded history reader
must admit an authenticated graph whose logical object lengths exceed 4 GiB
but whose physical chunks obey configured retention. Keep a separate explicit
local logical/object-count guard. Portable bundle and storage-only witness
archive export/import remain capped at 4 GiB and 65,536 objects. Do not change
checkpoint cadence, guest assets, workload amounts, archive format, per-object
authentication, retention setting or replay semantics. E9-T22c owns the next
complete cold-workload run.

## Acceptance criteria

- [ ] Reproduce the exact E9-T22c rejected publication boundary and independently
      account for its committed/candidate logical graph, physical chunks and
      authenticated witness closure. A local policy must accept that candidate
      without dropping a reference or changing its bytes.
- [ ] Admit and reopen a bounded, deduplicated local witness graph above 4 GiB
      through every local consumer, including GC and the GPU reader. The graph
      inventory must still reject missing/corrupt/conflicting objects, excessive
      local logical bytes/object count and cancellation before publication or
      playback.
- [ ] Continue to reject the same over-4-GiB graph as a portable bundle or
      storage-only archive with typed `BundleBound`; retain the existing 4 GiB,
      65,536-object and per-object archive limits and previous small archives.
- [ ] Pass scoped high-risk native/Wasm/browser gates, exact-head evidence,
      final cold-clone proof, a fresh actual Daybreak adversarial verdict and
      production demo verification. No C workload or timing claim belongs here.

## Deterministic acceptance

`E9_T22K_DESKTOP=target/evidence/e9-t22c-submission-b40712603/desktop make
verify-E9-T22k`: reconstruct the failed candidate from the retained original
browser state, resume its exact publication in a copy of that Chrome profile,
then run bounded browser attacks, independent byte oracles and the demo. Set
`E9_T22K_DESKTOP` to the same retained evidence bundle's absolute path in a
pristine clone. The failed C prefix is diagnostic evidence; a shortened boot
must not be called C acceptance.

## Adversarial verification

Try to smuggle the above-limit local graph into either archive path, corrupt
one unrequested physical chunk, remove a required witness page, collide a
digest with a different length, exceed the local object/byte cap, cancel an
inventory walk and induce GC. Inspect every changed caller so an archive or
immutable-source reader cannot accidentally choose the local policy. Sabotage
one rejection assertion and prove the test fails. Keep the 4 GiB archive
decoder/index bounds intact.

## Verification log

### 2026-10-24 — worker — activate from exact C failure

The complete Omarchy attempt at `b4071260307146339230ec0986daafcd9661dbeb`
and fresh Daybreak candidate reconstruction are recorded in E9-T22c. The
first rejected candidate is 4,311,983,484 logical bytes with only
2,981,235,217 physical saved chunk bytes. Production local publication calls
the shared witness inventory's 4 GiB archive guard before committing the
checkpoint. This high-risk S task isolates that runtime policy boundary; it
does not qualify the full workload, change the original reference, or authorize
a PR merge.
