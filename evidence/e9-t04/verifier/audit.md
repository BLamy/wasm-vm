VERDICT: verified

# E9-T04 fresh verifier audit

P0–P9 HELD. Final test/recording head `0db63b02fc3cdef4ed188a53d03fddfc340b454f`;
product/runtime remains `b5baad0a4b1cddcbd08299b438292258352b2c08`.
Predictions were written in `predictions.md` before opening worker evidence. Base
`7918fbe0`, frozen product `b5baad0a4b1cddcbd08299b438292258352b2c08`, worker
submission `40113a6fb98d279905fba30de7219a3780f8747f`. The critic changed only tests,
recording assertions and evidence. T03's unchanged P1–P9 findings carry forward.

## Acceptance and falsification

- **P0 HELD.** The original receipt hashes to
  `1e2577042ba20e4ed3bd63fe0eb77efbd41371be85255689112ce40c39366efd`.
  All 515 original files, all 51 compact copies, every inventoried source against
  b5baad0a, and the 512 MiB pinned base authenticate (`provenance.json`). No newly
  ignored test, disabled debug assertion or panic in the changed product code.
- **P1 HELD.** Independent Python WVOD decoding and SHA-256 reconstruct each canonical
  root exactly. Read-only Docker debugfs re-reads the worker's journal-recovered owned
  images: before `65393a6265666f72650a`, after `65393a61667465720a`, fork
  `65393a666f726b0a`, live `65393a6c6976650a`. See `independent-files.json`; the original
  four `.file` witnesses are each line 1. Reverse-order actual guest reads are at
  `worker/browser/report.json:439` and `:444`, with full UART/fenced RPC transcripts.
  The oracle uses independent e2fsprogs; it does not ask the emulator to read itself.
- **P2 HELD.** All four independent delta decodes locate their exact distinct bytes
  at physical block 33281. Older-again delta equals the original capture, and all
  durable live block/meta rows remain byte-identical (8591 bytes). Generations are
  before=54, after=73, live=87, fork=54; equal generations do not alias root hashes.
  Recorded capture instruction counts do not change (`report.json:20`, `:160`, `:454`).
  The worker's actual held first-put Promise spans subsequent actual guest writes;
  it wraps the real writer and does not replace IndexedDB operations.
- **P3 HELD.** Native/shared-Wasm tests refuse foreign content, length, rechunking and
  generation before any loader call (`storage-native.log:114`, shared-Wasm log:8).
  Browser refusals (`report.json:1039`) cover detached/mutated/released producers,
  malformed WVOD, missing/corrupt descendants, conflicting lengths and metadata bound.
  The critic additionally exercises every new loader descriptor guard and actual
  running/concurrent/stopped-owner capture refusal (`browser-critic.json`, `checks.guards`).
- **P4 HELD.** The independent union check finds all 35 surviving parent references
  within the 61-reference parent+child union. Parent metadata plus every block is
  present after strict child session-row deletion, and reauthentication succeeds
  (`report.json:637`, `independent-files.json`). Placeholder machine pins in that
  storage-format fixture are explicit and prove no coherent checkpoint tuple.
- **P5 HELD.** Built browser reports 127/0, verified disk pip and no errors. All 47
  retained factory files and bootstrap equal the verified T03 base byte-for-byte.
  The real factory boots via its retained v2 client against current v3 host, retires
  2,999,712 instructions and physically draws in fresh epoch 4 (`report.json:1117`,
  `:25554`; screenshot `gpu-factory-ready.png`). This is compatibility only.
- **P6 HELD.** See per-hunk disposition below. The additional genuine native browser
  machine starts with original chunk 0 pending. Capture fetches 131072 authenticated
  bytes, clears the original read, and leaves icount mtime 49845501 unchanged. A later
  original WritePending has 4096 pending bytes; capture drains them, advances durable
  generation 0→1 and leaves mtime 121885522 unchanged. Nonchunked capture refuses.
  An isolated page supplies a bad HTTP-200 chunk: capture refuses with
  `session_disk_busy_or_budget` after exactly 16 matching backend error receipts;
  its clock stays unchanged (`browser-critic.json`, `checks.io`).
- **P7 HELD.** New permanent native test executes 64 independent schedules across
  four LCG seeds, u64::MAX generation, equal-generation siblings, repeated-content
  block sharing and a one-byte final image block. It checks exact independently
  chosen bytes after reverse ownership/mutation and child-exclusive object removal,
  and zero loads for bad base/generation (`novel-native.log`).
