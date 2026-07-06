---
id: E3-T05
epic: 3
title: IndexedDB overlay backend
priority: 305
status: pending
depends_on: [E3-T04]
estimate: M
capstone: false
---

## Goal
A `BlockBackend` implementation persisting the write layer in IndexedDB: guest writes survive
tab reload. Writes are batched into transactions; `commit` resolves only when the data is
transaction-complete with strict durability.

## Context
IndexedDB is the universally available option (OPFS sync handles, T06, are faster but newer).
Constraints: the API is async-only and callback-based — bridge it to the worker running the
VM through the wasm boundary without stalling emulation (writes go to an in-core write-back
queue; T08 formalizes the flush contract, but this backend must already expose an honest
async `commit`). Schema: one object store `blocks`, key = block index (u64 as 8-byte key),
value = block bytes; a `meta` store holds format version + base-image binding from T04.
Use `durability: "strict"` on commit-critical transactions; batch normal writes into fewer,
larger `readwrite` transactions (transaction-per-write is catastrophically slow). Version
the DB via `onupgradeneeded`; DB name namespaced by image id so multiple images coexist.

## Deliverables
- `IdbBackend` in the wasm layer implementing `BlockBackend` (via `web-sys` IndexedDB or
  `idb`-style bindings), with write batching and strict-durability commit.
- Schema + migration scaffolding (`meta` store, version constant, upgrade hook).
- Browser integration test (headless Chrome via the existing WASM test harness): write
  blocks, drop the backend, reopen, read back identical bytes.
- Microbench hook (consumed by T07): 4 KiB random write IOPS, sequential write MB/s,
  commit latency.

## Acceptance criteria
- [ ] Boot Alpine on `OverlayDisk`+`IdbBackend`, `echo hi > /root/f && sync`, reload the tab,
      boot again: `cat /root/f` prints `hi`.
- [ ] T04 proptest suite re-run against `IdbBackend` (browser harness, reduced case count)
      passes byte-identical.
- [ ] `commit` resolves only after the IndexedDB transaction `complete` event with
      `durability: "strict"`; verified by code inspection and a test asserting ordering.
- [ ] Two different image ids produce two independent DBs (writes to one invisible to the
      other).
- [ ] A version-mismatched existing DB triggers the migration path or a typed error — never
      silent reuse.

## Adversarial verification
Reload-kill torture: in a loop, write a recognizable pattern, `sync`, kill the tab via
DevTools protocol at random delays, reopen, verify either old or new content per block —
torn/interleaved block content is a refutation. Fill the store with ~1 GB (or until quota,
see T10) and confirm behavior is a typed error, not an unhandled rejection. Open the backend
in a private/incognito window (ephemeral IDB) and confirm it works within the session.
Attempt reads concurrent with a large batched write and check no transaction ordering bug
returns stale data after `commit` resolved.

## Verification log

**2026-07-06 — write-back bookkeeping core (pass 1), PR stacked on #92.**
`crates/storage/src/writeback.rs`: `WriteBackOverlay` — the browser-agnostic write-back layer the
durable backends (IndexedDB T05, OPFS T06) share. IndexedDB/OPFS are async but `OverlayBackend` + the
`OverlayDisk` read path are synchronous, so it holds the full write layer in memory (sync reads/writes)
and tracks an `unpersisted` set the async store drains via `pending_flush()` (snapshot) /
`mark_persisted()`. `from_loaded()` reopens with everything persisted. Sync `commit` is documented as
NOT the durability barrier (the async store's transaction-complete is; E3-T08 wires FLUSH to it).

Cold-clone critic **FIX-FIRST → fixed**: confirmed a HIGH-severity **lost write on re-dirty-during-
flush** — `mark_persisted` cleared a block unconditionally, so a guest re-writing a hot block WHILE its
flush txn was in flight lost the newer bytes (silently stale on reload). Fixed with a per-block dirty
**generation guard**: `pending_flush` stamps each block's generation; `mark_persisted` clears a block
only if its generation is unchanged since the snapshot, so a re-written block re-flushes its new bytes.
Regression test `re_dirty_during_flush_is_not_lost`. Critic verified sound: sync read view, snapshot
integrity (no panic — `unpersisted ⊆ blocks`), mark scoping, OverlayBackend drop-in, commit no-op.

Gates: storage 43/0, workspace clippy --all-features + fmt + determinism + wasm build; `cargo tree -p
wasm-vm-storage` still no browser deps. **Remaining (pass 2, stacked branch):** the `IdbBackend`
web-sys IndexedDB glue (load-on-open, batched readwrite transactions, `durability:"strict"` async
commit, meta store + version + image-namespaced DB) driving this write-back core, plus the browser
reload-persistence integration test + reload-kill torture.
