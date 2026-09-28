# T03t prediction observations

Independent critic, 2026-09-15. Predictions were committed before evidence in
`predictions.md`. This ledger records the observations supporting the task
verdict, with the complete changed-hunk map in `coverage.md`.

Unless stated otherwise, `acceptance.log` means
`evidence/omarchy-profile/fp-moves-r1/acceptance.log`. Other unqualified log paths
are in this critic directory. Exact artifact SHA-256 values are pinned in
`artifact-audit.json` and the final evidence manifest.

| Prediction | Result | Observation |
| --- | --- | --- |
| P1 exact selected encoding boundary | HELD | Unsupported FP family gate passes at `acceptance.log:32`. Independent generated-module parsing finds 194 integer/control/memory instructions and no floating-point WASM operators (`independent-native.log:8`). Real browser execution reaches 3,639 JIT retirements; unchanged old production reaches only 441 and fails the same gate. |
| P2 NaN payload/sign | HELD | Exact golden f0/x31 are `0xffffffffff812345` (`independent-native.log:11`), preserving the signaling payload. All J/JN/JX variants and signed-zero/corner bit patterns are compared against a separate integer reference in the 3,840-case corpus (`:13`). |
| P3 malformed boxing/raw moves | HELD | Independent golden x7 and f31 are `0xffffffff81234567` (`independent-native.log:11`); sign injection canonicalizes malformed boxes while raw moves preserve/sign-extend their low word. The varied independent corpus also checks malformed source boxes for each sign operand. |
| P4 bank boundaries and aliases | HELD | Independent aliases include f0/x0, all-equal sources/destination, rd=rs1, rd=rs2, rs1=rs2, and f31. Every case compares all 32 raw FPRs and all 32 integer registers (`fp_moves_critic.rs:106`, `independent-native.log:13`). |
| P5 CSRs and same-value writes | HELD | Shared directed assertions require FS Dirty after same-value FPR writes and unchanged flags 9/frm 7. Read-only FMV.X.W preserves FS Clean. Independent cases cover FS 0–3 and frm 0–7, including reserved rounding encodings that these bit moves do not consult. `acceptance.log:46` and `independent-native.log:13` pin the resulting state digests. |
| P6 all first-op disabled traps | HELD | Critic corpus executes all five raw instruction variants first with FS Off: 960 disabled cases, exact raw mtval, virtual PC, zero retirement and untouched state (`independent-native.log:13`). |
| P7 precise integer prefix | HELD | Native/core receipt has only prefix 1 retired, PC `80000004`, cause 2, original raw `20209053` (`acceptance.log:43`), and x5 increments once from 41 to 42. The directed corpus separately uses virtual entries at `40000000`/`50000000` while compiled keys are in DRAM, checking relative PC construction. Direct successors retain the two-instruction root prefix. |
| P8 successor FS checks and refreshed control | HELD | Actual same-/cross-module successor calls while FS Off return retired 2, PC `80000008`, raw instruction and unchanged FP state (`acceptance.log:69`, `:85`). The incremental identity fixture changes only FS after an enabled call and observes a precise zero-retirement trap with both register versions unchanged (`identity-native.log:7`, `identity-wasm.log:28`). Every generated block has its own first-FP guard. |
| P9 FP prefix before memory fault | HELD | Native precise runloop records prefix 1, PC `80000104`, cause 5, address `deadbeec`, committed f0/FS and preserved flags/frm (`acceptance.log:44`). Inline browser same-/cross-module root FP write → successor read → fault preserves f31 and x3, leaves the unexecuted f0 destination untouched, retired 4, PC `80000010` (`:79`–`:80`). Core's unchanged precise-prefix path commits once; x5's increment is asserted once. |
| P10 interpreted FPR-only mutation | HELD | Shared handoff fixture performs an interpreted FMV.W.X between compiled FMV.X.W calls and verifies the changed FPR low bits. Incremental control checks isolate CSR refresh with no register mutation. Both native and BrowserExecutor pass (`identity-native.log:8`, `identity-wasm.log:28`). |
| P11 equal-version identity attack | HELD after test-only proof repair | The original fixture alternated numeric versions 1/2 and did not isolate the intended attack. Commit 9e89c516 adds four same-address replacements with equal numeric version, different identity/content and unchanged integer version. Both executor paths observe the replacement bits (`identity-native.log:7`, `identity-wasm.log:28`); source and log hashes are in `source-audit.md`. No runtime repair was needed. |
| P12 successor writes/high mask/budget | HELD | f31 survives both successor paths and a successor fault. Refused successors leave f0/f31 untouched and preserve FS at retired 2; enabled successors retire 6 and commit both results (`acceptance.log:69`–`:88`). |
| P13 elision/ABI/nonarchitectural metadata | HELD with scoped endian waiver | Core handoff unit asserts actual 256-byte initial copy, zero unchanged copy, dirty-mask-only commits, exact f0/f31 little-endian offsets, and span 568 (`acceptance.log:5`–`:10`). Host cache fields lie outside generated memory. FRegs equality ignores metadata; snapshot serialization reads only raw FPR words (`hart/mod.rs:268`). Big-endian execution is outside the Mac/wasm target claim, as recorded in `coverage.md`. |
| P14 independent seeds and sabotage | HELD | 3,840 cases, including 960 disabled cases, yield FNV `ba4ecacfdc4b9707` under three critic seeds. Exact golden low-bit sabotage fails at `sabotage.log:12`–`:16`, observed `...2345` versus corrupt expected `...2344`, exit 101. The clean promoted test passes locally and in the cold clone (`cold/acceptance.log:214`–`:217`). |
| P15 coverage/submission/cold | HELD with documented pre-existing wall failures | Runtime hunk map is in `coverage.md`. Pristine b4b7c70d with scrubbed Cargo/Rust environment rebuilds the same WASM and passes complete acceptance (`cold/report.json`, `cold/acceptance.log:328`). Broad gauntlet failures are recorded honestly. After builds/tests ended, B-C-C-B gives 26.0/25.7/25.8/25.4 MIPS, all above the unchanged 15 floor; critic rehashes the binaries and verifies the baseline source/dependencies (`perf-comparison.json`, `perf-baseline-source-audit.json`). Affected JIT/runtime targets pass; the stale native admission expectation is repaired in cfg(test) only and its focused gate passes (`admission-fixture.log:8`–`:10`). |
| P16 actual browser and publication | HELD | Candidate and cold actual Chrome receipts show 127/127, zero errors, matching interpreter/JIT state SHA `2292761e0dadbc7ba225714d941fed3c585352ccd3b6912882818ae22b213661`. Critic viewed suite and explicitly labeled capability-inspection screenshots. Independent TLS-verified requests fetched production/immutable WASM and roadmap with 200 and exact bytes (`public-audit.json`). |
| P17 honest physical outcome | HELD as a recorded failure | Critic reconstructs 128 trusted key transitions and 256 true keyboard/sync acknowledgements from traffic, verifies the nonce was never injected through serial, rehashes the exact R3 manifest, and audits 13 absent-file replies plus one incomplete request. Enter-to-failure is exactly 120,000ms. `artifact-audit.json` records `desktopAcceptance:false`; the screenshot has a terminal prompt without the typed command. T03q remains gated. |

## Artifact identities

- Runtime: `c7a3c38b84d462eba585c9f7081c70c88cdd2534`.
- Production/rebuilt/public WASM:
  `55557d7a158bb274d214692a76a2a876bbe56ecd7798cbc9adfcbb4bfc9a0c40`.
- Worker native full-register FNV: `dc6031f4c37c7ec3`.
- Independent full-register FNV: `ba4ecacfdc4b9707`.
- Real browser guest RAM/spill SHA:
  `2292761e0dadbc7ba225714d941fed3c585352ccd3b6912882818ae22b213661`.
- Physical run head: `6910e7952ef215463de9982d20c42fa26869cbfb`.
- Cold clone: `b4b7c70da8b28a274cfd53860a6723480deee7ff`.
- Test-only follow-ups: `3a068128`, `9e89c516`, and `ac773549`.

No desktop responsiveness success follows from these instruction/state checks.
