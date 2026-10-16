# Source-bound coverage review

Runtime reviewed: `ab5f3a85cbf25dd151b6ae74904dd5e1fc793820..f1aeb2538d1fda62eef7c127925ac043973f8f4a`.
Receipt-only repair: `fbceeb4d07f1afe24e9e99a01db8b19e181cdd3e`.
`coverage-census.json` gives added-line counts, original source hashes, native objects/profiles and every remaining V8 zero range. No runtime was edited by this verifier.

## Executed changed behavior

- `resources.mjs`: every changed executable V8 range is covered by final worker hardware plus the independent run. Global lease identity, unsupported target, quota, dedicated snapshot ownership, actual PBO collection and retained cleanup are exercised. Independent snapshot A survives a real upload B while the ordinary mutable-storage ticket fails `stale-storage`.
- `scanout.mjs`: normalizers, all binding kinds, stale identity/metadata, global lookup, new public-unref rejection, capture/cancel before and after issue, conversion, enqueue rejection, ready/queued/retired ownership, rebind/reset/dispose, 2D copy, failed synchronous and Promise/throwing trusted capabilities are executed. The independent 260-frame run executes diagnostic retirement eviction. Remaining private guards are classified below.
- `virgl-scanout-presenter.js`: the served **built** module is byte-identical to source. Actual Canvas2D and worker WebGL2 presentation, queued versus drawn, supersession/cancellation, stale callbacks, asynchronous scheduling rejection, ownership copies, no-draw/throwing backend failures, context-loss fallback and recovery invalidation execute. The independent callback-throw loop executes bounded error eviction and reentrant-dispose rejection. Three served-source mutations establish oracle sensitivity, including bypassed scheduler-token validation.
- `control-bridge.mjs`: both old factories run in the final same-source control/submission regression, while the new factory, event routing, synchronous frame callback, scanout pump/cancel/reset/disposal and uncertain failure paths run in the scanout corpus. The independent non-Error completion exception and asynchronous/throwing enqueue controls prove failure/poison/reset. Prior B2 completion-commit rules remain unchanged.
- Core `scanout3d.rs`, `mod.rs`, `submit3d.rs`, `lib.rs`: LLVM profiles bind the 6 new native acceptance tests and 9 prior submission tests, plus 2 independent tests. Global namespace, strict preflight, failure-atomic binding, exact mailbox authority, ordered completion and reset/reconfiguration are exercised. Own legacy trait-default tests require both new methods to return `Unspecified`; own pending-canonical tests distinguish context-free from context-bearing authority with literal offsets and full fence bytes.
- Native census zero lines `scanout3d.rs:203,264,340` execute in the independent **Wasm** path: proof-created GPU without negotiated VIRGL, invalid ordinary-2D binding rectangle, and header-only FLUSH respectively. Each exact literal request has its expected full response/used assertion. These are cross-target executed cases, not waivers.
- Native census `submit3d.rs:274,280–282` executes in the independent Wasm setup: pending outer transfer (`context.id=2`, byte length 72) and pending empty command (`context.id=2`, length 0) snapshots before pumping. Pending scanout remains context-free; the new native canonical test covers both encodings.
- Wasm child: explicit constructor/proof-off branch, all three target encodings, owned event serialization, synchronous borrowed 2D frame callback, real RAM/MMIO/run/gather/complete, state/digest/trace and diagnostics execute in final hardware/native parity and independent runs. The independent rejected 2D callback reaches `FrameDiagnostics.rejected/lastError`; a callback attempts `scanoutState` during a Machine borrow and is rejected. Existing gather/scatter and B2 delegate behavior carries forward through exact-source regression. Owned event helpers and strict callback-result interpretation are the unchanged T11a/B2 implementations, not new copy logic.

## Narrow waivers

These are private invariant backstops or trusted-host/platform error diagnostics, not unused semantic fallback features. The supported runtime has no input route to manufacture their conditions. Nearby ordinary failure routes execute and remain asserted.

