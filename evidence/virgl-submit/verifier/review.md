VERDICT: verified

Independent review of E6-T11b2. Implementation/harness frozen at
`f0f125fd0578a22ce08c4bc255ca63708c6e6566`, compared with verified B1
`3e5bf674b019d3055bc880ffeb48f8bd4d8d7102`; formal worker claim `16cdcbaa`.
The reviewer did not implement this task or edit its runtime/harness. Initial
`predictions.md` remains byte-for-byte SHA-256
`93a6ca5849a6cf6b63c61110c0f21a58dcd6e959047731036038b73f337efba8`.

## Findings and prediction disposition

Final own hardware replay: **2,859 assertions, 42 records, 290 browser-task yields**, zero console/page/request errors. Both intended source controls were caught; 19 native tests plus one focused MMIO test passed. The final evidence audit checked 635 bindings/assertions. No acceptance contradiction remains. All P01–P27 are HELD within the explicit
proof boundary. This is actual Wasm virtqueues, hardware GL, and RAM DMA; it is
not production VIRGL negotiation, a live Mesa boot, scanout, FPS or MIPS.

| Prediction | Observation and replay citation |
|---|---|
| P01, P27: feature boundary and product | Worker `hardware/report.json` → `browserResult.result.protocol` proof-off constructor checks; default-demo and live reports show 127/0, absent proof exports, and exact committed Wasm. `audit.json` independently rehashes the reports, fetched/default Wasm bindings and screenshot. Only the recorded favicon 404 is allowed. |
| P02, P03: exact wire and preflight | Own `attacks.json` records `malformed wire`, `explicit layer stride multiplication overflow rejects`, three descriptor holes, and `queue cache rebuild and response RAM rejection`; native `submit3d_wire_preflight_host_errors_and_recovery` and `submit3d_strict_outer_texture_ranges_and_unpublishable_used_ring`. Short reply leaves all sentinels; unmapped descriptors require reset before host callback. 24-byte truncated SUBMIT returns invalid-parameter. Full u64 offsets never narrow first. |
| P04, P05: admission/continuation | Own three `literal SG and owned reply` runs overwrite the admitted request/response descriptors; response still uses the captured span. `queued detach, later mutation, contexts and ID reuse` overwrites an unadmitted head and observes its new bytes. Native `submit3d_head_admission_preserves_prior_irq_and_snapshots_later_heads_late` and own 100-command run finish without another kick. |
| P06–P08: mailbox and identity | Own `100 fenced heads and destroy` uses duplicates, decreasing, high-bit and all-ones fence IDs; literal decoder checks complete 64-bit echoes. Wrong request/epoch/exchange and duplicate posts reject. Native `submit3d_owned_requests_mailbox_validation_and_immediate_completion` checks synchronous callback post and contradictory begin failure without reborrowing Machine. This begin failure differs from an exception after a later accepted complete post (see below). |
| P09, P10: readiness and publication | Own GL oracle logs native producer/fence/signal/collection events; forced waits 2/5/9 never invent readiness. Gather/scatter/pump cannot publish used; complete only posts the mailbox; next Machine run publishes. Own wrong-completion and early-readback served-source controls fail at their precise sequencing assertions. Native trace and source at `gpu/mod.rs:4899–4953` establish response → used → trace → IRQ; independent RAM oracle establishes output first. |
| P11, P12: scheduling/cursor | Own `drain()` checks native wait counts are unchanged by every Machine.run. Worker ordered queue records heartbeats/cursor trace; replayed native `submit3d_hundred_heads_ordered_with_duplicate_fences_and_cursor_progress` uses 100 heads and live cursor service. Ready completion wakes service between runs; pending work remains bounded to one. |
| P13–P16: fresh owned DMA | Three independent schedules use literal 4×4 texels, SG lengths 21+75, a split inside a dirty pixel/row, nonzero offset 18 and stride 19. Guest input changes after admission, original callbacks survive Wasm growth, and a concurrently edited unrelated byte survives partial readback. Outer and embedded transfers execute. Rejected identity/arithmetic/length exchanges neither write bytes nor advance exchange sequence. Worker original captured COPY transfers retain three literal frame hashes after every saved output reference is poisoned. |
| P17–P20: mappings and ordered lifetime | Own queued detach follows admitted upload; subsequent transfer fails for missing backing while an independent context succeeds. Recreated numeric resource ID has a fresh generation. Worker `orderedDma`, original COPY replay, stale-generation attacks, and 100 actual draws followed by context destruction interrogate attach-time backing mappings and cleanup. Worker output snapshots are observations, never initial GPU data. |
| P21, P22: revocation | Own reset and ready-away/back tests replay old callbacks after identical public-ID/ring reuse and preserve old/new RAM. Native `submit3d_reset_and_queue_rewrite_revoke_before_any_late_write` also checks DMA revocation before service; own cache-reconstruction case changes queue size while no job is pending. |
| P23: explicit failure/recovery | Own terminal callback failure rejects the next head before any callback, then reset permits valid work. Worker WAIT_FAILED and post-scatter throw/revoked-ACK controls retain successful draw prefix, post outcome 6 with gpuComplete=false, and require reset. Own Error and non-Error post-commit exceptions are explicitly observed, not claimed rolled back. |
| P24: bus effects | Own native `bulk_dma_invalidates_a_saved_middle_page_instruction` changes the next instruction of a saved cached block through a span touching six pages. For start deltas 1,17,4093, x6 becomes 11; guest digest is `5cfdaed9fdc7141cdf083d768f9974a1062eeb9e326194103eafd99842ca1401`. Endpoint, empty-write, OOB/wrap atomicity and absent-GPU errors are separately asserted. |
| P25, P26: records/sufficiency | `audit-evidence.py` independently compares eight complete native/Wasm wire/ring/control/submit records, decodes fence/context bytes and recomputes canonical digests; verifies frozen source, both final receipts, clean retained clone, live bundle and own controls. `coverage-census.json` binds precise native/V8 data to changed source; per-range dispositions below. |

