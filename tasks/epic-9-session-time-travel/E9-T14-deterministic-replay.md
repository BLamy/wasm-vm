---
id: E9-T14
epic: 9
title: Replay recorded sessions and detect the first divergence
priority: 524.914
status: in-progress
depends_on: [E9-T05, E9-T10, E9-T11, E9-T12, E9-T13]
estimate: S
risk: high
capstone: false
---

## Goal

Re-execute a recorded software VM from its starting checkpoint using only recorded external inputs.

## Boundary

The replay driver, intent matching, exact event consumption and state-digest comparison. Runtime JIT artifacts may be rebuilt; observable guest behavior must remain identical.

## Acceptance criteria

- [ ] Original and replayed CPU/RAM/device/disk digests match at selected event positions in native and built-browser runs, with interpreter and JIT.
- [ ] Replay completion and trace exhaustion stop at the declared end; switching to live execution requires an explicit separate branch action.
- [ ] Report the first missing/extra/misordered event or digest mismatch with its exact position; retain the recording and do not conceal drift by loading a later checkpoint.

## Deterministic acceptance

`make verify-E9-T14`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Corrupt one event or omit one DMA payload, then vary execution quanta and host schedules. Require a precise divergence instead of an apparently successful replay.

## Verification log

### 2026-10-18 — worker — implemented, awaiting independent verifier

Frozen runtime source is `eea72017457812cda98db0f04ccf5ff1b0e4d9a7`.
The implementation starts a pinned 256 MiB, single-hart Alpine Linux machine from
its initial checkpoint, records host input and device/network observations in a
durable exact event tape, and re-executes it without live providers. At four
selected witnesses, replay compares the complete CPU, RAM, device and disk
digest. The built-browser recording contains 47 events and stops at guest
transition `272100000`; interpreter quantum 7 and JIT quantum 4096 reach the
same digest within each run. The JIT path retired over 12 million guest
instructions. Changed input diverges at transition 0, ordinal 2, sequence 2;
omitted DMA diverges at transition `272000000`, sequence 46. End-of-trace and
live-input refusals are asserted rather than silently branching to execution.
The native tests additionally exercise offline guest network delivery,
reordered callbacks, varied quanta, trace exhaustion and source windows larger
than 256 events.

Evidence of record:

- `make verify-E9-T14` on the frozen source: `/Volumes/e9-build-scratch/e9-t14-final-head-eea720174/report.json` (`status: passed`). Its built-browser report, screenshot and trace are under `browser/`; the suite is `127 passed, 0 failed` with zero console errors. The report authenticates the carried full native workspace and wasm workspace logs from source-identical `6119833b311457eb26c59fa2fa2401aaac1b07f6`, plus rerun native replay attacks, RISC-V, cross-target, Clippy, browser, syntax, documentation and contract gates.
- Fresh sparse checkout matching this repository's sparse boundary, with `RUSTFLAGS`, `RUSTDOCFLAGS`, `RUST_LOG` and all `CARGO_*` overrides scrubbed: `E9_REPLAY_EVIDENCE_DIR=/Volumes/e9-build-scratch/e9-t14-cold-proof-eea make verify-E9-T14`. Its receipt is `/Volumes/e9-build-scratch/e9-t14-cold-proof-eea/report.json`, SHA-256 `d4c06f71af04c15e60d7354b98d8b55514c8624de935bd7a14676bb33a3f7b9e`, `status: passed` at the frozen head. It ran full native and wasm workspace suites, all seven replay attacks, cross-target and contract gates, then a fresh browser capture at `/Volumes/e9-build-scratch/e9-t14-cold-proof-eea/browser/report.json` (SHA-256 `4d9bfb6b5437d43d572d6f21ac0aedf0d283fa0230df0e4f1bba24f403e31863`): `127/0`, zero console errors, 47 events, interpreter/JIT digest `381c6c14f713d561fc41ef64e8fdbe2f263db27f7e46f749affb7a98aa9cc669`. The browser trace ZIP SHA-256 is `b8687728648da640db654c7c051e99e147be34eb40a6139b7283873a06798890`.
- `make ci` stops at five pre-existing `zicsr-stub` dead-code Clippy diagnostics, reproduced on untouched parent `c52ab64ba390f13b82190aea4977df08c8f91616` in `/Volumes/e9-build-scratch/e9-t14-baseline-zicsr.log`. The acceptance runner checks the exact known diagnostics, then runs every remaining prescribed gate separately; the cold receipt records the sole exit-2 gate and the exit-0 replacements. This is a baseline exception, not a claim that `make ci` itself passed.
- `bash tools/deploy-cloudflare.sh` published production deployment `7e0b0ed3` to <https://wasm-vm.pages.dev/>. The deploy log is `/Volumes/e9-build-scratch/e9-t14-deploy.log` (SHA-256 `72afcbdf5e1e4cac738d2d13fd24984b678fd0bd80c65ca1b15f53b814b9a178`). `/Volumes/e9-build-scratch/e9-t14-public-assets.json` (SHA-256 `1138e7477e3d4bcf6a60bd2d45d0d5987668b588ef72a4ce5121ab0f1eb2cb7a`) proves seven public app/JS/wasm assets byte-identical to the tested build. The public Playwright report `/Volumes/e9-build-scratch/e9-t14-public-browser/report.json` (SHA-256 `afcd62d16c28b8e5cc8b061778e5ddd8dbf7a5450fdfe6aca9992dc2f6a230a7`) records `127/0`, 47 events, interpreter/JIT digest `5adfe13d28c43a29fa875abbef628fcd08e1df78a9b692ef418e19e30805ae73`, both sabotage divergences, a durable reopen, and zero console errors except the explicitly permitted `/favicon.ico` 404. The initial strict-console failure is retained as `report-first.json`; its URL was independently isolated before the exception was applied.

