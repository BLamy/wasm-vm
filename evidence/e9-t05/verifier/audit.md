# E9-T05 incremental adversarial audit

Pre-cold verdict: **needs-evidence**, only for the explicitly pending final pristine
source proof and publication. The previously refuted producer-buffer boundary is
repaired. No other in-scope contradiction was found. This is not a final verified verdict.

The critic read AGENTS.md, the complete task and runtime/harness diff before opening
evidence, then recorded `predictions.md`. The repair diff was likewise read before
the repaired packet; its predictions are in `repair-predictions.md`. No production
code was edited by this verifier.

## Predictions and observations

| Prediction | Result and concrete evidence |
| --- | --- |
| P0 / R0 provenance | HELD. Original receipt `d06225f2…` authenticates 540 listed payloads, 51 compact copies/aliases and 39 sources. Repaired receipt `f503e646…` authenticates 542 listed payloads plus itself (543 originals), 51 compact copies/aliases and 42 sources. Full SHA-256 values, independent checks and raw tuple sections are in `worker-interrogation.json` and `worker-repaired-interrogation.json`. |
| P1–P2 / R3 coherent guest boundary | HELD. Independently decoded five-part envelopes and all 16 native sections agree byte-for-byte before/restored. Repaired frame SHA-256 `f558b633c4605c93b5a1770f219f6759dd1cb147f8879e271b3afe446f50b047`; pending UART is `e9_queue=queued-before\n`, held keyboard is `[30]`, cursor honestly zero. Browser `report.json` lines 431 onward records actual resumed `memory-before/queued-before`. Both before/restored and advanced filesystem bytes were independently reconstructed and read through e2fsprogs (`files-repaired-interrogation.json`). |
| P3–P5 atomic refusal, pending I/O and input | HELD. Recorded `report.json` `/checks/io` proves original read fetch, 4096-byte pending write drain, unchanged clock, 16-pass refusal and same-machine recovery. `/checks/critic/native` independently rehashes and corrupts each of 16 native components; every rejected candidate remains byte-identical. Native `checkpoint-native.log:235` records 65 malformed/missing/duplicate/unknown component refusals and `:226..259` records 32 schedules, each with 251 retired instructions and matching reference/restored traces. Core unit evidence is `core-native.log:101,247,255,286`; frame admission is `frame-native.log:5,7`. |
| P6a original ABA publication | FAILED at original runtime. `aba-browser.json` schedules 0 and 1 publish revision 2 but disagree 67/99 and 68/101 and reject admission. Original trace digest remains `43be7fa960e03858567f029e709caa2fe6b496f3b6a7e50c8661a4398455ee85`. This is preserved evidence, not overwritten by the repair. |
| R1–R2 immutable tuple repair | HELD. `web/session-checkpoints.js:75..78` bounds and owns a complete non-shared typed-array copy synchronously. Subsequent decoded slices and final object chunks share that owned copy. Repaired browser `report.json:774..839` authenticates both original ABA schedules: published roots equal the before roots, frame/root disk hashes match, 67/67 and 68/68, and admission succeeds. Fresh `repair-aba-browser.json` independently repeats the same attack. Ordinary mutation/detachment now publishes the original coherent frame; configuration remains pinned and exactly one competing append wins (`repair-browser-critic.json`). |
| P7 profile and compatibility | HELD. Raw Wasm wall-time/microphone captures reject. Promoted direct-loader descriptor/profile/topology checks reject unsupported candidates while preserving the original source, and a valid direct loader restore is paused, exact and retires zero instructions. The recorded actual worker restore also proves this after a page reload. Retained accelerated factory still qualifies, physically draws in epoch 4, and retires 3,499,616 instructions. This does not qualify accelerated session history. |
| P9 sabotage | HELD and carried forward. `sabotage.json` records isolated legacy-input routing, exit 101 at the new pre-capture ledger oracle, and unchanged production-source digest. The native implementation and dependency boundary did not change in the repair. |
| R5 final proof | NEEDS EVIDENCE. One final pristine source proof at the final promoted-test head, then exact public bytes/browser proof. Neither has been run by this critic. |

`report.json` above means the repaired original browser report at
`target/evidence/e9-t05-worker-repaired/browser/report.json`, SHA-256
`6daf02ded3c90ca09ac3017e89a6909eedb7f02c57ee8f04fe8113db57f0b846`.

## Changed-hunk sufficiency

The inventory in `hunk-inventory.json` enumerates every changed production/source
hunk from `34954a20..4ce36a93`. `coverage-blocks.json` records observed V8 function and
block counts with original UTF-16 offsets, authenticated against exact runtime source.
Main-page V8 coverage does not include worker contexts; their source routing is proven
by the actual worker RPC, reload, restored-state marker, zero-instruction capture and
exact native frame results. The added direct-loader case also exercises that same
restore path under main-page V8 coverage. We do not claim exhaustive branch coverage.

