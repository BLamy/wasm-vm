---
kind: "Current reference"
source: "docs/design/session-gpu-history-reader.md"
source_revision: "c396efe1ecd061721865a5929235e6d0a6268561"
source_sha256: "466002e74c24a1f8060e48892609385b71ffd16d3736434dccc62671ef3e573e"
scope: "Current source at the stated revision; not part of the pinned migration inventory"
---

# GPU history reader

{% hint style="info" %}
Current reference. Published from the exact source at revision `c396efe1e` (the PR 626 stack), separately from the pinned migration inventory. It describes the shipped format and its stated limits; read it with the time-travel guide. Contracts at the same revision: [Replay contract](https://github.com/BLamy/wasm-vm/blob/c396efe1ecd061721865a5929235e6d0a6268561/docs/design/session-replay-contract.json) · [Workload qualification (v11)](https://github.com/BLamy/wasm-vm/blob/c396efe1ecd061721865a5929235e6d0a6268561/docs/design/session-workload-qualification-v11.json).
{% endhint %}

E9-T22f authenticates a finished GPU recording in required witness-page format v2
before exposing storage cursors. It returns `storageAuthenticated: true` and
`nativeAdmitted: false`. Native continuation, browser execution and original
Linux/Omarchy workload and performance qualification remain separate tasks.

```js title="Session gpu history reader / 01"
await SessionGpuHistoryReader.withOpen(store, id, {signal}, async reader => {
  let cursor = reader.initialEventCursor;
  while (cursor) {
    const window = await reader.nextReceiptWindow(cursor);
    // Consume these caller-owned receipts/payloads before requesting more.
    cursor = window.nextCursor;
  }
  let witnesses = reader.initialWitnessCursor;
  while (witnesses) {
    const page = await reader.nextWitnessWindow(witnesses);
    witnesses = page.nextCursor;
  }
});
```

The callback holds shared maintenance and same-session locks. Same-session
writers, deletion and cleanup refuse while it is active; other sessions can have
writers. Abort, close, database version change, callback exit or failure revoke
authority. Store streams check cancellation before and after asynchronous reads,
Blob allocation and hashing, including the first complete directory scan.

Before the callback, the reader authenticates every reachable asset, event chunk,
external body, native frame, RAM delta, disk root and witness page. It binds the
configuration to the internally imported current Wasm hash **and length**, GPU
build stamp, fixed native topology, core snapshot identity, provider policies,
image/kernel refs, clock, physical host profile and retained renderer snapshots.
Retained asset URLs are never fetched during reads. A bounded native clock
inspector decodes the authoritative CLOCK codec without constructing a machine.

The first pass retains scalar window plans and reference/ticket metadata; it
retains no complete-history receipt or body array. Each later receipt window
re-reads and hashes its chunks/bodies, checks its preflight digest and returns at
most 4096 receipts and 64 MiB of receipt bytes. GPU external bodies separately
retain the existing 256-object, 64-MiB aggregate, 32-MiB individual limits. A
witness window contains one real durable page, at most 16 rows and 8 KiB.
Manifest, event, native frame, RAM, witness, retention and staging limits are
unchanged. The default v1 writer and compatible small v1 reader are unchanged.

A window preserves exact original positions and contiguous sequence coverage.
Its digest binds session ID, canonical manifest hash, revision, native disk
root generation, stream/index, range, predecessor, ordered receipt digest and
referenced GPU bodies. Cursors are opaque identity capabilities scoped to one
reader; copies, foreign tokens, wrong streams, concurrent use and replay refuse
without advancing either stream. A failed fetch poisons the reader. Returned
arrays and bytes belong to the caller and cannot alter private progression.

Cuts between `Before` host deliveries are allowed at the same transition and
with nonzero ordinals. The real 4100-input fixture has 4101 `Before` receipts at
T0; the first window ends at ordinal/sequence 4096 and the next starts at 4097.
The genuine witness at ordinal/sequence 2048 is retained. No witness or guest
transition is invented at a window cut. All `Observe` receipts at one transition
stay together; an overfull indivisible observation group refuses.

Tickets are canonical, unique u64 values below the unallocatable maximum. Values
below the initial clock's frontier must exactly match an authenticated pending
host effect. Tickets strictly increase within one same-transition `Before`
group, with gaps allowed. Consecutive same-transition `Observe` ordinals require
consecutive tickets: native commit leaves the phase in `Observe`, and reopening
a scope requires resetting the transition or ordinal. There is no global ticket
monotonicity rule. G remains responsible for exact future native delivery and
frontier equality.

`resident` reports explicit owned window/buffer maxima and encoded retained
metadata, **not RSS or JavaScript heap usage**. Caller-retained windows and the
Wasm allocator's reserved linear memory are outside those ownership counters.
The independent oracle reconstructs receipt bytes from raw native batches and
CAS parts and checks all returned coordinates, identities and window digests.

`make verify-E9-T22f` runs the frozen high-risk submission. It includes actual
4100-input and >64-MiB block histories, the original production GPU/query/readback
control, rehashed ticket/profile/provider attacks, corrupt/missing middle
objects, cancellation and stale cursor attacks, native/Wasm checks and the built
demo. Final acceptance also needs a pristine checkout, main-site publication and
a fresh actual Daybreak critic. These freestanding guests are storage/reader
controls; they do not qualify the original Linux/Omarchy workloads.

## Related field guide

{% content-ref url="./docs.html?page=time-travel" %}
Record, rewind, and branch
{% endcontent-ref %}
