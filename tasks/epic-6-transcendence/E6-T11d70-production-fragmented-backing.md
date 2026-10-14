---
id: E6-T11d70
epic: 6
title: Admit bounded fragmented original production GPU backing
priority: 525.027049
status: verified
depends_on: [E6-T11d69b]
estimate: S
risk: high
capstone: false
---

## Boundary

The qualified production transport and retained browser resource store inherit
an old256-segment backing ceiling despite the32MiB production byte boundary.
Linux uses original page-fragmented attachments larger than256 entries. Select
one bounded16384-entry ceiling only for production, matching the pinned QEMU
mapping ceiling. Preserve every historical private profile's256-entry ceiling,
RAM address/length/padding validation, complete packet framing, byte budgets,
generation ownership and failure atomicity. Do not skip, merge or fabricate
original entries or suppress any transport error.

## Deterministic acceptance

`make verify-E6-T11d70` records native original Machine/MMIO/virtqueue requests
and actual hardware Wasm production attachment/upload/readback through the
retained store. Exercise256,257,420,16384 and16385 entries, independent literal
per-segment bytes and complete scatter/gather output guards; check original
headers, one response per request, guest traces and machine/state digests.
Check zero/excess count, truncated packet, nonzero padding, zero length,
outside-RAM/final-entry overflow, duplicate attach, and byte-budget overflow
before any partial attachment. Refused requests leave generation/state/native
owners unchanged; a later valid attachment remains usable. Private256 admits
and257 refuses; host overrides may reduce the production ceiling but cannot
raise it. Run affected format/clippy/native/Wasm gates, hardware schedules0/1/2,
ordinary built demo127/0 and one exact-head pristine clone.

## Adversarial verification

A fresh verifier authenticates the original bytes and predicts response/state
before inspecting recordings. Invent one bounded last-segment or descriptor
attack, independently vary schedules, and sabotage the production segment
selector or final-entry RAM/budget check so the recorded oracle must fail.
Carry unchanged prerequisite holds forward. Any unexplained actual guest
ATTACH or TRANSFER rejection remains a parent bring-up gap, never a whitelist.

## Verification log

Pending parent integration exposed unbacked original textures following rejected
ATTACH_BACKING requests. The fresh critic identified an earlier original420-entry
attachment rejected with0x1205 and the shared256 limit at
`control3d.rs:17/1063` and `resources.mjs:186`. Its bounded known-valid original
MMIO reproduction distinguishes count admission from malformed source entries.
The parent is not complete; old failures and original SG validity remain
preserved rather than inferred harmless.

### 2026-10-14 — worker — implementation and narrow prechecks

Select16384 only for qualified production in Rust, original control-event
normalization and the retained resource store; private ceilings remain256.
All original range/padding/packet/byte/generation checks are unchanged.
Native original MMIO tests pass0/256/257/420/16384/16385 with literal copied
segments, exact responses and full canonical state digests. Hardware precheck05
passes16 cases: full guarded GPU roundtrips at256/257/420/16384; excess/empty,
truncated packet, final padding/zero length/outside-RAM and byte-budget rejects;
post-refusal valid attachment retains generation1; private Rust and private JS
bridge256/257 boundaries; tightened host ceiling. The host cannot raise16384.
Precheck01's method-name typo, precheck02's missing bridge selector and
precheck03's wrong tightened-limit expected response are preserved negatives;
precheck05 is the final narrow passing loop, not risk-tier submission.
The critic's independent split-tail fixture is promoted separately, unchanged,
and included in the frozen acceptance before one final clean clone.
Commands/logs: `target/production-fragmented-native-precheck02.{stdout,stderr}`,
`target/evidence/production-fragmented-backing-precheck05`; `make web-dist`
passed with production sources mirrored into the committed ordinary browser.
Parent integration, actual final Omarchy, recovery and deployment remain gated.

### 2026-10-14 — worker — exact-head implemented submission