| Exact source range | Classification and reason |
|---|---|
| `gpu/mod.rs:1903–1905` | Defensive response-write failure after full writable-RAM preflight. The admitted descriptor chain is owned, RAM extent is fixed, and synchronous host callbacks cannot mutate borrowed Machine memory. Invalid writable descriptors reject before host mutation; no valid request can make this post-preflight write fail. |
| `control-bridge.mjs:184` fallback code/message | Diagnostic fallback for a malformed result from the private `createRetainedScanout` API. Its wrapper always constructs a code and message. Throwing external capabilities already execute and poison; omitting private error fields requires changing trusted implementation. |
| `control-bridge.mjs:191` reset catch | Defensive aggregation if the trusted presenter reset or store lease release throws/rejects during teardown. Native cancellation and private lease release do not throw for owned live values. Ordinary reset/disposal, failed binding and active-capture reset execute; this is not a second recovery path or proof of hardware completion. |
| `scanout.mjs:54` fallback message | Diagnostic fallback for malformed trusted dependency error; real store/presenter structured errors always contain messages. |
| `scanout.mjs:83` duplicate retirement | Private exactly-once backstop. Presenter clears pending entries and scheduler tokens before callbacks, and each entry settles once. Public duplicate/stale scheduler callbacks execute and do not reach this guard. |
| `scanout.mjs:91` retirement catch | Defensive handler for a trusted backend deletion exception or externally revoked private ticket. Real WebGL deletion accepts loss/deletion, the opaque ticket never escapes, and native PBO retirement is covered. |
| `scanout.mjs:106` old-binding release catch | Private live-lease invariant; only the engine owns this lease, and release is called once. Quota/new-lease rollback and presenter rebind failure execute. Reaching this catch requires host corruption of the private lease registry or a substituted throwing GL deletion capability. |
| `scanout.mjs:159` repeated private dispose | Idempotence backstop behind the bridge's already-executed public disposal guard; the engine itself is not exposed by the bridge. |
| Presenter `51,62,65` | Duplicate settlement, active-token-with-no-entry, and current-token/wrong-generation backstops. Every rebind clears/cancels the scheduler token before publishing its generation. Real stale callbacks and generation rejection execute; a served-source token omission demonstrably lets an old callback prematurely draw pending 2D and is caught. These guards do not define a dormant presentation mode. |
| Presenter `77` outer delivery catch | Host/OOM backstop outside the established controller, whose supported backend exceptions are caught inside `present` and reported as `failed`. The actual no-draw/throw backend cases execute with separately correlated failed outcomes. |
| Presenter `84` non-Fault/non-Error diagnostic fallback | Requires throwing native scheduler/readback or reflective trusted options; normal invalid frame/options produce structured Faults. No guest supplies these capabilities. |
| Presenter `122–123` disposal catch | Native `cancelAnimationFrame`/controller cleanup exception backstop. Native cancellation/deletion of issued handles does not throw; queued-frame disposal and callback exceptions execute. No claim of cleanup after arbitrary replacement host API throws is made. |
| Presenter `127` optional controller disposal/non-Error constructor text | Constructor failure before assignment leaves controller undefined; after successful assignment the remaining closure/API construction has no fallible browser operation. Only host allocation failure/prototype sabotage can take this diagnostic branch. Invalid real canvas/options and constructor rejection execute. |
| Rust/Wasm unmapped lines | Imports, derives, public data fields, enum declarations, delimiters, type signatures and cfg/export annotations have no executable counter; build/Clippy and explicit proof/default-module checks cover their configuration role. |
| Wasm allocation/reflection/borrow error propagation and no-op `ProofFrameSink.clear` | Fresh JS Objects receive known primitive fields; throwing property writes need OOM or replaced JS intrinsics. Fixed 4 MiB constructor has free device slots and valid seeded RAM. Reentrant Machine guard is exercised; exclusive private diagnostic borrow cannot reenter while serializing primitives. Proof snapshot restoration is refused by carried T11a guards; reset uses typed control teardown, so `clear` intentionally has no presentation action. |

## Other changed hunks

- Make target, shell gate, source lists and cold launcher: executed in worker and final repaired-head cold gate; logs bind commands and absence of ignored/failed normal tests. Legacy manifests include the new static module imports.
- New native/browser acceptance and recorder: independent source/evidence audit checks literal wire/record parity and actual served sources. Fixtures are captured raw submissions or explicit literals; runtime conversion helpers do not compute the oracle.
- Desktop runner: actual built `desktop.html`, default Wasm, authenticated image/manifest/kernel and each served content-addressed disk chunk are rehashed. Single fresh boot, no injected serial input, actual retired instructions and independently viewed wallpaper/panel/terminal capture establish 2D execution. The existing guest foot configuration warning is visible; no new browser application error is hidden.
- Receipt repair: only `scanout-receipt.py` differs between recording and final validator heads. Streaming SHA-256 substitutes for unavailable Python 3.9 `hashlib.file_digest`. Revalidation permits exactly that one path, binds the old validator bytes to the original recording, binds the executed validator to the repair commit, and verifies nested regression records. The final successful cold clone runs the repaired gate normally, without repair mode; the earlier failed clone is separately retained.
- Roadmap/built Wasm/service worker: ordinary local and live demo checks assert 127/127, all three proof exports absent, exact fetched Wasm hash and an honest partial/production-disabled graphics label. Generated distribution and declarative status text are not separate guest behavior.
- Task/frontmatter/queue/readme and source-manifest changes: declarative scope/configuration, inspected against the task's bounded profile. No live Mesa, FPS, zero-copy, production 3D or physical-display-completion claim is inferred.

No acceptance path is waived merely because the verifier failed to drive it. The remaining waivers are restricted to the listed diagnostic/invariant conditions; they do not claim safe behavior for arbitrary malicious trusted-host capabilities.

## Final desktop harness correction

`fbceeb4d..85962c49` changes only the test server's immutable kernel cache header
and passive network diagnostics, plus the bounded diagnostic recording. It does
not change any runtime, worker acceptance test, built release or guest fixture.
`audit-network.py` rehashes the exact production fetch function and checks all 12
consumer/server/terminal identities: every consumer gets the full kernel digest;
4 no-store cases (including 2 workers) report ERR_ABORTED, while no-cache has none.
The final cold proof runs separately at the new harness head. No request-error
allowlist or filtering was added. Every error still fails the gate. The original
failed cold run and its setup/environment evidence remain available.