The independent verifier must interrogate these receipts against the implementation
diff and the task's adversarial criteria before changing the status to `verified`.

### 2026-10-18 — independent verifier — post-completion boundary

VERDICT: refuted

- P1 post-completion host effect — FAILED. Predicted that, without a separate branch
  action, boundary delivery could not change guest state after `Completed`. A fresh
  standalone Rust check completed four real guest transitions at the declared end,
  then staged `WriteRam` at that same transition. Staging returned `Ok(0)` and RAM
  remained zero; `deliver_session_boundary` returned `Ok(())`, changed RAM to
  `0x12345678`, advanced the event sequence from 0 to 1, and changed the complete
  resume digest. The invariant fails at
  `/Volumes/e9-daybreak-verifier/e9-t14-refutation/harness/src/lib.rs:89`; observed
  returns and state are in `independent-check.log:6-14` (SHA-256
  `d171bf8ad71206c848c14770c64366c2d0e9a0ec7c13afec5a26cffaae89b051`).
  `ReplayDriver` installs the limit at `crates/core/src/session_replay.rs:437` and
  reports `Completed` at `:708`, but the changed limit fences only instruction
  dispatch (`crates/core/src/session_clock.rs:641-646,675-684`); delivery applies
  RAM writes at `:538-574` without an end check. Require a refusal of unbranched
  host effect delivery, or an enforced explicit branch action, and re-record.
- P2 guest-instruction fence — HELD for this fixture. Direct
  `run_session_until(5, 8)` before and after the effect kept transition and retired
  count at 4; a second driver run returned `Exhausted`
  (`independent-check.log:7,9`). This finding is guest-state mutation through
  delivery, not instruction execution past the end.
- SUITE: no promoted test while refuted. This narrow confirmation did not run the
  remaining high-risk charter. The interrupted review's saved harness and output
  were not opened or used.

Commands: `CARGO_TARGET_DIR=/Volumes/e9-daybreak-verifier/e9-t14-refutation/target cargo test --offline --manifest-path /Volumes/e9-daybreak-verifier/e9-t14-refutation/harness/Cargo.toml completed_replay_refuses_unbranched_ram_delivery -- --nocapture` (exit 101 from the assertion). Prediction, exact command, source/evidence digests, and assessment: `/Volumes/e9-daybreak-verifier/e9-t14-refutation/assessment.md` (SHA-256 `1abce89156a77bec4773883fca5d5ccebce642a8c45a430387f395bc2d2ef81f`).

### 2026-10-18 — worker — repaired implementation, awaiting fresh verifier

VERDICT CLAIM: the prior refutation is repaired. Frozen product/browser source is
`d646bf8c9aa80be604ff4f80572600c40676651a`. Public session effect staging,
boundary delivery, source-tape append, and low-level device/network replay ingress
now refuse unbranched mutation throughout a full replay, including after `Completed`;
the driver alone uses authenticated recorded-only ingress. Native tests exercise
post-completion RAM writes, callbacks, observation append, device/network injection,
and unchanged complete resume frames. The Linux browser ABI refuses live input and
device/network provider leases after completion. Both interpreter and JIT replay the
47-event Alpine recording to the declared end with matching complete-state witnesses;
changed input and omitted DMA report their first exact divergent positions.

Evidence submitted for independent review:

- Full native and wasm workspace gates passed from pristine runtime head
  `727ed33ebe614a7bf3184d63bb7d58b3e4eb653c` in
  `/Volumes/e9-build-scratch/e9-t14-final-cold-727ed33/report.json`. That run stopped
  later on the T01 source-hash contract, which was then re-audited and updated for
  four replay-boundary files; no runtime code changed afterward.
