# E9-T11 fresh verifier hunk sufficiency audit

Runtime source head 7d52129e9277468cb2d8e8cfc83571d9d7fb8334, diff base 39d2b716. This coverage audit preceded the actual-JIT finding; the final refutation and carried HELD results are in held-ledger.json and the task Verification log.

All 224 diff hunks are classified in hunk-audit.json. Instrumented fresh native runs executed 733/757 changed counted runtime lines; the24 remaining lines are explicitly waived below from safe-API/data-structure invariants. All 148 changed counted browser JavaScript lines executed in final worker/cold and the fresh production-failure recording. Enum fields, constants, type declarations, imports and generated representations do not have independent executable line counts.

Wasm source paths are tied to actual exported-method calls and concrete guest/source observations, rather than claiming Rust line coverage from JS counters. The new WasmLinux typed terminal-error projection is additionally exercised by production-failure-v2 at 115/115/observe/sequence 3. Fixed probe methods execute original and hostile replay, wrong policy/kind/length/position/tail, lifecycle controls, source failure and actual Web Crypto failure. Production direct+whole-worker captures execute real Linux-adapter policy admission, persistence and successful terminal flush/release.

## Explicit native invariant waivers

- crates/core/src/dev/virtio/rng.rs:240: Defensive failed physical write: Virtqueue::dram_ok validates the entire writable segment before service (queue.rs:224); RAM size and mapping cannot change during synchronous service. The separate invalid-DMA attack reaches pre-provider rejection, calls0/used_idx0. Ordinary streaming success executed.
- crates/core/src/session_clock.rs:280: Exhaustive pending-effect match: validate_effect rejects caller-created Observation before enqueue; decoder cannot create that variant; source adapters append observations only to delivered, never pending.
- crates/core/src/session_clock.rs:506: Defensive phase guard: successful execution resets phase to Before before yielding; any stop retaining Observe has a hub error returned at the earlier guard. Wire snapshots always decode phase Before.
- crates/core/src/session_clock.rs:556: Exhaustive delivered pending-effect match, unreachable for the same validated pending-queue invariant as line280.
- crates/core/src/session_clock/sources.rs:348: Hub error is fenced by prepare_session_transition before begin_source_scope; this synchronous Rc/RefCell core admits no concurrent mutation between those guards.
- crates/core/src/session_clock/sources.rs:351: Inactive hub branch: run_internal calls begin_source_scope only when its frozen source_capture flag is active; there is no source deactivation API during a run.
- crates/core/src/session_clock/sources.rs:358: Defensive phase guard: only a completed Before boundary reaches begin; safe execution resets phase on every advance and fences an Observe-phase failure before re-entry.
- crates/core/src/session_clock/sources.rs:415: Observation ordinal cannot reach u32::MAX: the outbox caps 256 events and the first observation resets the per-phase ordinal to 1. Overflow remains an internal defense.
- crates/core/src/session_clock/sources.rs:416: Observation ordinal cannot reach u32::MAX: the outbox caps 256 events and the first observation resets the per-phase ordinal to 1. Overflow remains an internal defense.
- crates/core/src/session_clock/sources.rs:431: Consumed observation count cannot exceed global sequence: each observation increments both once, restores enforce consumed <= sequence, and the earlier global sequence addition stops first at u64::MAX.
- crates/core/src/session_clock/sources.rs:432: Consumed observation count cannot exceed global sequence: each observation increments both once, restores enforce consumed <= sequence, and the earlier global sequence addition stops first at u64::MAX.
- crates/core/src/session_clock/sources.rs:434: The only callers are RTC (constant8) and entropy after validate_len enforces1..=1 MiB before allocation. This duplicates that admitted-adapter length invariant.
- crates/core/src/session_clock/sources.rs:435: The only callers are RTC (constant8) and entropy after validate_len enforces1..=1 MiB before allocation. This duplicates that admitted-adapter length invariant.
- crates/core/src/session_clock/sources.rs:521: Receipt order is privately constructed from the same scope/clock allocator and committed synchronously; external effects cannot forge source receipts. Public tape position/ticket exhaustion attacks execute the admitted checks before this internal defense.
- crates/core/src/session_clock/sources.rs:576: Required WallClock::now_ns compatibility shim; this private wrapper is consumed by GoldfishRtc exclusively through sample_ns. Underlying provider default-now behavior is exercised.
- crates/core/src/session_clock/sources.rs:577: Required WallClock::now_ns compatibility shim; this private wrapper is consumed by GoldfishRtc exclusively through sample_ns. Underlying provider default-now behavior is exercised.
- crates/core/src/session_clock/sources.rs:578: Required WallClock::now_ns compatibility shim; this private wrapper is consumed by GoldfishRtc exclusively through sample_ns. Underlying provider default-now behavior is exercised.
- crates/core/src/session_clock/sources.rs:579: Required WallClock::now_ns compatibility shim; this private wrapper is consumed by GoldfishRtc exclusively through sample_ns. Underlying provider default-now behavior is exercised.
- crates/core/src/session_clock/sources.rs:614: Required EntropySource::fill compatibility shim; this private wrapper is consumed by service_kicked exclusively through try_fill. Ordinary underlying fill and captured fallible fill both execute.
- crates/core/src/session_clock/sources.rs:615: Required EntropySource::fill compatibility shim; this private wrapper is consumed by service_kicked exclusively through try_fill. Ordinary underlying fill and captured fallible fill both execute.
- crates/core/src/session_clock/sources.rs:616: Required EntropySource::fill compatibility shim; this private wrapper is consumed by service_kicked exclusively through try_fill. Ordinary underlying fill and captured fallible fill both execute.
- crates/core/src/session_clock/sources.rs:736: No-clock fallback in a generic helper: admitted sources require an existing SessionClock and there is no public removal API. run_internal only calls it for active capture.
- crates/core/src/session_clock/sources.rs:737: No-clock fallback in a generic helper: admitted sources require an existing SessionClock and there is no public removal API. run_internal only calls it for active capture.
- crates/core/src/session_clock/sources.rs:739: No-clock fallback in a generic helper: admitted sources require an existing SessionClock and there is no public removal API. run_internal only calls it for active capture.

## Harness and environment audit

No ignored tests, disabled debug assertions or new unsafe blocks were added. No live provider is replaced by a fixture in the browser success proof: it uses JsWallClock/CryptoEntropy, and real crypto.getRandomValues failure is separately injected and restored. Native provider arithmetic supplies external input only; independent Python reconstructs actual guest RAM/DMA/RTC/WFI state, so it does not derive guest expected state by invoking emulator code.

Cold origin is independently inspected in cold-origin-audit.json: clean detached source at H, no Git alternates, no compiler/node_modules copy, explicit empty target and environment scrub. Both final report artifact indexes and source digests authenticate in worker-authentication.json and cold-authentication.json. Immutable Git hardlinks do not share compiler output or checkout files.

Two verifier setup corrections are retained and are not task findings: the initial invalid-DMA helper expectation was corrected after the pre-existing virtqueue rejected it before provider service; the initial standalone browser server omitted .mjs MIME and failed before product execution. The final corrected attack transcripts pass without runtime edits.
