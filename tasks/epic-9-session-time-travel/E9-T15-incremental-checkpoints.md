---
id: E9-T15
epic: 9
title: Add incremental RAM keyframes with bounded storage work
priority: 524.915
status: implemented
depends_on: [E9-T05, E9-T14]
estimate: S
risk: high
capstone: false
---

## Goal

Create periodic seek points without serializing a full Omarchy-sized checkpoint every second.

## Boundary

Dirty-page/incremental RAM checkpoint encoding and bounded chain/reference management, reusing accepted disk roots and device snapshots. Compression stays outside long UI-thread tasks.

## Acceptance criteria

- [x] Reconstruct exact state from a full base plus deltas across guest writes, DMA and restore; all memory mutation paths participate in dirty tracking.
- [x] Bound delta-chain length and checkpoint work under the T01 budgets; record actual full/delta sizes, pause time and encode/decode memory.
- [x] Missing/corrupt ancestor chunks refuse restore; deduplicated chunks remain live while referenced by another keyframe or session.

## Deterministic acceptance

`make verify-E9-T15`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Write memory through CPU stores and device DMA, including a page modified back to its earlier value. Remove an ancestor and check refusal; compare reconstruction with an independent full snapshot.

## Verification log

### 2026-10-20 — worker — implementation claim

Product commits `64d61dbce3969fad784c0041ef586099e29ce49c` and
`35d6b8cc4` (final head). The native RAM bitmap tracks checked CPU stores,
fast stores, direct JIT stores, DMA slices and restore, including writes back to
an old value. A frozen epoch is committed only after durable keyframe publication.
The browser store authenticates the full ancestor/reference graph before a
private candidate is modified; one full base plus at most eight deltas rebuilds
RAM, and every delta is checked against its full-RAM SHA-256 before non-RAM state
is restored. The final fix reads the kernel URL from the deploy manifest, so the
live demo works when Pages routes large assets through R2.

- Frozen-source gates: `cargo fmt --check`, affected all-target Clippy,
  `make test`, `make wasm`, `make features`, `make test-riscv`,
  `make riscv-tests-suite` (128/128), `make determinism`, `make perf-smoke`
  (65.7 MIPS against a 15-MIPS floor), documentation/source-contract checks,
  `git diff --check` and `python3 tools/check_task_policy.py` passed.
  `make ci` reaches the same five pre-existing `zicsr-stub` dead-code Clippy
  diagnostics recorded for T14, so its constituent gates above were run
  separately; [the log](/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905/target/evidence/e9-t15-make-ci.log)
  anchors that exception.
- Final exact-head cold clone
  `/Users/blamy/Documents/Codex/.e9-t15-cold-final-35d6b8cc`, scrubbed of
  `RUSTFLAGS`, `RUST_LOG` and `CARGO_*`, passed `make verify-E9-T15` and ended
  clean. [Cold log](/Users/blamy/Documents/Codex/.e9-t15-cold-final-35d6b8cc/target/evidence/e9-t15-cold-final.log)
  SHA-256 `c091a0a40bf8a6faa14fa0100fb64c57657af797c9777514817dce43de9140c3`;
  [browser report](/Users/blamy/Documents/Codex/.e9-t15-cold-final-35d6b8cc/target/evidence/e9-keyframes-final/report.json)
  SHA-256 `f3dc9c996729f36b5df37dbdf8ace11037400364a75e1a28103bb2d70576d2c5`;
  [screenshot](/Users/blamy/Documents/Codex/.e9-t15-cold-final-35d6b8cc/target/evidence/e9-keyframes-final/browser.png)
  and [Playwright trace](/Users/blamy/Documents/Codex/.e9-t15-cold-final-35d6b8cc/target/evidence/e9-keyframes-final/browser-trace.zip)
  accompany 127/0 browser tests, zero console errors and live capability pips.
  The harness denies the local kernel URL and serves it only through a rewritten
  artifact manifest, mirroring production packaging.