- Final fresh sparse checkout at `d646bf8` with `RUSTFLAGS`, `RUSTDOCFLAGS`,
  `RUST_LOG`, and inherited `CARGO_*` scrubbed: `E9_REPLAY_CARRY_NATIVE=/Volumes/e9-build-scratch/e9-t14-final-cold-727ed33 E9_REPLAY_CARRY_WASM=/Volumes/e9-build-scratch/e9-t14-final-cold-727ed33/report.json E9_REPLAY_EVIDENCE_DIR=/Volumes/e9-build-scratch/e9-t14-final-cold-d646bf8 make verify-E9-T14`. Receipt
  `/Volumes/e9-build-scratch/e9-t14-final-cold-d646bf8/report.json`, SHA-256
  `3d3be05c698e55ceccad0d03b013c9c38c7de6ee88b293f3d310c9dfd5ee679b`,
  `status: passed`. Its carry guard authenticates the prior full-suite log digests and
  permits only the contract, proof script, browser probe, staged probe, and service
  worker stamp as differences. It reran RISC-V, replay attacks, performance,
  cross-target, wasm Clippy, syntax, documentation, contract and built-browser gates.
  Browser report SHA-256 `d03fc073127a284f44b716c4a7084b415ad89acc4bf1068552f6b8893e49f069`: `127/0`, zero console errors, 47 events, four witnesses, both divergence
  attacks, provider ingress refused after completion, and interpreter/JIT digest
  `fc3336c6ab7839a012cbaaef1745406ee3c043dfa4d5ca1075220e8287d9a6e4`.
  Trace ZIP SHA-256 `df256f5d830f64251b01ab609f53c4bafe4aee9da3aef21646699744e91d9bc5`.
- `make ci` still stops at the five pre-existing `zicsr-stub` dead-code Clippy
  diagnostics reproduced on untouched parent `c52ab64`; the receipt records
  that baseline exception and the separately passing remaining gates.
