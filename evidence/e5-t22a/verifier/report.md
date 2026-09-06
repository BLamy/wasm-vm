VERDICT: verified

Fresh verifier, 2026-09-06. Task E5-T22a; diff af6b4bf4..179b8fd04e716a24a7b15091b3f7b0de0a356dfb;
runtime 8c3f4e14477292d329783d0eee7451a63d0644fe; final handoff cab17ae7.
Predictions were written before evidence inspection in predictions.md. No
implementation files were edited. Scope is the host hotplug boundary only.

- P1 HELD. Invalid values in both argument positions reject atomically; 1 and
  4095 succeed with matching EDID. acceptance.log:808-809 executes exact
  assertions in crates/wasm/src/display_tests.rs:33-89; browser-proof.json has
  32 rejections per backend. audit-final.mjs independently decodes all 2,006
  EDID samples and checks checksums against independently computed dimensions.
- P2 HELD. The 1,000-update test passes at acceptance.log:812; its assertions
  at display_tests.rs:115-137 verify final 750x531 versus unchanged resource
  17 at 7x5/140 bytes, one resource and identical pixels, then zero accounting
  and null scanout after removal. The stdout at line 811 is AFTER removal,
  not the evidence for old-resource retention; the executed assertions are.
  Unchanged T04 coalescing tests pass at acceptance.log:90-93. The core diff
  only adds the non-mutating events_read getter.
- P3 HELD. acceptance.log:819-822 executes both APIs under mutable inner and
  GPU borrows, then absent-GPU false/null (display_tests.rs:140-156). No panic
  occurs. C3 independently forces the stats-property error branch, restores
  Reflect.set and confirms usable identical stats (coverage-result.json).
- P4 HELD. browser-proof.json observations[0]/[1] come from actual direct and
  module-worker controllers; each performs 1,003 updates/32 rejections, finishes
  750x531 with zero allocations and null scanout, and rejects mutation after
  stop. acceptance.log:859 summarizes the run. C2 covers active wvmDemo
  forwarding at 997x613 and equality with its actual paused controller;
  final acceptance also proves pre-boot false/null.
- P5 HELD. acceptance.log:816 records instruction 0x1002a503 at PC 0x80200004
  reading 0x10008100 and writing x10=1. Line 817 digest is
  79535a41dc7da0934c91fc17c441210501714ba5b1d52fc243491a659676696e.
  The preceding LUI independently explains the MMIO address. Whole log SHA-256
  is 410f8b337c5f2ddf76cd40da7e5318565a0ddf3b3fd2c4bc200ecebf243a4fae.
- P6 HELD. Both final screenshots were visually inspected and hash-checked:
  diagnostic explicitly says host-only/paused fixture and separates 1367x901
  from null scanout; demo displays 126 passed/0 failed. JSON errors=[];
  roadmap task description makes no compositor adoption claim.
- P7 HELD for scoped exact-head proof, with baseline exceptions below. Final
  portable clone is at 179b8fd with no tracked changes. All browser source and
  wasm binding digests match Git blobs; changed deployed JS/HTML mirror source.
  Browser proof SHA-256 is 8596d057ec660e689d4d7ba5e8423a7e8e520e6ec46703052edcac7fc2a329d1;
  wasm SHA-256 is 563fb01ba0eb5bcfbf5de2b0f76471881f06f165aa0ff56380edc14acb9d05fc.
  The earlier missing-manifest portability failure is resolved by the recorded
  successful NEW clone, not waived. Full make ci is NOT claimed green.
- A1 HELD. Independent seed 0x22a5c019 produces 65 odd-mode RPCs with
  interleaved invalid second arguments, returned-EDID corruption, repeated
  non-clearing stats reads and stopped rejection through observed linux-worker.js.
  odd-mode-result.json SHA-256 e959f8692a04ae62817f6a23836ef8d20e3b25ca033f26986f59df896b5ce290.
- S1 HELD. In-memory HTTP loader sabotage returns success without setting
  display. The NEW acceptance harness exits 1 on 1280 !== 1367; no implementation
  file is modified. Final-harness SHA and mutation are in sabotage-result.json;
  sabotage.log:6-8, SHA-256 ebb40d53ddee3a838376d209e1a1087d1a44881f25bb33cee77611912033651b.
- COVERAGE HELD. coverage.md maps every changed hunk; C1-C3 close direct UI,
  busy/error, active wrapper and Reflect error paths. Only types, metadata,
  documentation and harness diagnostic safeguards are waived. There is no
  unexecuted claimed runtime behavior requiring more evidence.
- SUITE: retain the four actual WasmLinux tests and make verify-E5-T22a;
  keep the independent attack and coverage scripts plus recorded seed/results
  as reusable verifier artifacts. No duplicate implementation-mirroring test
  is needed. No compositor/end-to-end requirement was added.

Baseline exceptions are grounded against the parent, not inferred from worker
labels. final-audit.json records matching SHA-256s for unchanged source and
dependency files. broad-all-features-lint.log:236-275 contains unchanged dead
code; broad-workspace-mac.log:18-66 contains Linux-only libc and existing GPU
test feature-gating failures. regression.log:902-909 contains unchanged
zicsr-stub cursor test 0 versus 8; lines 977-982 contain unchanged test-only
Instant/Duration static hits. The 267-test core result is at line 346, feature
builds at 663-684, native ISA 127/127 at 973, perf 55.4 MIPS at 1065.

Correction to worker claim: the normal wasm suite also fails in
input_queues.rs:91 (regression.log:603-662), so 'normal wasm tests passed' is
not accepted. The input test and its complete affected module/dependency set
are unchanged and do not call WasmLinux or the new getter. Carry as baseline
under the no-fire rule; do not represent the broad gauntlet as green.

Commands: node evidence/e5-t22a/verifier/attack.mjs;
node evidence/e5-t22a/verifier/attack.mjs --sabotage-only (repeated only for
final harness change); node evidence/e5-t22a/verifier/coverage.mjs;
node evidence/e5-t22a/verifier/audit-final.mjs. Final audit independently
checks exact-head sources, screenshots, 2,006 samples, 64 invalid requests,
source/dist parity and baseline identity.