- The cold recording has a 13,975,777-byte full base, then 1-page/158,074-byte
  and 176-page/875,993-byte deltas with 940/949 ms pauses; an eight-deep chain
  refuses a ninth delta and a new full base resets depth to zero. Private restore
  applied 177 pages in 2,461 ms. Conservative staged-buffer bounds were
  4,667,134 / 6,820,894 bytes for the deltas, 46,136,086 for the full rebase
  and 34,311,842 for restore, all below 64 MiB; the report also records browser
  heap snapshots. History growth was 15,017,774 bytes excluding initial assets.
  Four independent full-state SHA-256 witnesses culminate in
  `db8e32e887349b6d41e672cf5d1e86023435f6f773d423ec501b64416bbf3a08`,
  exactly reproduced by live from-start replay of two recorded events. A bare
  RV64 JIT-store loop exercised 15 compiled blocks, 1,809 JIT retirements and
  602 direct dirty-page marks. The browser attacks reject an unfinished replay,
  changed initial commitment, ninth delta, missing ancestor and corrupt
  ancestor; a sibling session retains shared objects after source deletion.
- `bash tools/deploy-cloudflare.sh` published final head `35d6b8c` to the
  production `wasm-vm` Pages project as deployment
  `0842e728-758e-4ae5-94d3-5f4dbaf520cb`; the [deploy log](/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905/target/evidence/e9-t15-deploy-final.log)
  SHA-256 `1c9adf07bce2955157bb291c039be92c753f8b5d1e30c3adcfcc7d4f18e2b840`
  includes local hashes and the seven exact public R2 objects. The
  [Cloudflare listing](/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905/target/evidence/e9-t15-cloudflare-deployments.json)
  identifies `main`; the [public asset receipt](/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905/target/evidence/e9-t15-public-assets-final.json)
  SHA-256 `3ddea6e4a1a233b100906d0ddccd59a32a9f4e23278efdabe68ed9fe2f9b339d`
  matches 12 assets byte-for-byte. The
  [public browser report](/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905/target/evidence/e9-t15-public-browser-final/report.json)
  SHA-256 `87e81c19d8a551fd6f4f287b6d3176533103de121214877db7a40ab37f7c6dfb`
  repeats 127/0, the live keyframe probe and final guest digest with no
  non-favicon 404 or page errors; its one favicon 404 is permitted by AGENTS.md.
  The [public screenshot](/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905/target/evidence/e9-t15-public-browser-final/browser.png)
  and [trace](/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905/target/evidence/e9-t15-public-browser-final/browser-trace.zip)
  are available for adversarial replay.

Claim: the recorded native and public browser executions exercise the changed
RAM mutation paths, bounded capture/restore, exact replay and failure refusals;
the fresh verifier should attempt to falsify the reconstructed state and audit
each changed hunk against these recordings and the task criteria.

### 2026-10-20 — independent verifier — VERDICT: needs-evidence

- **P1 / AUTHENTICITY — HELD.** Product head
  `35d6b8cc46ab131710f867f65125a4edf5d9b35d` has tree
  `42878f007471fd6a816d2d7887188d033a1802f5`; `f3207f4f5` changes only this
  task claim and `tasks/QUEUE.md`. The cold log hashes to
  `c091a0a40bf8a6faa14fa0100fb64c57657af797c9777514817dce43de9140c3`
  and names the exact product head plus scrubbed `RUSTFLAGS`, `RUST_LOG` and
  `CARGO_*` at lines 1-2. Its three targeted native suites pass 2/2, 7/7 and
  4/4 with zero ignored tests at lines 83-185. The built report hashes to
  `f3dc9c996729f36b5df37dbdf8ace11037400364a75e1a28103bb2d70576d2c5`;
  both built and public Playwright ZIPs pass CRC. The broad `make ci` log shows
  only the five named parent-baseline `zicsr-stub` dead-code diagnostics at
  lines 178-239; I did not treat them as a T15 finding.
- **P2 / AC1 reconstruction and dirty paths — HELD.** Six fresh runs of
  `cargo test -p wasm-vm-core --test e9_incremental_keyframes` under serial
  and four-thread schedules passed. The independent full snapshot remains
  byte-identical after a checked CPU store, cross-page `write_ram_slice` DMA,
  and a later byte restored to its earlier value; omission still returns
  `RamDigestMismatch`. A separate fresh `--lib ram::tests::` run passed 13/13,
  including fast stores, restore dirtiness, in-flight writes, failed-epoch
  merge, two-chunk reconstruction and atomic late-corruption refusal. The real
  browser report records 177 applied pages and an exact target witness
  `6a4b4eb457141132048a99b7b4777a31a1d8dc5fb80f0632f4c0feaf2caa4af5`
  at `target/evidence/e9-keyframes-final/report.json:94-102,145-156`; direct
  browser JIT tracking reached 15 executed blocks, 1,809 JIT retirements and
  602 marks at lines 158-163.