- Production main project published with `npx --yes wrangler pages deploy web/dist
  --project-name wasm-vm --branch main --commit-dirty=true` after the standard
  deploy script's public R2 GET timed out and its Wrangler fallback refused the
  unchanged 512 MiB object (Wrangler's 300 MiB limit). Prior deploy log
  `/Volumes/e9-build-scratch/e9-t14-deploy.log` had already verified all seven
  immutable content-addressed R2 objects byte-for-byte; this deploy rechecked
  each current local artifact against those exact keys and validated the staged
  Pages tree. Publish log SHA-256
  `6767e4dce524e58cbbaccc0cdaad03be60878b580319e3af784851c49febae7e`.
  Seven public app/JS/wasm assets match the staged build in
  `/Volumes/e9-build-scratch/e9-t14-final-public-assets.json` (SHA-256
  `e33ad7947aa50f8f60a71968af2388d29bfe4f75e2d0d413f95b3b7750675ed4`).
  Public browser report `/Volumes/e9-build-scratch/e9-t14-final-public-browser/report.json`
  (SHA-256 `6e23061981c9806af58ecf6f4c25e92dbeb95ed9f9d69ce3acb642c96009886a`)
  records `127/0`, 47 events, four witnesses, matching interpreter/JIT digest
  `fcd073c351563acac0dd156d96c30e8402036a314b7144a639bba299246b046e`,
  both attacks, provider refusal, durable reopen, zero console errors except
  the permitted `/favicon.ico` 404. Public trace ZIP SHA-256
  `37ae9cab51ce0cbc81741d4485eb4d07b6f863871d14bff95e62f50529087a08`.

The prior verifier's guest-instruction fence result remains HELD for its unchanged
fixture. A new, separate verifier must attack the repaired ingress boundaries and
interrogate the exact-head evidence before changing this task to `verified`.


### 2026-10-18 — independent verifier — exact first-divergence coordinates

VERDICT: refuted

- P6 / AC3 Observe receipt coordinate — FAILED, independently repeated. A fresh
  real guest records its RTC read at `(transition=1, retired=1, Observe,
  ordinal=1, sequence=1)`. Changing only that receipt's ticket passes plan
  admission. Quanta 1, 3 and 19 all detect EventPayload at event_index 0, but
  the structured divergence position reports respectively transitions 2, 3 and
  12, all Before/ordinal 0. The detail text correctly names the Observe receipt;
  the top-level position instead names the later guest stop and varies with
  scheduling. Exact points: `/Volumes/e9-daybreak-verifier/e9-t14-final-standard/final-native.log:91-98`
  (SHA-256 `e0456c5e40ba01c1b6b292d1f5fe3dc51003f5e8df92457230df6cd7b6d34862`),
  assertion `harness/src/lib.rs:53`, guest trace `independent.trace:2`, and
  complete stopped frames `ticket-q1.resume`, `ticket-q3.resume`,
  `ticket-q19.resume`. `crates/core/src/session_replay.rs:549-557` calls
  `failure(machine)`, which uses the current machine position at `:455-465`.
  Require an unambiguous failing-event coordinate in the structured result,
  independent of quantum; distinguish the stopped-machine coordinate if kept.
- P4 / AC3 missing tail — FAILED, independently repeated. Removing the second
  event, recorded at `(8,8,Before,1,2)`, while retaining its positional state
  witness and declared end, reports InvalidPlan at `(0,0,Before,0,0)`, index 0,
  with only `byte bound or unconsumed sequence`. Exact points:
  `final-native.log:83-90` and separate `missing-tail.log:6-11`; assertion
  `harness/src/lib.rs:93`. The generic failure at
  `crates/core/src/session_replay.rs:143-144` loses the missing sequence/index.
  Require a precise missing-event/gap report rather than naming the valid
  initial checkpoint. These are corrupted-recording diagnostic failures, not
  invalid provider calls being mistaken for guest mutation.
- P2/P3 end and repaired ingress — HELD. Carry the prior unchanged instruction
  fence result. Fresh native controls at `final-native.log:71-81,99-102` refuse
  public effect staging/delivery, callbacks, observation append, device/network
  injection, valid typed completion leases and live provider factories before
  and after Completed, with byte-identical complete frames and zero live calls.
  Browser reports `browser/report.json` and `browser-device/report.json` pass
  valid recording controls and replay provider refusal before/Completed, live
  input/lifecycle and ordinary-run refusal, with unchanged complete digests.
  No separate branch action was invoked; live branching remains T20.
- P1/P5 native/browser state and source windows — HELD for exercised boundaries.
  The independent built-browser run retains 47 actual events, four selected
  positions, complete initial/final resume frames, eight 20-section summaries,
  and matching interpreter/JIT final digest
  `3aa6d9ffdbc2c76ada2e680a8a99fd32168b69469261eb647187092cda411d70`;
  JIT retired 12,880,740 instructions. All five captured final section lists
  match individually. An additional replay uses quantum 173. Native 600-source
  windows pass at quanta 1/17/263/4096, and four independent host schedules,
  duplicate/swap and exact digest-witness attacks pass their assertions.
- P7/P8 authenticity and sensitivity — HELD. Both cold report inventories and
  actual gate exits authenticate; 727ed33 native/wasm exits are 0, make ci is 2
  on the exact five parent zicsr-stub diagnostics, and the later contract repair
  changes only proof/contract assets. All seven local immutable R2 artifacts
  match the prior authenticated keys; tested/public bundle receipts match.
  Scratch sensitivity control exits 0; changing only its demanded provider
  count to 1 exits 101 with actual 0 at `harness/src/lib.rs:65`. No deployment,
  push, PR, merge, implementation fix or T15 work was performed.
- COVERAGE/SUITE: all 130 hunks are classified in `coverage-hunks.json`:
  28 executed, 72 waived (with reasons), 30 needs-evidence composed hunks or
  branches. This is not complete per-line runtime coverage. Correctness failed
  before coverage closure; no test is promoted until the repair and remaining
  scoped proof hold. Stable failing tests/frames remain in the scratch packet.

Predictions were written before evidence/probes in
`/Volumes/e9-daybreak-verifier/e9-t14-final-standard/predictions.md`
(SHA-256 `988d7a0c320267e56a05cefa3e46aadd31973c4b1a0bc1628c9861896ba5fe5a`).
Complete assessment, commands, authenticated report hashes, exact observed state,
harness-only failed attempts and hunk ledger:
`/Volumes/e9-daybreak-verifier/e9-t14-final-standard/assessment.md`
(SHA-256 `00cfd555425247c41a1b674274f89f6c2d990f14091c787381bcbdc9e575b77a`).
Reproduction: `python3 /Volumes/e9-daybreak-verifier/e9-t14-final-standard/run-native.py`
records six passing controls and two exact-coordinate failures (exit 101), plus
separate sensitivity control/sabotage. Browser commands are the adjacent
`browser.mjs` and `browser-device.mjs` (both final exits 0).

### 2026-10-19 — worker — repaired first-divergence diagnostics, awaiting fresh verifier

VERDICT CLAIM: the two independently refuted coordinates now name the first
failing event, independent of the execution quantum. The product repair at
`20706793a96de1f34158f6991f5aed3d92c14dee` reports a changed RTC receipt
at its recorded `Observe` position, identifies a missing tail/source-window
event rather than the initial checkpoint, and reports a valid but wrong source
kind at that same first observation. Native replay tests include the invalid
agent slot, missing source window, 600-observation window, changed input and
omitted DMA; all nine passed, including the pinned Alpine software profile.
The later frozen head `13e02f8c04414575c7ab2a5b12bbf6d27633966a` changes
only the recording script and a CLI WebSocket test fixture that keeps relay
stdout drained until child exit.

Exact-head evidence: from a fresh detached checkout at `13e02f8c0`, with
`RUSTFLAGS`, `RUSTDOCFLAGS` and `RUST_LOG` scrubbed, ran
`E9_REPLAY_CARRY_PARTIAL_NATIVE=/Volumes/e9-build-scratch/e9-t14-source-divergence-pristine-20706793a E9_REPLAY_EVIDENCE_DIR=/Volumes/e9-build-scratch/e9-t14-incremental-pristine-13e02f8c0 make verify-E9-T14`.
The receipt `/Volumes/e9-build-scratch/e9-t14-incremental-pristine-13e02f8c0/report.json`
is SHA-256 `714b5d76297fc974000ae1ae524dd3b3921638d1ce2070ed65900835f5a7c410`,
`status: passed`; all 24 listed gates exited zero, and all 29 inventoried
evidence files rehashed exactly. It authenticates the prior partial native
workspace log at runtime-identical `20706793a`, reruns the touched relay
fixture and missing native tail, then passes full wasm workspace, RISC-V,
cross-target, replay attacks, performance smoke, wasm Clippy, browser build,
syntax, documentation and session-contract gates. Its built-page browser
report `/Volumes/e9-build-scratch/e9-t14-incremental-pristine-13e02f8c0/browser/report.json`
is SHA-256 `a0b7fe684306d224f81c5f41972c56061cfd2aa163eb07bd4b20603f40b8ee40`:
127 passed/0 failed, zero console errors, 47 saved events, four witnesses,
four precise divergence attacks, durable reopen, and matching interpreter/JIT
complete-state digest `da8696495e6867a13e7b0fcb20af98d1ff44e3631db5d0eb854bdbf4aaad4a84`.
The browser trace ZIP SHA-256 is
`200f319313f6b876533f70a0d1038498bf21b88bd99b6634af1dd2353f85305d`.

`bash tools/deploy-cloudflare.sh` published production deployment `2dd07507`
to <https://wasm-vm.pages.dev/> after byte-for-byte verification of all seven
immutable R2 boot artifacts. Deploy log SHA-256 is
`f9b05231f16c6c231bfd45d45f2c3f76852f2c3d7190978c167d629ec3102`.
All seven public app/JS/wasm files match the tested staged build in
`/Volumes/e9-build-scratch/e9-t14-source-divergence-public-assets.json`
(SHA-256 `cabdd586445c79fef914a65e38346c3c02ca5a9f53e37462bc6b2bb92d00edce`).
The public Playwright report
`/Volumes/e9-build-scratch/e9-t14-source-divergence-public-browser/report.json`
(SHA-256 `07b374c53582a260ace9f7e5b5b564c7c42ae132395cb25fdb65f7bb1a9b3929`)
again records 127/0, zero console errors, 47 events, four attacks, durable
reopen, live roadmap pips and interpreter/JIT digest
`dba636ee90655c0f46c682845c7261ded9b2ba3949405f20cd201a08a116214b`.
Public trace ZIP SHA-256 is
`9b7a1ca9411b7d417ecd9d80b2b3c204f5a750fe641e53ba06da2bcf63edc689`.

Baseline exceptions are explicit in the receipt: `make ci` still stops at the
same five `zicsr-stub` dead-code Clippy diagnostics reproduced on untouched
parent `c52ab64`; all later prescribed gates ran separately. An unchanged
10 ms wall-clock emitter benchmark fluctuated across 12 isolated attempts
(five under 10 ms), so correctness tests and a performance smoke with its
stated budget ran separately. Neither exception is represented as a passing
`make ci`. The previous verifier's HELD findings should carry where the code,
dependency boundary and evidence digest are unchanged; the fresh verifier
must retest the exact-coordinate repairs and close the remaining scoped hunk
coverage before setting `verified`.

### 2026-10-19 — independent verifier — ordinary ingress after completion

VERDICT: refuted

- P9 / AC2 post-completion ordinary ingress — FAILED and independently
  repeated. Predicted that without an explicit branch action, ordinary
  host/device ingress would be refused or preserve the complete frame after
  `Completed`. A four-instruction replay completed at
  `(transition=4, retired=4, Before, ordinal=0, sequence=0)`. Direct UART
  `push_input("Q")` kept that coordinate but changed complete resume SHA-256
  `9906f218cceb6f860de861440feacad912c13882a07c943c4d858aebda60f3fd`
  to `e9e85e4619805dd30fd3e7c404a2963674636d0f4d0a5f304ccfc558ed0a694b`;
  direct keyboard `KEY_A` injection plus `sync()` likewise kept the coordinate
  but changed it to
  `8734209c640886132cfbdfb0442cb172539168b2d4697b4cbb6f6dbf094f8986`.
  SBI input was byte-identical in this fixture and is not a finding. Exact
  observations: `/Volumes/e9-daybreak-verifier/e9-t14-repair-final-646e840a8/ordinary-ingress-final.log:5-10`
  (SHA-256 `b3230354eee1167b55e088c0fa7175acc7e7350b6f23bb8af91e7583d4e47ab1`),
  independently repeated in `ordinary-ingress-recheck.log:5-10`; attack at
  `harness/src/lib.rs:692-738`. The new profile returns the ordinary UART
  handle and installs keyboard input at `crates/core/src/session_profile.rs:50-58,72`;
  the direct host surfaces remain at `crates/core/src/lib.rs:1594-1601,2222-2233`,
  outside replay-owned guards. Require one enforced replay/branch-generation
  gate shared by ordinary UART/keyboard/pointer/provider ingress and complete-
  frame regressions before and after completion.
- P5/P6 repaired exact coordinates — HELD. Varied quanta 1/3/19 now report the
  changed RTC ticket at recorded Observe `(1,1,Observe,1,1)`, event index 0,
  even though stopped-machine positions vary. Missing tail sequence 2 reports
  `MissingEvent` at `(8,8,Before,1,2)`, event index 1. Citation:
  `/Volumes/e9-daybreak-verifier/e9-t14-repair-final-646e840a8/prior-refutations-recheck.log:5-20`
  (SHA-256 `49fa27918c499856c0d40c1ae869d73bd45efc0f023a4960953d78828fafcc3f`).
- P7/P8 wrong kind and missing window — HELD. RTC kind changes at quanta
  1/3/19 report `EventPayload` at the exact Observe coordinate/index with zero
  live calls. A guest performing 255 of 600 recorded reads reports
  `MissingEvent` at recorded event index 255 / transition 256 while the machine
  stops at 257. Citation:
  `/Volumes/e9-daybreak-verifier/e9-t14-repair-final-646e840a8/coordinate-recheck.log:5-13`
  (SHA-256 `a95bd1cc68f56341922c640ba230d96d2f95b7ea484be55bb16199550cec6c5b`).
- P1/P2/P3/P4/P10 — HELD incrementally where source/dependency/evidence
  digests are unchanged: selected native/browser full-state replay, instruction
  end fence, session-owned effect/source/device/network/provider refusal,
  source-window happy paths, host schedules, durable reopen and first-failure
  retention. P3 is limited to session-owned entry points; P9 is the ordinary
  host/UI path it did not cover.
- P11 authenticity — FAILED narrowly on one citation, while the artifacts
  otherwise authenticate. Receipt SHA/head/tree match; all 29 inventoried files
  and all 24 listed zero exits match; built/public browser reports record 127/0,
  zero console errors, 47 events and four attacks; all seven public assets are
  exact. The worker log cites deploy-log SHA
  `f9b05231f16c6c231bfd45d45f2c3f76852f2c3d7190978c167d629ec3102`,
  but the actual SHA-256 is
  `f9b05231f16c6c231bfd45d45f2d97c3f76852f2c3d7190978c167d629ec3102`.
  Correct the citation next submission. The log itself confirms deployment
  `2dd07507`; public asset/browser evidence remains independently authenticated.
- P13 coverage — NEEDS EVIDENCE. The prior 130-hunk ledger is carried. Two
  invalid-agent-slot gaps and repaired coordinate branches are now exercised,
  but 28 prior composed gaps remain; repair branches for begin-sequence and
  byte bounds, missed-witness traversal, runtime extra delivery, and four
  source-divergence variants remain unproven. Exact classifications:
  `/Volumes/e9-daybreak-verifier/e9-t14-repair-final-646e840a8/coverage-audit.md`
  (SHA-256 `1cf87b4aefba900ec6e5b87ad88cbde40f66e8fcf6ea671aecb4524745556789`).
- P14 sensitivity — HELD. The normal ordinary-ingress assertion exits 101;
  changing only the scratch demand with `SABOTAGE_ASSERTION=1` exits 0 on the
  same mutations (`ordinary-ingress-sabotage.log`, SHA-256
  `f729043d6bd5c02b092b24817d705c82cc9ebca5aee22c73fe09d60b7c08da3a`).
- SUITE: no repository test promoted while correctness is refuted. Host rr is
  waived by the 2026-09-01 policy. Full assessment, predictions, commands and
  authentication are under
  `/Volumes/e9-daybreak-verifier/e9-t14-repair-final-646e840a8/`;
  `assessment.md` SHA-256
  `b23f5743c839f4b8f6b16fbf1cd6f90b313623efbe271155e7ab01f05885b5ef`.

Commands: independent offline Rust harness cases for the two prior
refutations, wrong-source-kind, missing-source-window and ordinary ingress;
scratch sabotage inversion; exact-head receipt/public artifact authentication.
The expensive unchanged full wasm/cross-target/browser proof was not repeated.


### 2026-10-19 — worker — sealed ordinary replay ingress, awaiting fresh verifier

Frozen product and built-page source is commit
`9d4b3905bacd689b71c1cc9cf91cd4042adc64d5` (tree
`3e89eb3be8ba19b13caf0006f4ea7b8724e2cd7d`). A shared transient
replay-ingress gate now follows retained UART, keyboard, tablet, and pointer
handles and refuses ordinary input and public snapshot restoration before and
after `Completed`. Only the replay driver's synchronous recorded callback may
open the gate. The native tests assert unchanged complete resume frames for
ordinary ingress, and the recorded UART/keyboard/pointer callback still applies
its authenticated event. The 47-event pinned Linux recording replays through
both interpreter and JIT to the declared end, with matching complete-state
witnesses; four sabotage attacks report first divergence rather than silently
branching or loading a later checkpoint.

Evidence of record, all stored on persistent local disk:

- From a fresh independent clone with an empty target and inherited
  `RUSTFLAGS`, `RUSTDOCFLAGS`, `RUST_LOG`, and `CARGO_*` overrides scrubbed:
  `E9_REPLAY_EVIDENCE_DIR=/Users/blamy/Documents/Codex/e9-t14-proof-cold-9d4b3905 make verify-E9-T14`.
  Receipt [report.json](/Users/blamy/Documents/Codex/e9-t14-proof-cold-9d4b3905/report.json),
  SHA-256 `f84de76ccacd78b66d328f8724f2404c3361351e46767cf1e3621720d507f49d`,
  `status: passed` at the frozen head. All 19 other listed gates exited zero,
  including the full native workspace, full wasm workspace, separate native
  RISC-V and 11/11 replay tests with `trace,virgl-renderer`, performance,
  cross-target, wasm Clippy, contract, built browser, and syntax/docs. `make ci`
  alone exits 2 on the same five pre-existing `zicsr-stub` dead-code Clippy
  diagnostics reproduced on untouched parent `c52ab64`; the runner verifies
  that exact exception and records every remaining gate separately. The
  unchanged 10 ms emitter benchmark passed all 12 isolated samples in this run.
- Built-page Playwright [report](/Users/blamy/Documents/Codex/e9-t14-proof-cold-9d4b3905/browser/report.json),
  SHA-256 `217e315d260bbc6bba407bdd1f5f2036a562ce49aa0ae789bce2dbb2de9f5384`:
  `127 passed, 0 failed`, zero console errors, 47 events, four witnesses,
  four divergence attacks, durable reopen, both ingress fences true, and
  interpreter/JIT digest
  `ebb13099eb725c3fa51e15a874b8d10883d7feb04533fc529cb01d79ca4f5cb0`.
  Its trace ZIP SHA-256 is
  `c026ca36c8ab25417720cd84251b7d160f35dedad1ade8a96c1825affcaa44f5`.
- The main Cloudflare Pages production listing
  [cloudflare-deployments.json](/Users/blamy/Documents/Codex/e9-t14-proof-cold-9d4b3905/cloudflare-deployments.json),
  SHA-256 `3940d0edc010bc32d8a68d56cc76b50bc057657f08cceadcc9bdb74ac470f32b`,
  identifies deployment `16775d81-d898-406d-8217-8e78347fc63c` on branch
  `main` from source `9d4b390`, serving <https://wasm-vm.pages.dev/>. Seven
  fetched public app/JS/wasm assets are byte-identical to staged `web/dist` in
  [public-assets.json](/Users/blamy/Documents/Codex/e9-t14-proof-cold-9d4b3905/public-assets.json),
  SHA-256 `044408131f2e41ba77dd88298ebed27477ff6a315b08a27b0c6e6f1df0113690`.
  Public Playwright [report](/Users/blamy/Documents/Codex/e9-t14-proof-cold-9d4b3905/public-browser/report.json),
  SHA-256 `072199f33d18601ae060ae570e270c600407c213e9b3d601bff2aedee78b600c`:
  `127/0`, 47 events, four witnesses, four attacks, durable reopen, zero
  console errors except the specifically filtered `/favicon.ico` 404, both
  ingress fences true, and matching interpreter/JIT digest
  `b81af919c7fe33625c2158ae0a179fbfc834d70801ae3f0b80bd2cbf2e3ea0aa`.
  Public trace ZIP SHA-256 is
  `172e4bb0a9d1b3032aeb77997be62b81c36e8842c70fc2fb0c5a23db4646d516`.
  Public command: `node /Users/blamy/Documents/Codex/e9-t14-proof-cold-9d4b3905/public-browser.mjs`.

A previous scratch RAM volume detached during an otherwise progressing cold
run; that incomplete run is not evidence. A redundant deploy attempt from the
sparse proof clone was rejected before publish because the clone omits a large
rootfs artifact. The production deployment above remains live and was
independently checked from Cloudflare's listing and the public site. A new
adversarial verifier must challenge the repaired ordinary ingress and audit
the diff against these recordings before setting `verified`.

### 2026-10-19 — independent verifier — real native JIT device-state quantum divergence

VERDICT: refuted

- P1 / AC1 complete native interpreter/JIT state — FAILED. Predicted that a
  recorded full software topology with UART input at transition 64 would reach
  the same complete resume frame at selected witness
  `(4096,4096,Before,ordinal=0,sequence=1)` under real native Wasmtime JIT for
  varied quanta. Interpreter quantum 7 produced SHA-256
  `7d3baa054f978ddb541a6263d950c50c501bfeaf8488d5fcad683d0783c97814`.
  Real JIT quantum 7 retired 1,164 compiled instructions and matched, but
  quantum 173 retired 3,912 compiled instructions and stopped with
  `StateDigest`, frame
  `b4f0a538ea19cb4c5feb86708f4328c3f942ba2b59f297842d6e9dc09a4ea9d6`;
  quantum 4096 retired 4,026 compiled instructions and stopped at the same
  witness with frame
  `cfc02c27f89498e543ff336b4e4ec903a27d0c395d781a1c2c3b8f6faae9040c`.
  Only UART section 5 differs: interpreter timeout latch/idle ticks are
  `(true,1024)`, versus `(false,772)` and `(false,677)`; exact offsets are
  1539–1541. Citation:
  `/Users/blamy/Documents/Codex/e9-t14-proof-cold-9d4b3905/verifier/native-real-jit-complete-frame.log:5-14`
  (SHA-256
  `cbb245e109a3452ba7044ad8838f09e55c3fadfebf66f8f2ad8c32f9f7a19149`)
  and `resume-diff.json:2-100` (SHA-256
  `cc095757e5ce76f9631e613ee93a29d7e46b287eb32b2ea6738cfda52661e264`).
  The UART timeout is serialized at `crates/core/src/dev/uart16550.rs:107-120`
  and ticked at `crates/core/src/lib.rs:6115-6120`; a compiled block executes
  after one pre-entry boundary sync at `crates/core/src/lib.rs:6528-6543,6591-6597`.
  Make device progression independent of host quantum/block entry, then add a
  permanent real-Wasmtime multi-quantum complete-frame test requiring
  `retired_via_jit > 0` and an equivalent built-browser witness.
- P1 fixture hunt — FAILED. The submitted native “JIT” loop only enables block
  cache and interrupt batching at
  `crates/core/tests/e9_deterministic_replay.rs:252-261,305-326`; it never
  installs an executor or asserts compiled retirements. The long browser
  fixture uses a real JIT and passes after the UART state has converged, so it
  does not falsify the shorter pending-character boundary. Demand: replace the
  cache-only native claim with actual executor/counter evidence.
- P2 / AC2 repaired ingress and end fence — HELD for attacked surfaces.
  Retained UART/keyboard/tablet/mouse handles, input sync, output drain, public
  snapshot restores, SBI input/console, effects/source append, valid retained
  device/network leases and live provider factories preserve complete frames
  before and after `Completed`; callback unwind closes the recorded-only scope.
  An extra byte smuggled inside an authenticated callback is detected as
  `StateDigest`, not concealed. Citations:
  `verifier/independent-attacks-serial.log:4-26` (SHA-256
  `9954b5d619ed1641f8c5c3d35fbc8cee0eb3f1c290e461260c882eb4219d5d8d`),
  parallel schedule SHA-256
  `488e2f4c24f98c4d0add61e797878dfdc623b278dec33450bdf3470462c52441`,
  and `verifier/provider-leases.log:7-11` (SHA-256
  `2185306e5a44275fbcd47abb8a27c58fa0665d2e0f32c620ba15de3619014d81`).
  Demand: none for this unchanged repaired boundary.
- P3 / AC3 coordinates — HELD. Changed observation ticket/kind at quanta
  1/3/19 report `(24,24,Observe,1,1)`, event index 0; missing source reports
  that same first coordinate and missing tail reports index 4 at
  `(4,4,Before,5,5)`. The independently rerun product suite passed all 11
  changed-input, omitted-DMA, reordering and exhaustion cases. Citation:
  `verifier/independent-attacks-serial.log:7-15` and
  `verifier/product-e9-t14-tests.log` (SHA-256
  `dcde52b36d0bcb11ca469553d6d3a3cbedceacf70fa01f9655bef14294e07677`).
  Demand: none for these unchanged coordinate branches.
- AUTHENTICITY/BROWSER/PUBLIC — HELD. The receipt, all 23 inventoried files,
  built/public reports and traces, public-assets receipt, ZIP CRCs and
  Cloudflare listing authenticate. Both browser reports record 127/0, 47
  events, four witnesses, four attacks and real JIT retirements. Production
  deployment `16775d81-d898-406d-8217-8e78347fc63c` identifies source
  `9d4b390`; a fresh fetch re-matched all seven staged assets. Citation:
  `verifier/authentication.json` and `verifier/public-assets-live-recheck.log`
  (SHA-256
  `9b72941373f183540505f73f07060324b12c5fa51d05f8384b6ed06a0169cd99`).
  Demand: none; the failed redundant sparse-clone deploy did not publish.
- COVERAGE — NEEDS EVIDENCE in addition to the refutation. The exhaustive
  baseline→product ledger classifies all 243 textual/binary Git hunks: 64
  executed behavior, 16 executed harness, 37 declarative waivers, 86 generated
  waivers and 40 composed hunks carrying 18 precise branch-level demands. The
  authenticated packet contains no line-addressable guest instruction trace;
  `replay-native-trace-and-attacks.log` is test stdout. Citation:
  `verifier/hunk-ledger.md` / `hunk-ledger.json` (SHA-256
  `bc11bd878be921b52c6d8e0aac6bf37db3eb21b04978f9c2f1e14287453da3c1`).
  After correcting P1, satisfy ledger gaps G01–G17 (or record specific waivers)
  and attach exact-head guest-trace/digest evidence; resolve fallback G18 for
  any remaining hunk.
- SENSITIVITY — HELD. Normal unchanged-frame assertion exits 0; changing only
  the scratch demand to require a mismatch exits 101. Citation:
  `verifier/sensitivity-control.log` SHA-256
  `d2f41112ab837d3162f66c9f6a501b2e533baa485ac7236f197010279af1a6fe`
  and `sensitivity-sabotage.log` SHA-256
  `dcd1042d1679de117d62457e43930fc9b3f260b286e0b5e71900b6745afb7846`.
  Demand: none.
- SUITE: no repository test promoted while correctness is refuted. Host rr is
  waived. Predictions SHA-256
  `98d9191c3f472d66fe86b14f55681bfb406e46c36da55afda1ffa1ed34ccf14f`;
  full assessment SHA-256
  `1b39cff61b8a6135eb1959213890b4f841b02f5edf2945e62a5d6daf0a31c63b`;
  verifier manifest SHA-256
  `58bacb3fa105542410054fc569fca9715b47e24b3c507e0a176f06dcdab33e85`.

Commands: independent offline Rust harness under serial/four-thread schedules;
real native Wasmtime quanta 1/7/173/4096; retained device/network lease attacks;
11/11 exact-head product replay tests with `trace,virgl-renderer`; assertion
sabotage; receipt/ZIP/public-asset authentication. Complete artifacts:
`/Users/blamy/Documents/Codex/e9-t14-proof-cold-9d4b3905/verifier/`.