### Completion commit point

`attacks.json` → `completion post then throw observation` proves the distinction:
a trusted complete wrapper first posts a valid real-GPU success and then throws.
The mailbox success is already committed, publishes exactly once, and the JS
bridge becomes poisoned (`lastFailure.completionRejected=true`). It cannot be
retracted by that later wrapper error. This agrees with the final worker claim.
Failure before acceptance (including an uncertain scatter/ACK or a contradictory
begin callback result) follows the explicit error path. No whole-job rollback is
claimed. The non-Error variant additionally exercises the bounded diagnostic text.

## Coverage against the frozen diff

`coverage-audit.py` exports LLVM 22 instrumented native coverage for the new
boundary and merges duplicate object/instantiation regions by source position.
It selects the final native and MMIO test profiles, not build-script profiles.
`native-coverage.json` contains source-level counts; `coverage-census.json` records
all added lines and remaining zero regions. V8 census combines own baseline with
worker final hardware and unchanged synchronous regression on identical source.
Sabotaged executions are excluded from positive coverage. Counts are evidence of
execution, not a claim that every compound predicate combination occurred.

| Changed area | Disposition |
|---|---|
| `control3d.rs` (34 added lines) | 27 mapped changed lines hit; seven declarations/comment/format lines waived. Attach/detach generations and canonical version bytes execute in native and Wasm. The checked u64 generation-exhaustion error at 579 is waived as bounded-counter defense (requires 2^64 successful attachments); `send(...)?` at 547 reuses the previously verified generic synchronous failure propagator, while the new successful detach/generation mutation executes. |
| `gpu/mod.rs` (306 added lines) | 221 changed lines have positive native counts; constructors/reset, pending service, admission, mailbox consumption, scatter/gather and publication execute. Own browser `queue cache rebuild and response RAM rejection` additionally executes 1594–1595 and 1674–1676 (no native hit). Remaining 68 unmapped items are attributes/imports/types/comments/braces/match syntax. |
| `gpu/mod.rs:4914–4930` | Waived post-admission invariant defense, not an untested guest path: reply spans are owned and checked in RAM at admission, RAM extent is fixed, and the complete used-ring RAM range is preflighted before admission. Queue configuration change revokes before this point. Neither safe guest bytes nor descriptor rewrites can make write_prefix/push_used fail after these checks. No MMIO/reentrant callback occurs in the response/used publication section. |
| `gpu/mod.rs:4981,4983,4997,5004,5008` | Waived absent-private-owner, allocation-failure and checked-RAM fallback arms: the pending proof constructor guarantees both owners; capped gather reserve may fail only on host allocator exhaustion; spans and output length are completely validated before the synchronous RAM loop. Braces at 621/624/4952 are nonsemantic coverage gaps. |
| `submit3d.rs` (655 lines) | 405 changed lines hit natively. Public types, constants, derives/imports/comments and braces are waived. Pending diagnostic serialization/snapshot at 209–223 and 269–286 executes in own Wasm `pending transfer canonical state` and `pending command canonical state`, including both kind lengths and SG counts; no native-hit claim is made for those ranges. Poisoned admission 496 executes in own `core poison rejects next admission and reset recovers`; missing backing 647 in own queued-detach case. |
| `submit3d.rs` checked failures | Native zero arms of header/payload reading at 534/554/564 are either exercised by own truncated header (534) or protected by Virtqueue's whole-readable-RAM preflight (554/564); own holes prove rejection before callback. Width×scale overflow 628/630 is impossible under accepted resource caps; explicit layer-stride multiplication overflow 639 is exercised by own valid-resource test. `try_reserve` failures 456/516/546 are host allocator defenses; monotonic sequence exhaustion 292/599 and queue-generation exhaustion 606 are bounded-counter defenses. |
| `submit3d.rs` invariants | Zero arms 345/379/404/409/419/522 require breaking private pending/readiness/control-membership/backing invariants: ready is checked before take, pending is checked before DMA, live context members and accepted members are immutable while parked, and backing generation validity precedes backing access. Current-poisoned-with-pending 382 is defensive (terminal poison retires the head; reset/reconfiguration revokes it). Arithmetic fallback 431 (u32×u32 into u64), 453 (≤16384 rows plus bounded SG), 466 (validated RAM SG) and 474 (end≤SG total, nonoverlapping logical rows) cannot fire from an admitted valid owner. Numeric command-match default 595 is an exhaustive defensive reject after the caller has selected exactly the three handled command types; it is not an unimplemented command. These narrow invariant/error fallbacks are waived, not represented as executed. |
| `virtio/mmio.rs` (40 added lines) | 21 mapped changed lines hit across native submission plus focused transport snapshot test. Every config write bumps generation, including same-value writes; reset and restoration execute. Nineteen unmapped declaration/attribute/pattern/braces lines are waived. No unhit executable region remains. |
| `core/lib.rs` (52), `core/mmio.rs` (14) | 45/10 mapped changed lines hit, including absent GPU errors and every code-frame write/rejection branch. Remaining lines are attributes/docs/closing syntax. New DMA changed-page behavior has independent architectural execution evidence, not just log inspection. |
| `control-bridge.mjs` (197 added lines) | Every new function and normal/failure path is source-counted except the three narrow ranges below. Fresh owners, strict envelopes, snapshots, gather/ack/scatter, real readiness, cancellation, error prefix, mappings, reset and disposal execute. |
| JS 132 `?? 5` | Waived defensive diagnostic exhaustiveness fallback: all current mappedCode outputs belong to its table, so unknown host-error code fallback is not guest-reachable behavior. It does not hide an unsupported render operation or success path. |
| JS 228 poisoned+uncancelled guard | Waived fail-closed owner-invariant check: current terminal paths either cancel retained pending work or clear it; reset clears it before rebuilding. All reachable poison/cancel paths execute; no success is being accepted under this zero-count condition. |
| JS 338 attachment-description catch | Waived private-owner invariant defense: successful synchronous attach immediately describes the same frozen resource store, with no yielding or externally supplied capability between the operations. A stale/missing generation cannot arise through the admitted guest interface. Failed ordinary attach and stale begin/DMA identities execute separately. |
| `state.mjs` one added draw diagnostic | Positive exact-source V8 coverage; worker uncertain-output controls compare the reported successful prefix to one actual executed draw. All unchanged B1 renderer/resource assertions remain HELD by unchanged source/hunk and bound dependency evidence. |