Frozen runtime/source `759e1e98af078b40cee3ce9b758befd541c9585b` passes all11
commands in `production-fragmented-backing-frozen01` and the final pristine
`production-fragmented-backing-cold01` (full-history/no-local clone, scrubbed
compiler environment, fresh builds, same11 acceptance gates). Commands:
`VIRGL_FRAGMENTED_BACKING_EVIDENCE_DIR=target/evidence/production-fragmented-backing-frozen01 make verify-E6-T11d70`;
`python3 tools/virgl-production/cold.py --task E6-T11d70 --output target/evidence/production-fragmented-backing-cold01`.
Hardware48 rows cover16 cases under schedules0/1/2; the independently promoted
split-tail rows under271828/314159 exercise the final reserved byte in a
separate original DMA descriptor. Native/libraries/transport/Wasm/clippy/fmt,
private-profile replay and ordinary demo127 passed/0 failed with no browser
errors and no proof exports all pass. Complete original SG literals, GPU
roundtrips, guards, canonical state/guest traces and ownership cleanup are
recorded. Private Rust and JS ceilings remain256; valid production16384 works
and16385 refuses; range/packet/padding/byte/budget/generation refusals are atomic.

Worker seal: `evidence/virgl-production-fragmented-backing/worker/exact-head-fragmented-backing-submission-and-cold.tar.gz`, 6970324 bytes, SHA256b4b51198c6621bf37290e8b73b5c03ce97dad078019cd1c056a0df6b371d0571, 304 members; every member was reopened and authenticated.
Parent integration, real final default Omarchy, recovery and production deployment remain outside this component claim. Fresh verifier owns the verdict.

### 2026-10-14 — independent verifier — VERDICT: verified

VERDICT: verified