- **P8 HELD.** A temporary test-only mutant overwrites owned block 2 with sibling
  bytes before the independent oracle. It fails at seed 91d3/round 0/block 2, exit
  101; original test passes. `sabotage.json` binds both source hashes; the temporary
  file was deleted, and no implementation was mutated.
- **P9 HELD.** The one pristine source clone at permanent-test head `25e65f56`
  passed 15 non-browser gates. Its full browser run and a same-source retry held every
  disk/critic/filesystem assertion but failed the retained GPU fetch with the unused
  export route still installed. A controlled same-origin toggle failed with the route
  and succeeded after removing only it. This was a harness/environment finding, not
  an established transient network failure. The test-only `0db63b02` unroutes after
  the final export and records/asserts the complete boot result. Its full browser
  acceptance passed in the same clean owned clone with a fresh external profile and
  the original scrubbed environment. All 499 final files and 30 inventoried sources
  authenticate; only the browser driver changed from the initial native proof.
  The original 15 gates therefore carry forward under incremental policy. Exact
  detached heads, no alternates/initial target or npm caches, clone-local Cargo targets,
  all source/config inputs and outside-clone output were independently checked.
  Final browser: 127/0, errors=[], all critic paths, four exact ext4 files and genuine
  inode block maps at 33281, 38 surviving references within 61 union references,
  and 2,499,808 actual factory instructions plus a fresh epoch-4 physical draw.
  `cold-verification.json` binds both original and final receipts. Original failures
  remain intact and are explicitly linked, rather than rewritten as successful runs.

## Changed product hunk coverage

Offsets below are the new-side diff against 7918fbe0. A function witness means an
actual call/return with its effects or failure asserted; it is not a claim that page
coverage measures worker Rust instructions. Page coverage did **not** cover worker
loader execution, so the critic added direct real loader and native-I/O runs.

| Changed hunk | Execution evidence / disposition |
| --- | --- |
| storage/disk_root.rs:1–223 | All public methods exercised by 8 native + 8 shared Node-Wasm cases; canonical golden, schema/bounds, exact identities, private reverse restores, leaf failure, conflict marking and 32 worker schedules. Critic adds 64 independent schedules and sabotage. Browser Rust codec exercises validate/admit/reference adapters. |
| storage/lib.rs:23 | Module declaration: compile/config waived; no independent behavior. |
| storage/overlay.rs:83–88 | Unsupported backend test invokes default refusal. |
| storage/overlay.rs:131–138 | Memory capture empty/bound/exact-owned-copy cases and 32 schedules, plus critic test. |
| storage/overlay.rs:156–168 | Complete generic snapshot exercised on memory and actual WriteBackOverlay; unsupported backend refuses; b5baad0a native persistent checkpoint case authenticates returned bytes. Type generalization itself waived. |
| storage/writeback.rs:219–231 | Native/shared test: empty, pending durability, borrowed queue, over-bound, committed owned copy, later write stability. Actual browser pending write additionally drained. |
| session-web/lib.rs:4,8–24 | Import/wasm attributes waived as declarations. All three adapters called by actual browser inspect/verify/restore and refusal cases; exact bytes validated against independent Python root construction. |
| wasm/chunked.rs:284–318 | Real generic persistent handle snapshot through trait object and clone; native `checkpoint_persistent_disk_refuses_uncommitted_and_unacknowledged_writes` (`boundary-native.log:14`) plus actual browser persistent/ephemeral captures. Trait/type/Clone plumbing waived as declarations except their called implementations. |
| wasm/chunked.rs:322–324 | Native writer/read-only flag changes and rejection asserted; actual persistent guest uses wrapper. |
| wasm/lib.rs:252–253,2236–2237,2891 | cfg/module/field/type declarations waived; both native and affected wasm feature builds pass. |
| wasm/lib.rs:2916,2943,3023–3024 | Ordinary ephemeral, private seeded and persistent constructors all execute in recorded real browser machines; returned roots have asserted full write sets. |
| wasm/session_disk.rs:1–42 | Actual direct native pending-read, pending-write, success, unsupported and 16-pass failure witnesses in critic run. Actual worker captures exercise lifecycle/RPC ownership, exact native generation and owned transfer. Comments/wasm attribute waived. `try_borrow` reentrancy guard is defensive failure propagation, not an alternate disk behavior. The generic non-NotQuiesced arm is unreachable for current `Machine::quiesce` (only Ok/NotQuiesced), and is waived for exhaustive error propagation. |
| web/session-disk-roots.js:1–129 | Precise worker page coverage: capture=12, inspect=29, verify=8, restore=11, liveReferences=5; positive and refusal outcomes are separately asserted. All metadata construction/hash/read loops execute. Empty/all-shared maps, invalid lengths/order/version and exact generations additionally exercised in Rust/shared-Wasm; the 4 GiB union/12 MiB metadata constants are declarative defensive budgets, not a measured performance claim. |
| web/session-store.js:140–143 | Getter=30 recorded calls; existing root descriptor/authentication path carries T03 findings; new getter closed-store failure explicitly exercised. |
| web/loader.js:210–212 | Option default/comment waived as declaration. |
| web/loader.js:362–370 | Six malformed + six incompatible descriptors in critic helper hit both throw paths, before constructing any replacement machine. |
| web/loader.js:546–555 | Worker actual private seeded cold boots after/before; critic missing root hits close-in-finally refusal before native construction. |
| web/loader.js:1253–1265,1419 | Actual real loader success + running/concurrent/stopped/stop-after-admission races. Critic page precise coverage function count 5 with both guard paths; actual worker captures carry ownership and returned-byte assertions. |
| web/linux-worker-host.js:29–34,69 | Real retained factory and three current guest workers; precise page coverage shows retained selection=1/current=3. Independent protocol test asserts only v2 frames and no new API exposure for retained client. |
| web/linux-worker-protocol.js:7,21,52,114 | Version/allow-list/grace/result declarations waived as metadata, with native protocol test asserting capture bytes, BUSY/IDLE, retained v2 pairing and real browser RPC capture. |