The Wasm Rust adapter is not attributed native LLVM counts. Its new hunks are
covered by actual compiled export calls and literal callback/response records:
attach/detach generation marshalling (129–153); commands and transfers, backed and
unbacked accepted resource envelopes (172–236); begin/cancel callbacks (238–253);
outcome codes 0–6, invalid code and full-width parse/exchange validation
(272–326,700–723); explicit on/off constructors and delegated RAM/MMIO/run methods
(526–620); owned gather/scatter and reentrancy rejection (621–697); pending/idle
mailbox, canonical state, counters and command/fence/cursor traces (725–860).
Fresh-object Reflect::set failure/OOM and impossible secondary GPU-borrow failure
after acquiring the private Machine borrow are narrow host-defense waivers.
No asynchronous GPU polling is performed by any Wasm run method.

Nonruntime hunks (feature declaration, Makefile, acceptance/receipt/cold scripts,
README, task metadata, ordinary generated Wasm/service-worker refresh) are
configuration/harness/documentation, audited through the final gate, exact served
hashes and clean clone. No broad ISA or unrelated workspace gate was added.

## Mock/environment hunt and permanent evidence

Own wire and dirty-row oracle imports no implementation encoder/layout code.
Own GL oracle uses real native GL calls, records actual objects and only
suppresses readiness; it never fabricates a signal. The shader bridge and raw
captured corpus remain the previously verified dependencies. Native sink controls
are deliberately transport-only; actual GPU claims cite hardware browser traces.
The original 768 literal pixels and three frame hashes are unchanged by reference
output poisoning. No skipped acceptance, hidden runtime edits or test-only product
semantics were found. The retained cold clone is still exact-head and clean;
its launcher scrubs RUST*, CARGO_* and other build/runtime overrides.