| Changed boundary | Recorded execution and narrow waivers |
| --- | --- |
| `crates/core/src/lib.rs`, every changed save/load hunk | Exact software save/load executes natively and in built Wasm with all 16 components. 65 critic refusals permute component order, remove/duplicate/truncate every component, and add an unknown tag. 32 schedules preserve delivered, queued and staged keyboard/tablet/mouse states and clock phases. Existing desktop/audio/production-GPU regression tests execute the `exact=false` legacy routes; those codec semantics were not replaced. Extra-disk/wall-time guard error returns are defensive precondition exclusions outside the admitted single-disk ICount profile; its Wasm/loader gates are directly tested. |
| Exact console codec (new module and module declaration) | Unit test records partial agent input, control suffix, output and serial queues, large counters and kick/reset flags; every truncation, invalid boolean and trailing byte refuses atomically. Actual full-machine/browser fixtures execute normal serialize/restore. Custom host budgets/counts above the fixed admitted profile are bounded configuration exclusions; allocator failure is an environment failure rather than a claimed recoverable guest behavior. Module/type declarations are waived. |
| Input exact codec/wrappers | Unit tests exercise delivered/suppressed ledgers, staged and partly delivered frames, duplicate/reversed/oversized ledgers, inner-format/version errors, all truncations, and cross-family refusal. Promoted real DMA/input schedules cover all three devices and preserve pre-capture ledgers. New error enum/string mappings are diagnostic declarations and waived. |
| Sound exact codec/wrappers | Prepared/inactive exact metadata, preserved epochs/release/timing, active output refusal and transactional restore execute in native unit/integration tests. Existing legacy audio tests execute the delegated desktop repair route. Capture-enabled/running-capture and pending-host-PCM exclusions are outside this admitted no-microphone/no-host-audio profile; the public microphone/profile exclusion is exercised. Enum/error-code declarations are waived. |
| Storage checkpoint context / module | Shared native and Node-Wasm cases execute canonical decimal u64s, bounded RAM/clock/held ledgers, unknown fields, shape/version/mode refusals and all truncations. Actual browser metadata exercises the exported Wasm parser and canonical-image function. Types, module registration and unreachable allocator failure mappings are waived. |
| Wasm constructor identity and fields | Real new chunked, persistent and seeded machines execute these assignments. Actual guest/critic captures bind the kernel, RAM, disk base/generation and profile. New fields/module declarations are waived. |
| Wasm session capture/restore/topology | Actual pending read/write, bounded failure/recovery and full browser guest execute quiescence, fetch/persist awaits and final uninterrupted borrow. Candidate restore executes exact disk-byte comparison, host queues and native commit; five component corruption cases, same-generation sibling and 16 independently rehashed native failures exercise refusal. Actual topology is compared on direct and worker restores; source/destination exact frames prove no premature mutation. Error formatting and fallible allocation failure wrappers are waived diagnostics/environment paths. |
| Pure native software-frame codec | Native frame tests execute five digests, every truncation, bounds/shape/version, trailing data, clock and native/disk cross-binding refusal, including rehashed bad clocks/disk. Browser independently rehashes bad native components and authenticates raw full tuples. Constant/type declarations and allocation-failure mapping are waived. |
| Loader admission, configuration, capture, controls | Actual reload by committed ID exercises admission, retained kernel/image, private seeded constructor, native restore, saved clock, input ledgers and paused owner. Direct-loader success plus descriptor/profile/topology refusal cover the main-page path and failed-candidate cleanup; original source capture remains exact afterward. Original I/O critic proves display/input/control/capture fences and stop ownership. V8 counts cover active controller wrappers/configuration/capture. Exception formatting and declarative allow-list names are waived. |
| Session checkpoint JavaScript | Authenticated V8 counts execute every changed hunk: decode, hashing, chunks, immutable save, append, publication and admission. Original failure plus repaired ABA provide a differential oracle for the repair. Strict asset/object store behavior is inherited from HELD E9-T03/T04; no hidden substitute store is used. Defensive size/type guard error messages are schema diagnostics; shared bounds and malformed-frame/native tests cover their admission effect. |
| Worker protocol and generated JS/Wasm exports | Recorded protocol-v4 tests exercise both new controller calls, transferred subarray results, BUSY/IDLE and heartbeat grace. Retained-v2 isolation is exercised separately and remains immutable. Generated bindings/ABI declarations delegate to the exercised implementation; native/Wasm builds and bit-identical dist checks authenticate them. |
| Build identity generator, roadmap, dist, contract and metadata | Actual browser build executes generator, compiled adapter changes, source/dist comparison and runtime digest. New roadmap pip is observed verified with 127/0 and no demo errors. Contract inventory passes. Static manifest declarations, service-worker cache stamp and task-catalog/status/log updates are waived metadata. No GitHub Actions, merge, deployment or new external service is introduced. |

No changed runtime hunk is classified dead. No remaining in-scope behavior needs a
new runtime run beyond the explicitly pending exact-head cold/public proof. Remaining
unobserved JavaScript exception blocks in `coverage-blocks.json` are either the defensive
profile/error cases noted above or catch paths whose malformed inputs reject earlier,
before constructing a machine. Their validation precedes all architectural mutation.

## Mock and environment hunt

The authoritative browser fixture is the real Alpine kernel, canonical manifest and
512 MiB raw rootfs (base SHA-256
`ebcd6b7a3569f6280f901b9697f3b8f06a11dd800b2410b540fb6bbdea8c60f8`).
The filesystem oracle reconstructs COW data on owned image copies, recovers their
journals, then reads them through a read-only Docker mount; the immutable source is
hashed again afterward. Snapshot/disk hashes are independently recomputed, not printed
by the code under test. Screenshots prove only visible demo/compatibility state.

Fixed entropy/RTC helpers in native codec tests make continuations deterministic;
they do not replace browser/native implementations and make no future entropy-replay
claim. Native trace tests execute checked-in real riscv-test ELF instructions; they
assert architectural equality rather than a golden calculated by the decoder. The
ABA one-block fixture is generated by the real seeded constructor/capture; its two
literal byte values are an independent publication oracle. No new `#[ignore]`,
disabled assertion or `cfg(test)` production semantic branch appears in the diff.

The repaired 20-gate report records a scrubbed Rust/Cargo environment and clean source
head. That is worker evidence; final pristine-clone isolation remains separately
required and pending. rr and `ssh dev` are waived/retired under AGENTS.md.