The remaining diff is tests/recording scripts, design contract inventory, docs, queue,
roadmap/task metadata, published pinned-image manifest/fixture, base publication receipts,
worker evidence, generated build ID, and generated dist. Test assertions execute in the
prescribed local gauntlet. Design inventory hashes match the frozen source; the base
manifest is authenticated against every pinned raw-image chunk. Roadmap is directly
asserted in the built page. Generated Wasm and JavaScript bundles were bit-identical to
`make web-build` outputs in the worker final proof and will be rebuilt in the final cold
proof. Source/dist pairs match. Generated declarations and cache version are waived as
ABI/build metadata; the real browser and GPU compatibility boot use the generated code.
No unexercised alternate feature or claimed disk behavior is silently waived.

## Environment/fixture hunt and incremental suite

No cfg(test) semantic fork was added. The golden canonical root uses external fixed
bytes and a fixed digest; the new fill-byte oracle is chosen before root production.
The real guest writes its ext4 file over UART; e2fsprogs reconstructs/reads owned image
copies independently. Shared immutable source chunks are each hash-checked. The COW
snapshots and private boots use actual native disk backends rather than mirrored writes.
Native and shared-Wasm runs execute 32 deterministic worker schedules; the new 64
schedule cases use a different generator. No host rr is required by the September waiver.

The initial extended critic runner reached all native I/O assertions but its broad
zero-console check saw the **intentional** corrupt-chunk errors. `io-first-harness.log`
is preserved. The permanent helper confines that negative test to a separate real page
and asserts all 16 exact messages plus no page errors; it does not loosen or filter the
demo's zero-console-error gate. The corrected narrow run passed. No product code changed.

Permanent suite deposit: `crates/storage/tests/disk_root_verifier.rs` runs with storage
native tests; `tools/verify/e9-disk-roots-critic.mjs` is called by `make verify-E9-T04`'s
built-browser driver. Narrow test format/clippy and browser assertions pass. The final
cold proof and scoped harness correction have been independently verified; no product
contradiction or remaining in-scope proof gap was found. T05 owns coherent
CPU/RAM/device/input/clock/log tuples; T07 owns atomic session deletion/reclamation.


## Final proof receipts

Final browser receipt SHA-256:
`5d27531082fa9c7881211bfd0534386fe0c1ea3f06e1e9b55fe353fbe3ffcd00`.
Final browser report SHA-256:
`d054a6eb3a92d8725fd3dce3ff27effd6254f55fa37ba22095bca85ab45a1e97`.
Original cold receipt SHA-256:
`f0be284c3aa1c9824352c0f4103299ffbf551f442238eb107fc799abf9cdb8b0`.
Original cold acceptance SHA-256:
`7e6587476f1f9192744b2821d569e6349e93dd15ae0af838b85d0bdbe903953d`.

Original full cold trace/profile/images, failed repeat and causal-toggle trace remain
in their authenticated target paths. Compact cold evidence is in `cold/`. No product
or test changes follow the final proven head; the verdict commit is metadata/evidence.