Own controls mutate only served copies. Early-readback sets the staging-ready
bit before a real fence signal; independent GL collection assertion fails.
Wrong-completion advances the internal request identity; the transport wrapper's
active-head oracle fails. Original and served source hashes and precise errors
are retained in their reports. Neither control is counted as a product failure.

Verifier harness calibration is disclosed: an initial descriptor-hole case
incorrectly waited for a command error reply. The actual queue correctly rejected
the unmapped descriptor earlier and requested reset. That failed expectation is
retained in `calibration-descriptor-holes.json`; the final test asserts the
protocol reset, unchanged used/RAM, absent callback and reset recovery. No product
code changed. Early native harness compile/API and evidence-schema adjustments
were verifier tooling work, not product failures or final proof.

SUITE: retain the independent literal wire/SG oracle, hardware replay and two
sequencing sabotage modes, three native regression tests, source coverage census
and digest audit here as replayable verifier evidence. Existing permanent
`make verify-E6-T11b2` remains the recurring full scoped gate. Compiled binaries,
profiles and Cargo target trees stay under ignored `target/`; only coverage data,
logs, source and digest receipts are committed.

## Replay commands

From repository root, with the final gate's generated proof/shader packages:

```
node evidence/virgl-submit/verifier/run-attacks.mjs
node evidence/virgl-submit/verifier/run-attacks.mjs early-readback
node evidence/virgl-submit/verifier/run-attacks.mjs wrong-completion
CARGO_TARGET_DIR=target/virgl-submit-verifier-native RUSTFLAGS='-C instrument-coverage' LLVM_PROFILE_FILE="$PWD/target/virgl-submit-verifier-native/%p-%m.profraw" cargo test --offline --manifest-path evidence/virgl-submit/verifier/native/Cargo.toml -- --nocapture --test-threads=1
CARGO_TARGET_DIR=target/virgl-submit-verifier-mmio RUSTFLAGS='-C instrument-coverage' LLVM_PROFILE_FILE="$PWD/target/virgl-submit-verifier-mmio/%p-%m.profraw" cargo test --offline -p wasm-vm-core --features virgl-control-proof,gpu-trace --lib dev::virtio::mmio::tests::transport_snapshot_round_trips_and_rejects_malformed -- --exact --nocapture
python3 evidence/virgl-submit/verifier/coverage-audit.py
python3 evidence/virgl-submit/verifier/audit-evidence.py
```

The native command replays 16 existing task/control tests plus three independent
tests; the separate MMIO command runs one focused snapshot test. `manifest.json`
binds the final verifier artifacts and commands. See `audit.json` for checked
worker/cold/live bindings and `attacks.json` for final assertion/record counts.