- Count selection — HELD. Predicted qualified original attachments at256/257/420/16384 admit,16385 refuses, while private257 still refuses. The frozen759 native recording and all48 physical worker rows under schedules0/1/2 satisfy those responses, complete literal DMA roundtrips and guards. Native guest trace points are `critic-production-d70-native-trace01/stderr:3-8`: all retire1 with trace8fe23c7ea5165290, valid16384 state4de83ee5ed91456e4b82b30d1a97d54fa6ed88e0f20a20ec5503211e4d718819, refused16385 unchanged empty-stateaacee7a58c5a52821bd08a3528f9ac486bd9d5b6dc6256c96777628b4fda6f39. The earlier known-valid257/420 original count refusals and independent recheck remain preserved in the verifier seal; they are superseded only by this selector repair.
- Complete framing and failure atomicity — HELD. Before observing the independent split-tail runs, predicted a nonzero final reserved byte in its own readable descriptor must reject without any host attachment or canonical-state mutation, then correcting only that byte must admit and physically return every literal byte. Seeds271828/314159 hold: exact262176-byte original request, rejected0x1205, unchanged canonical digesta06ce39e86d6f92f1a2453bd41a1da6287e893a85360ee8f1e82158225ff32a0, corrected0x1100, all65536 uploaded/read-back bytes and prefix/suffix guards exact, native owners/syncs0. `critic-production-d70-split-tail-01/run-0000.json.gz` decodedSHA00aeb1e8e5d16ba8b9131695d692b86715db86a2517e6b5dff351695b823f1bf and row0001 cb952bf3e9a9aaa5d58c83716dde65a86eeeed8f06a19706456c01d135434a64 carry66,160 assertions.
- Remaining guards and private profiles — HELD. Predicted zero/excess counts, truncated packets, final padding/length/RAM-range errors and byte-budget overflow preserve attachment state; subsequent valid attachment remains generation1. Worker rows4-10 and13 hold these refusals/recovery under all3 schedules. Rows11/12 exercise original private Rust256/257, rows14/15 private JS256/257; host override16385 fails before DMA. Duplicate attachment and tightened257 refusal retain all owner/generation invariants. The complete row custody and independent decoded checks are in `critic-production-d70-final-audit01/{hot,cold}-authentication.json`.
- Independent negative control — HELD. Predicted restoring only the old256 resource-store selector in an isolated localhost-served copy must make the unchanged valid16384 original request fail the response oracle. Observed0x1205 where0x1100 is required, after the expected invalid-tail refusal; physical owners/syncs retire0 and browser errors remain empty. `critic-production-d70-negative-control01/report.json` SHA13790dc6a6a9dacc8742364196f0badc388c3a1fba13a3acbf411277054d35ac and decoded row95eef5553c94986323edf4213685da44363d8b01819400947417b85398f27a9e preserve the intended failed test. Tracked runtime remained unchanged.
- Coverage and environment — HELD. `critic-production-d70-final-audit01/coverage.json` accounts for every changed runtime hunk: both Rust selectors, resource-store ceiling and original-event normalizer execute; CDP records normalize168 calls, createBridge49 including43 production/6 private, and production store44. Scalar declarations/imports and generated outputs have explicit waivers or byte-identical mirror checks. Final resources63d718e87d54dc0683a91ccfd9e0be062b1b591716e63e9844cda322794c647b and bridgee2579dffe9831bef36e3491d86372a7d2c253b92960ec19842b9773323e0445d match the physical recordings. Full11 hot gates and full11 ordinary full-history/no-local, scrubbed-environment cold gates pass at759e1e98af078b40cee3ce9b758befd541c9585b. Cold outer reportSHAf64c0affc9e7a484ba60a6343edf8dade9190c1442b9aabb37553dcc581cb616 and acceptanceSHA cc2fc38da8087b2c5c79a4e8fc354d5057579e6c2aeb53626efc62b050d87954 authenticate149 unique files,48 worker plus2 promoted rows. Ordinary built demo127/0, errors[], proof exports absent, default Wasm6417c6f7ca8f525ce2edcca39c132eb56dd9ba02e994d886fc1e5c2cc58e13a1; unchanged private/prerequisite holds carry forward.
- Custody and suite — HELD. Independently reopened all304 worker archive members and matched all303 evidence identities to the original files and paired submission. `evidence/virgl-production-fragmented-backing/verifier/worker-authentication.json` records this final check. Independent seal `independent-original-fragmented-backing-01.tar.gz` is7411309 bytes, SHAce782122de4e512e83a3e7b7311c54ae5f031d0acc808612a72f16ce9a237c46,206 identities plus matching receipt; every member reopened. Permanent original split-descriptor tests are `tools/virgl-production/critic-fast-boots-fragmented-backing{,-browser}.mjs`, included in `make verify-E6-T11d70` and the cold gate. No unresolved hunk or criterion remains in this component.

Independent commands: original backing reproductions/rechecks recorded in `critic-production-parent-sg-*`; `node tools/virgl-production/critic-fast-boots-fragmented-backing-browser.mjs --output target/evidence/critic-production-d70-split-tail-01 --schedules 271828,314159`; isolated selector negative control recorded in `critic-production-d70-negative-control-plan01`; `cargo test -p wasm-vm-core --features virgl-renderer,virgl-control-proof,gpu-trace,trace --test production_virgl_critic original_production_fragmented_backing_counts_are_bounded_and_atomic -- --nocapture`; independent all-member/hash/diff/hot/cold/source-coverage interrogation. Evidence path prefixes in this entry are relative to `target/evidence/`, except explicit tracked `evidence/` and `tools/` paths.

Scope: this verifies bounded original production backing, exact bytes and failure atomicity. It does not infer otherwise-valid Linux SG entries from old ATTACH/TRANSFER failures, or claim the post-fix default Omarchy desktop, cursor, recovery, deployment or300MIPS. The actual old-runtime358/424-entry integration negatives remain parent evidence; parent E6-T11d and dependent E6-T11e remain unverified until their own acceptance.