- **P3 / AC2 bounds — HELD for the exercised chain.** The authenticated report
  shows one-page/158,074-byte and 176-page/875,993-byte deltas with pauses
  940.095/948.665 ms and staged bounds 4,667,134/6,820,894 bytes
  (`report.json:13-45`); depths 1 through 8 succeed and a ninth delta refuses
  (`:47-55,116-125`). The full rebase is depth 0, 837.75 ms and 46,136,086
  staged bytes (`:126-137`); restore is 2,460.845 ms and 34,311,842 bytes
  (`:145-156`). All are below the T01 software limits of 5,000 ms and 64 MiB.
- **P4 / AC3 ancestor integrity and retention — HELD.** Real IndexedDB removal
  and byte corruption of ancestor chunk
  `55e041083829adf855fddfa4d9e322f129ed32f8e764ff1316148011b45a2167`
  both report `Corrupt` before the candidate digest changes
  (`web/session-keyframe-probe.js:138-168`; `report.json:60-67`). After source
  deletion, the sibling session still opens and resolves the shared object
  (`web/session-keyframe-probe.js:169-172`; `report.json:69`).
- **P5 / NOVEL ATTACK AND SENSITIVITY — HELD.** A verifier-only test changed
  the second record of a valid two-page `WVRAMD01` object to duplicate page
  zero. `apply_session_ram_delta_chunk` returned `Err(Malformed)` and the full
  candidate resume remained byte-identical, exercising the order guard at
  `crates/core/src/ram.rs:297-325`. Changing only the expected error to
  `WrongRam` failed with actual `Malformed` and exit 101; restoring the
  assertion passed. A separate valid canonical descriptor with only
  `ramSha256` changed to 64 `e` digits was accepted by the descriptor parser,
  while the native wrong-digest gate refused state commit. The temporary test
  was removed because suite promotion waits for complete coverage.
- **P6 / BROWSER AND PUBLICATION — HELD.** Built/public reports both record
  `127 passed, 0 failed`, no console/page errors, identical four state digests,
  completed two-event replay and live keyframe pips. The public report hashes
  to `87e81c19d8a551fd6f4f287b6d3176533103de121214877db7a40ab37f7c6dfb`.
  Nine deployed code/Wasm assets independently match the frozen checkout and
  the public receipt byte-for-byte; the three artifact manifests are the
  deploy script's expected R2-URL rewrites. Deployment listing entry 1 names
  `0842e728-758e-4ae5-94d3-5f4dbaf520cb`, branch `main`, source `35d6b8c`.
- **COVERAGE / LATER-FULL-BASE RESTORE — NEEDS EVIDENCE.** The probe captures
  `base-2` and proves only that its depth resets to zero
  (`web/session-keyframe-probe.js:88-100`; `report.json:126-137`), but it then
  restores `delta-2`, whose ancestor is the original `WVEXACT1`
  (`web/session-keyframe-probe.js:121-127`; `report.json:145-156`). No delta is
  captured after `base-2`. Consequently the changed `WVKEYB01` branch at
  `web/session-checkpoints.js:265-268` and the Wasm
  `seedSoftwareRamFromCheckpoint` wrapper at
  `crates/wasm/src/session_checkpoint.rs:259-271` are task-relevant and
  unexecuted. Record one focused browser run that (1) captures a full rebase,
  (2) performs CPU or DMA RAM mutation, (3) captures the following depth-1
  delta, (4) restores that delta into a fresh private exact candidate through
  the `WVKEYB01` ancestor, and (5) compares the complete state against an
  independent full snapshot/witness while recording pause and staged-memory
  bounds. No unrelated gate or new cold clone is required if only the harness
  and evidence change.
- **MOCK/ENV/SUITE.** The storage failures use real IndexedDB, not a store
  mock; the local acceptance denies the ordinary kernel path and resolves the
  manifest route used by deployment. No task test is ignored. No repository
  test is promoted while the coverage gap remains. Host rr is waived by the
  2026-09-01 policy.

Commands: targeted native suites under `--test-threads=1` and `4` (three runs
each); `cargo test -p wasm-vm-core --lib ram::tests::`; storage and Wasm tuple
tests; descriptor digest attack; verifier-only duplicate-page attack plus
assertion sabotage; receipt/hash/ZIP/public-byte authentication. A fresh local
browser launch was attempted but this verifier sandbox refuses loopback listen
with `EPERM`, and browser security permission denied the public UI route; the
authenticated built/public Playwright recordings were inspected instead.

