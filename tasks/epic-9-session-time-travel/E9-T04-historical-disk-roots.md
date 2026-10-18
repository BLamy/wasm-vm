---
id: E9-T04
epic: 9
title: Preserve immutable disk state for historical checkpoints
priority: 524.904
status: implemented
depends_on: [E9-T02, E9-T03, E3-T12c3]
estimate: S
risk: high
capstone: false
---

## Goal

Rewind guest files along with CPU and RAM without overwriting the current persistent disk.

## Boundary

Versioned copy-on-write overlay roots and their reference/identity rules. Each checkpoint references an immutable disk generation; replay writes use a private overlay.

## Acceptance criteria

- [x] Create two roots around a real guest file change and restore the matching content from each.
- [x] Keep checkpoint disk roots stable while recording continues and when a separate live branch writes the same block.
- [x] Reject mismatched base images/generations before applying state; preserve shared ancestors when a child session is deleted.

## Deterministic acceptance

`make verify-E9-T04`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Interleave writes and checkpoint publication, then restore both roots in reverse order. Any newer file bytes leaking into the older state, or mutation of a sibling root, is a failure.

## Verification log

### 2026-10-17 — worker — started

E9-T02 and E3-T12c3 are verified, and the preceding session-store slice is independently
verified and published. This high-risk S boundary stores immutable, content-addressed
maps of the complete COW write set, bound to the canonical chunked-image identity and
exact overlay generation. Restoring a root constructs a private overlay; it never seeds
or rewrites the live persistent store. Shared block references remain reachable from
every surviving root. The proof will use real guest file changes and an independent
filesystem reader, interleaved publication/live writes, sibling roots, and identity and
generation refusal cases. Coherent CPU/RAM/device capture remains the T05 boundary.

The persisted-root implementation also uses E9-T03's immutable object store and writer
leases, so that already-verified prerequisite is explicit in the frontmatter.

### 2026-10-17 — worker — implemented claim

Frozen runtime/test head: `b5baad0a4b1cddcbd08299b438292258352b2c08`. Exact command:
`E9_DISK_EVIDENCE_DIR=target/evidence/e9-t04-worker-final make verify-E9-T04`.
All 16 gates passed with a clean tree before and after: affected native lint/tests,
wasm32 builds/lint, bit-identical rebuilt browser bundles, 17 shared Node-Wasm cases
(including 8 disk-root cases), 32 protocol cases, source-inventory/retained-runtime
admission, and the recorded built-browser acceptance. The native and Node-Wasm
root tests each executed 32 deterministic schedules varying writes, capture points,
publication order and private sibling mutations.

Evidence of record: `target/evidence/e9-t04-worker-final/`; receipt SHA-256
`1e2577042ba20e4ed3bd63fe0eb77efbd41371be85255689112ce40c39366efd`
authenticates all 515 original files. The compact copies and digest mapping are in
`evidence/e9-t04/worker/`. Full Playwright trace, coverage, isolated profile and
reconstructed ext4 images remain in the original directory.

The actual software Linux worker wrote/read `e9:before\n`, `e9:after\n`, and
`e9:live\n`; publication of the first root was held across later guest writes.
Capture drained original I/O/durability work without retiring guest instructions.
Fresh private workers booted the newer then older disk root and read their matching
files. The older branch wrote `e9:fork\n` to the same physical block (33281), while
raw durable live-disk block/meta rows remained byte-identical. Root generation is
the native coherence witness; independent branch writes can retain that generation
and still produce different content hashes. Python independently reconstructed the
canonical root/delta format, and Docker e2fsprogs recovered/read all four exact file
contents from owned image copies. The pinned base and before-root bytes remained
unchanged. Wrong base/generation, corrupt/missing blocks, invalid metadata, detached/
mutated producer views and released writers refused. A strict child session-row
deletion plus surviving-root mark union preserved and reauthenticated the parent.
Its placeholder machine pin fixture makes no coherent-checkpoint claim.

The built page passed **127/0**, showed the disk-root pip `verified`, and recorded
zero console/page errors. Screenshots are in the packet. The real published GPU
factory also booted through the matching retained v2 client, retired **2,999,712**
instructions and physically drew in fresh epoch 4. Its original runtime bytes and
frozen pair identity were preserved. E9-T05 coordinates the full machine tuple;
E9-T07 owns atomic retention/reclamation. Fresh critic and final cold proof pending.

### 2026-10-17 — fresh verifier — pre-cold audit

P0–P8 **HELD**, with predictions recorded before opening evidence in
`evidence/e9-t04/verifier/predictions.md`. The worker receipt and all 515 originals
and 51 compact copies authenticate. Independent delta/root decoding, read-only
ext4 reads, exact same-block file bytes, live database equality and surviving-root
union checks held. The changed-hunk audit and scoped waivers are in
`evidence/e9-t04/verifier/audit.md`.

Promoted 64 independent native schedules for equal-generation siblings at u64::MAX,
shared blocks and a one-byte image tail; a temporary sibling-alias sabotage fails
the independent byte oracle (exit 101), and the original passes. Promoted actual
browser loader admission/owner races and direct native capture at an original pending
read and WritePending. Capture itself fetched the original chunk, drained 4096 bytes
to strict durability, advanced generation 0→1 and left both icount clocks unchanged.
A corrupt-chunk fixture proves the 16-pass bounded refusal on an isolated real page;
the actual demo's zero-console-error gate remains strict. The initial supplementary
runner's broad console assertion caught those intentional errors; its log is preserved,
and the corrected narrow run asserts their exact sequence. No runtime code changed.

Commands: `cargo test -p wasm-vm-storage --test disk_root_verifier -- --nocapture`,
`cargo clippy -p wasm-vm-storage --test disk_root_verifier -- -D warnings`,
`cargo fmt --all --check`, `node evidence/e9-t04/verifier/run-browser-critic.mjs`,
plus read-only Python/Docker receipt/root/filesystem interrogation. The critic helper
is now called by `make verify-E9-T04`; the native test joins storage tests. Task remains
`implemented` until the one final pristine source-clone proof and receipt interrogation.
T03's unchanged findings carry forward; T05/T07 keep their declared boundaries.
