# E5.5-T03u coverage review

Runtime freeze: `7048847fb542d66618b836b965b94c8c9db771d5`.
Comparison base: activation `9a963954`.
Final coverage audited against worker submission `f95c9dac` and its sealed
54-file index. Every runtime hunk below is exercised; only comments,
declarations, metadata and generated packaging receive the listed waivers.

| Changed boundary | Required direct execution or waiver |
| --- | --- |
| `block_register_masks` FP memory cases | Same-module worker successors; critic FSW/FLW with x5/f5 aliases and f31/x31 |
| Generalized first-FP guard and supported set | All four instructions plus fetched compressed parcels, FS=Off and enabled, prefix and exact original mtval |
| FLW/FLD emission | Native/private/shared raw-bit goldens, load fault leaves FS and destination intact; actual shared cold/warm path counters |
| Integer load destination split into value loader | Existing differential integer loads and combined browser worker readback; all prior integer load semantics stay in that common function |
| Integer store source enum | Existing differential native integer stores plus independent narrow-PMP integer controls |
| FSW/FSD source enum | Malformed-box store goldens, same-index source/base alias, interpreter-to-generated replacement, shared commit log saturation |
| Shared value-loader hit/miss joins | Sv39 worker path counters; shared warm accesses add zero software translations while private controls add one |
| Store import/inline/loads-only dispatch | Existing translator differential suite for loads-only configuration; task tests cover production private/imported and shared/inline configurations |
| `jit_can_inline_ram_page` | Positive full-page hits, NA4 grant / adjacent denial, interior denied NAPOT range, locked M and MPRV effective S, partial RAM page, armed data trigger |
| Browser load refill eligibility | Same authority matrix; no new memory import and no changed read value |
| Browser store refill eligibility | Same authority matrix; existing code-write/reservation records after successful store, direct-chain barriers and saturated log |
| Unsupported floating arithmetic list | `differential::fp_ops_are_unsupported` retains arithmetic/comparison/conversion refusal; deleted transfer cases now have positive execution coverage |
| Makefile and new tests | Direct acceptance command and targeted verifier runs, with a flipped expected payload in an isolated test copy |
| Policy documentation and roadmap metadata | Declarative waiver; inspect the descriptions, then verify live pips from the full browser suite |
| Generated `web/dist` files | Packaging waiver at source level; exact wasm and screenshot hashes plus built-page and deployed-artifact evidence |

## Built-page inspection at runtime freeze

The verifier inspected the actual `suite.png`, `built-page.png`, and
`capability-inspection.png`. The suite image reads 127 total, 127 passed, zero
failed, and 127 done. The capability image reads `2/2 passing · live in browser`.
The latter is explicitly labeled as an inspection of the existing hidden legacy
capability container. It does not stand in for a visible desktop response.

The browser report identifies the runtime freeze and wasm
`1f989758c67c9dfdf514d2e03c0e4fa2cadb15a2dc0a465f5cb538661446473b`.
Both interpreter and compiled runs report 4,000 retired instructions; the
compiled path attributes 3,617 to JIT execution. `stateDigest()` is a RAM-only
SHA-256, so the browser harness also compares the full exposed integer register
array, trap statistics, spilled FPR payloads, and spilled fcsr. Direct native and
wasm Rust tests separately check all FPRs and FS. No claim of a full-state digest
is inferred from the RAM hash.

## Unchanged boundary carried forward

T03t's FPR transport identity/version and generation-aware browser view refresh
are unchanged. The new FP memory tests directly exercise their newly written
FPR source/destination use, and the independent memory-growth fixture exercises
the real import boundary with one memory.grow and exact success/fault prefixes.
Prior T03t results are not rerun solely because a new verifier session began.

## Independent results

The initial native verifier target passed 112 directed cases. The private and
shared browser verifier targets passed the same 224 cases; the six actual
memory-growth outcomes passed in two additional browser tests. Logs are
`native.log` and `wasm.log`. V1, V2, V3, V5 and V6 held.

Review found that V4 initially changed FS together with MPRV. Commit `a593f942`
corrects only that test: the warm and checked access now keep FS identical, so
the permission decision must follow the effective privilege change. V4 held in
the final recorded native/private/shared acceptance at `a593f942`
(`fp-memory-r1/acceptance.log:28–38,129–136`), and again in the pristine clone.
This is a test isolation repair, not a refutation of runtime behavior.

The isolated sabotage check changes one expected payload bit in the critic's
seeded test. `sabotage.log:30` reports the exact named assertion with unequal
values `18446744072205303053` and `18446744072205303052`; the test exits 101.
Runtime hashes before/after match. The tested seed function is byte-identical
in the corrected final fixture apart from the deliberate expected-bit change.

`audit-recordings.py` independently rehashes the frozen runtime, WASM, ELF,
three built-page screenshots, physical failure screenshot, and all physical
trial helpers. Its receipt is `recordings-audit.json`. The 128 keyboard events
are trusted; the nonce remains unverified at the original 120,000 ms deadline.
The failure screenshot visibly shows only the unchanged Foot terminal prompt.

## Final source and product proof

The worker's complete 54-file index rehashes to
`1edaa4b1b6d39474962e082ff4255f68b407e5cf55fa52194c28886027e4b822`.
The pristine clone starts clean at `a593f942`, scrubs the specified Rust/Cargo
environment variables, rebuilds byte-identical WASM, and passes all acceptance
commands. The verifier inspected and rehashed its actual suite capture as well
as the original built-page and physical captures. Both immutable Cloudflare
deployment and production receipts report HTTP 200 and matching WASM, glue,
roadmap and app bytes; their TLS-verifying check script was inspected.

The full local gauntlet remains red for the recorded unchanged platform,
feature and fixture failures. The exact affected Clippy, core memory,
translator, runtime, FP ISA, wasm library, no-host-float and task acceptance
checks passed; the unchanged lexical test-clock scan remains an explicit
exception. Existing ignored stress campaigns are not counted as evidence.
No new runtime claim is inferred from those exceptions or the failed desktop
trial. T03q remains gated on real responsiveness.