### 2026-10-20 — worker — post-rebase restore evidence submitted

The prior verifier's P1–P6 predictions remain HELD; this response changes only
the browser probe, its acceptance assertions and generated demo assets in
`b5d9080e4191ffebadc6a968cfdea6c694743dec`. After capturing the later
`WVKEYB01` full base, the real Alpine guest executes another 1,000,000
transitions and dirties nine pages. The browser saves a depth-one
`WVDELT01`/`WVRAMD01` delta, restores it into a fresh private exact candidate
through that later full base, and byte-compares the complete native resume to
an independent full snapshot. The restored full snapshot SHA-256 and the
from-start exact replay digest both equal
`bd62b728af379b4ae5846893a42be97b259555e94f466198b21dc04f5c91458d`.
This specifically executes the previously unproven
`web/session-checkpoints.js:265-268` and
`crates/wasm/src/session_checkpoint.rs:259-271` branches.

- Exact-head `make verify-E9-T15` passed at `b5d9080e4`, including affected
  native/storage/Wasm tests, rebuilt `web/dist`, 127/0 browser suite, zero
  console errors, five full-state digest witnesses, all previous attacks and
  the new restore. [Command log](/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905/target/evidence/e9-t15-gap-closure-head.log)
  SHA-256 `ad5897a9390f021e90a124db022715f83d31455d047b78cf1b4c2f6e439f3175`;
  [built report](/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905/target/evidence/e9-keyframes-gap-closure-head/report.json)
  SHA-256 `1abb589b164f3b3348d27718175ab6aa6e87f1e2320b88c0207df8226066e665`;
  [Playwright trace](/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905/target/evidence/e9-keyframes-gap-closure-head/browser-trace.zip)
  SHA-256 `146823048ba5ba94ddbbcc7e30ec12f27bd6bafbe760c17731bf632ced5e3ec2`.
  The new delta is 190,961 bytes, 1,117 ms pause and 4,765,792 staged bytes;
  its private restore applies exactly nine pages in 1,369 ms with 32,266,318
  staged bytes. Both are under the T01 5-second/64-MiB limits; the report
  records encode/decode heap snapshots and the independent 13,979,882-byte
  full snapshot digest.
- `bash tools/deploy-cloudflare.sh` validated the staged local artifacts but
  its unchanged 512-MiB R2 probe hit the known 30-second speed timeout and
  Wrangler's 300-MiB upload limit. The seven R2 manifest identities are
  unchanged from the fully checked prior deployment. The established
  `npx --yes wrangler pages deploy web/dist --project-name wasm-vm --branch main --commit-dirty=true`
  fallback published final source `b5d9080` to production deployment
  `babd5961-01cd-4494-b3ba-f21659ac98d2` at
  <https://wasm-vm.pages.dev/>. [Staging log](/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905/target/evidence/e9-t15-gap-closure-deploy.log)
  SHA-256 `5ea0290f0188b1e18902b210662508a00928759212a51d791cc1f9dafea6f37f`;
  [publish log](/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905/target/evidence/e9-t15-gap-closure-pages-publish.log)
  SHA-256 `ae76e742abd91985e1012f35975c586d03a3506c81e7214b9be6b68fac373417`.
  The [public asset receipt](/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905/target/evidence/e9-t15-gap-closure-public-assets.json)
  SHA-256 `ee805c350befe6ba9312ca2c5a27290c1433947ed51b66e1ff1988ebd7ec1947`
  matches 12 deployed files byte-for-byte. The
  [public Playwright report](/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905/target/evidence/e9-t15-gap-closure-public-browser/report.json)
  SHA-256 `ce448e1d883d2f1c8edd1df89460b74d9275b6a4a1f908a024044cf49acb2d6e`
  repeats 127/0 and the post-rebase full-snapshot equality, with no
  non-favicon 404 or page errors. Its screenshot and
  [trace](/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905/target/evidence/e9-t15-gap-closure-public-browser/browser-trace.zip)
  SHA-256 `50b1397603d3d9c786f81039ec0fe3b1be5791a92bd6ca3e1b7c8a0f269ab768`
  are available. A fresh verifier should inspect only the previously missing
  coverage and carry P1–P6 forward as instructed by AGENTS.md.
