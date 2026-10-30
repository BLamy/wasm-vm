# Paged exact state witness storage

E9-T22i introduces one reference-bearing storage feature for long exact histories.
It does not admit whole-history playback. The ordered bounded reader, native
executor and browser integration remain E9-T22f/g/h; original Alpine/Omarchy
workload and performance qualification remain E9-T22c/d.

The default v1 recorder and its completion list keep their existing behavior.
Manifest size remains 1 MiB, each extension remains at most 8192 bytes, manifest
indexes remain at most 4096, complete session closure remains at most 4 GiB,
and default physical retention remains 2 GiB. Native replay-plan limits and the
original 50-million-transition checkpoint cadence are unchanged.

## Required storage feature

Explicit paged GPU recording starts with these two extensions in this order:

1. Optional `e9-exact-initial-witness-v1`, containing the immutable initial row.
2. Required `e9-exact-witness-pages-v2`, containing a compact commitment.

The v2 feature must exist in the first publication. An existing v1 recording
cannot acquire it through append. The v1 completion extension cannot coexist
with v2. An older metadata validator rejects the unknown required feature,
before it can reclaim or transfer a graph whose new references it cannot see.
Unknown required extensions remain unsupported by the new validator too.

Canonical commitment field order is `version,count,pages,tail,first,last,finished`.
Version is the JSON number 2. Counts are bounded JSON unsigned 32-bit integers.
`tail` is a content-addressed reference with fields `sha256,length`; the hash is
64 lower-case hexadecimal characters and length is a canonical decimal string.
`first` and `last` are complete witness rows, not a replacement for the pages.

Canonical page field order is `version,previous,before,rows`. Version is 2;
`previous` is either a page reference or null; `before` counts preceding rows.
Each page contains 1–16 rows and at most 8192 encoded bytes. There are at most
4096 pages, a separate v2 index bounded by the existing index capacity; the
maximum row count is therefore 65536. Partial immutable pages consume one index
entry each and cannot later be filled. The previous reference includes its
exact length and each object is SHA-256 authenticated.

Canonical witness field order is `transition,phase,ordinal,sequence,retired,digest`.
Transition, sequence and retired are canonical decimal u64 strings. Phase is
`before` or `observe`; an observed row has a nonzero u32 ordinal. A native
`before` row may retain a nonzero observation ordinal. Digest is exactly 32 JSON
byte values. Ordering strictly advances the transition/phase/ordinal/sequence
coordinate, with nondecreasing sequence and retired counters and retired no
greater than transition. Rust/Wasm's typed codec defines the exact bytes;
unknown fields, reordered fields, whitespace, duplicate or unordered rows and
noncanonical scalar encodings are refused.

## Append and complete closure

An unfinished commitment may accompany an event-only append without changing
its last witness. Its last position must be no later than the manifest end under
the full native position relation. Every indexed checkpoint must already have
a row in the authenticated page chain. GPU checkpoint metadata additionally
binds that row's coordinates and digest to its native/renderer frame identity.
Finishing binds the last row exactly to the manifest end and freezes the history.

The pure native append check constrains identity and scalar growth. The shared
asynchronous graph walker additionally proves the old exact tail reference is
an ancestor at its old row count and page count. Monotonic counters and a new
hash alone cannot rewrite an old prefix. Candidate pages are staged before
publication; writer memory accepts the new commitment only after the strict
manifest transaction succeeds. A failed stage, final authorizer or stale CAS
leaves the previous manifest authoritative and pending rows retryable.

Paged publication, reopen, cleanup and storage transfer use the same complete
bounded graph inventory. It authenticates assets, event chunks and out-of-line
payloads, full/delta checkpoint ancestors and RAM chunks, disk roots and every
block, and every witness page. A single reference map rejects conflicting
lengths. A missing or unreadable surviving history aborts cleanup before the
sweep. Page payload residency is one page; the bounded reference inventory
contains hashes and lengths rather than every witness byte.

## Storage archives and playback

The existing `WVBUND01` container has two distinct canonical header schemas.
`wasm-vm-installed-build-v1` retains the existing runtime identity, complete
native decoder/interval admission and playback APIs.

`wasm-vm-witness-storage-v2` uses `scope: "storage-only"`, a manifest and the
exact object inventory. It makes no installed-runtime portability or playback
claim. Its separate export/inspect/import APIs authenticate the complete
paged graph before staging/publication and support unfinished as well as
finished commitments. Inspection reports the finished bit and witness count.
The storage module never creates a guest machine or qualifies physical GPU
hardware. Playback APIs reject its discriminator before reading runtime fields;
legacy readers also reject the required v2 manifest before decoding events.
The session list marks these histories as storage-only and the timeline gates
playback until the ordered reader/executor work is independently verified.

## Direct proof

`make verify-E9-T22i` records 130 actual native GPU machine witnesses with a tiny
RISC-V UART guest, including a full resident page, more than 63 genuine native
checkpoints, and a partial final page. It records raw native logical state and
RAM digests, all raw receipts, physical stored objects and a browser capture.
An independent Python decoder checks literal page bytes and all 130 native
witness bindings. Bounded publication, cleanup and archive mutations exercise
missing, corrupt, reordered, duplicate and rewritten data, quota and stale CAS.
The visible demo check proves this storage boundary only; it does not claim a
completed full desktop, whole-history replay or the downstream performance budgets.
