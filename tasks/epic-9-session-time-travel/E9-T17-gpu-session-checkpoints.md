---
id: E9-T17
epic: 9
title: Restore historical accelerated desktop checkpoint pairs
priority: 524.917
status: verified
depends_on: [E9-T05, E9-T16, E6-T11d74c, E6-T11d74d]
estimate: S
risk: high
capstone: false
---

## Goal

Use coherent RAM/disk/GPU checkpoint pairs as accelerated session keyframes.

## Boundary

Integrate the accepted production GPU checkpoint path, renderer/profile identity, physical scanout and fresh epoch ownership with the session store. Reuse verified predecessor work; no raw WebGL handles are serialized.

## Acceptance criteria

- [x] Capture two real accelerated desktop positions and restore the matching guest state, disk root, GPU resources and physical scanout from each.
- [x] Require actual post-restore guest rendering/input and current-epoch scanout; old screenshots, retained readiness messages and software fallback do not prove accelerated restore.
- [x] Reject incompatible host/profile/build or lost-context captures cleanly. Reuse the verified E6-T11d74a/b/c/d native/renderer/worker/publication path; the cancelled E6-T11 container is not an executable prerequisite. Retain the authenticated clock policy and fresh epochs.

## Deterministic acceptance

`make verify-E9-T17` runs the transport/archive guards, built-page suite, hardware GPU/public-restore regression and actual cold Omarchy capture/restore/input/library matrix. The risk-tier native submission and incremental evidence rules follow AGENTS.md.

## Adversarial verification

Cross-wire RAM/disk/GPU components, change the host profile, lose context while capturing and send stale epoch completions. Require explicit refusal and preservation of the original session.

## Verification log

### 2026-10-21 — worker — development failures retained; final proof pending

The session-store integration binds one production WVGPAIR1 tuple to its exact
position, disk root, renderer build and host profile. The public library can save
and reopen accelerated points, including navigation from the ordinary demo to
the desktop. This entry is a development record, not an implemented/verified claim.

- `target/evidence/e9-t17-gpu-browser-dev-r6/report.json` passed the original
  supervisor-MMIO GPU workload, two stored colors, fresh-worker restoration,
  post-restore input, crosswired native/renderer refusal, foreign profile/build,
  stale presentation completion, GC, and context-loss capture refusal. This is
  supplementary coverage, not the required Linux/Mesa desktop proof.
- Cold runs `e9-t17-real-dev02` and `dev04` exposed page chrome covering the
  physical canvas. Desktop mode now keeps the canvas visible and the library
  in a collapsed drawer; `e9-t17-demo-navigation` passed 127/0 and hit-testing.
  `dev05` stopped on a transient R2 transport failure for an existing hash-pinned
  chunk. The recording server now retries bounded transport failures while
  retaining hard failure for a missing object or digest mismatch.
- `target/evidence/e9-t17-real-dev06/e9-gpu-session-desktop.json` failed the
  package-bar pixel deadline before capture (SHA-256
  `0c8ff5b10847b2855158106fef8051d30ef5a28a02042ff057050c7840df60c9`).
  Its retained owned-page retry used trusted Ctrl+C to select the declared
  paced-on-keyboard policy, then passed actual bar pixels and input. The final
  harness prepares this normal interaction before capturing.
- The supplementary CDP-driver run captured a real first point but its later
  typing failed. The original driver subsequently passed live input. A manual
  per-character diagnostic after restore visibly repeated characters; the
  final functional-input proof uses brief trusted taps and makes no typing
  latency or key-repeat claim. Both failures remain in
  `e9-t17-real-dev06-supplement-r2` and `e9-t17-live-core-dev`.
- The original cold desktop did restore both actual saved positions with
  qualified current-epoch scanout and the expected older/newer disk contents.
  Original-driver brief input and clock pause/resume passed after each restore:
  `e9-t17-real-dev06/control-input-restored-brief-input.json` SHA-256
  `eada49e4633865f5a03cc6746fae2c827b91ed5902a8fa41dc0244d330d83d1f`;
  `target/evidence/e9-t17-second-restore-dev.json` SHA-256
  `f30bf87d65484f7c02cf452ef9354f96921b4bc8819e9ecd87e741a108bb271e`.
  These adaptive development runs do not replace the frozen acceptance command.

Native GPU epoch values are scoped to a worker: restoring two pairs captured at
epoch 2 can yield epoch 3 in two different workers. The final assertions bind
the saved-to-fresh native epoch change to the unique page controller owner and
current physical scanout, and challenge the retired controller. They do not
mistake a repeated worker-local number for shared ownership.

The final `make verify-E9-T17`, exact-head cold proof, public publication and
fresh independent verifier are still required. Status remains `in-progress`.

### 2026-10-21 — worker — independent publication race repaired

A fresh preflight reviewer reproduced context loss after the pair was captured but
before its manifest was published. The old head `7952cfac` incorrectly accepted
that save, twice (`target/evidence/e9-t17-verifier-preflight/context-loss-race-run2`
and `context-loss-race-recheck`). The partial review ended at an account access
check, so it is not a completed verifier verdict. The obsolete cold gauntlet was
interrupted and its partial output retained at
`/Users/blamy/Documents/Codex/e9-t17-cold-proof-7952cfac-evidence`.

The store now supports a caller publication guard after asynchronous object
validation and immediately before the manifest transaction. GPU capture uses it
to revalidate the paused live owner, profile and historical position. The promoted
real-worker race in `tools/verify/e9-gpu-session-browser.mjs` injects the actual
context loss during capture and requires refusal plus identical canonical
manifest bytes/digest and revision. Development recording
`target/evidence/e9-t17-guard-dev-r2/report.json` passed. It also delivers an
authentic old frame callback after a fresh worker is active, proves its retained
frame/binding/canvas did not change, then successfully retires the current frame.

The real-desktop recorder now checks guest Mesa/virgl, records keyframe
descriptors, compares original session bytes/revision after each refusal, and
cross-wires actual disk/GPU references before restoring. Its expanded public
library navigation proof remains pending in the final cold acceptance run.
The recording-server transport retry has a bounded deterministic test covering
transient disconnect, exhausted retries, missing object and wrong digest; missing
or corrupt bytes are refused on their first response. Runtime changes require a
new frozen-head risk submission and fresh independent verdict; no criterion is
marked verified by this development entry.

### 2026-10-21 — worker — restored configuration identity repaired

The next fresh review's bounded novel attack showed that an intact pair plus a
changed `configuration.bootargs` was accepted by save/admit at `55e8f0e5`, but
rejected by the real replacement worker after retirement. Its concrete receipt is
`target/evidence/e9-t17-fresh-verifier/novel-boot-identity/report.json`, SHA-256
`b87beaea5c6e1d288ee9786bfa626d9f85fb8950431cd6c26d92a2baaa65e15e`.
Both `e9-t17-final-gauntlet-55e8f0e5` and `e9-t17-final-cold-55e8f0e5` under
`/Users/blamy/Documents/Codex/` were stopped, with partial evidence preserved.

Configuration validation now reconstructs the loader's complete identity and
requires exact agreement, at both save and admission, before ownership changes.
Admission also checks manifest RAM size against those options. The promoted
regression builds a malformed stored candidate independently of the save helper;
`target/evidence/e9-t17-identity-dev-r1/report.json` rejects both paths and retains
the original manifest bytes/revision. The real desktop command now includes the
same malformed-candidate preflight against its incumbent owner.

The independent guard-removal sabotage at the preceding head failed exactly at
the loss-during-capture assertion (no unrelated browser errors), proving that the
promoted regression detects the actual publication bug. The fresh session then
stopped at the model's account-security requirement and did not issue a complete
verdict. Final frozen-head proof and a completed fresh verifier remain pending.

### 2026-10-21 — worker — native gate held; focused recording and raw retention

The frozen `709b19717553fdbeb65117d201641aac908b5862` full local submission
passed: production Clippy, native/Wasm/features/RISC-V suites, determinism,
performance smoke, a 4096-instruction JIT guest trace, and the browser storage
regression (four tab interruptions, twenty two-tab races, reload/corruption checks
and retained GPU factory restoration). Receipt:
`/Users/blamy/Documents/Codex/e9-t17-final-gauntlet-709b1971/report.json`.
The existing five `zicsr-stub` dead-code diagnostics were matched exactly and
narrowly waived as previously recorded; production linting stayed strict.

The real cold desktop reached actual hardware rendering and trusted input setup,
but the reused input helper stopped on blank package-bar content before either
point was captured. Failure:
`/Users/blamy/Documents/Codex/e9-t17-final-cold-709b1971/desktop/e9-gpu-session-desktop.json`,
SHA-256 `d96ad49afcb4d071a5a3355f7de1253ce482cc38d03e793f4c9ff7f5f8aab738`.
The original crops/commands remain recorded. Bar glyph readiness is outside this
task's state/input/scanout claim. T17 now records one bar-content observation,
keeps the actual mapped bar/Foot/focus/input/file/rendering assertions, and does
not claim populated bar content or exercise bar actions. Other callers retain
the original required-content default. The unrelated cold-bar issue is tracked
separately; no product code was changed to bypass it.

The fresh standard verifier found that the original temporary profile would lose
the saved tuple objects when closed. The evidence harness now awaits a read-only
export after the two points and input complete, preserves exact canonical
manifest/revision, pairs, descriptors, configuration/assets and both COW root
closures, and checks their hashes, lengths and unchanged manifest/owner. It also
retains a Playwright trace. This explicit idle handoff needs no guest control
changes or supplemental debugger. The earlier observer was cancelled before
capture and produced no archive. `target/evidence/e9-t17-archive-dev-r1/report.json`
passed the actual hardware browser/store archive; the HTTP/file boundary test
refused corrupt bytes, bad offsets and oversized references.

These changes touch recording scripts and evidence only. Runtime files, their
dependency boundary and the full native gate's digests are unchanged; carry that
passed gate forward under incremental re-verification. The focused final browser
command, final clean-clone proof and complete independent verdict remain pending.

### 2026-10-21 — worker — public restore scope failure retained

The frozen `795dc80b093f20c2514cb174f26fe2fffba2a4d7` cold run captured both
actual Linux/Mesa positions, completed trusted input, exported 2144 immutable
objects (344686234 bytes), and refused foreign build/physical host and crosswired
disk/GPU/configuration candidates while preserving the original manifest and
revision. Its first valid public restore then failed at `web/main.js:2255`:
`ReferenceError: query is not defined`. No successful restoration is claimed.
The original recording remains at
`/Users/blamy/Documents/Codex/e9-t17-final-cold-795dc80b/desktop/`;
`e9-gpu-session-desktop.json` SHA-256
`a802bb8ccb6a5576bc6c7bed9ca25eba3616ec89a202d4292c39ba56d0172cfb`,
raw archive receipt SHA-256
`486988fb2efd2a80609ffe045c771f879333c277cef7c43df42428d1f1b6a28f`,
and `browser-trace.zip` SHA-256
`8795657dfcce86fe734c608fb4b0114fb55fc05ae78ccebfa9b1d47a9ab00b43`.

The restore method now creates its own URL parameters before retiring any owner.
The short hardware-browser regression also exercises two successful restores
through the actual public page/API with its real supervisor guest keyframes,
requiring a fresh owner and current-epoch physical pixels. This supplements the
separate real Linux desktop proof and does not replace it. Development recording
`target/evidence/e9-t17-public-restore-dev-r2/report.json` passed both public
restores with zero browser errors. Status remains
`in-progress`; the corrected public path and final cold run must pass again.

### 2026-10-21 — worker — frozen submission at 5ac10674

Claim: two distinct positions in the original accelerated Omarchy Linux/Mesa
desktop restore their coherent native RAM/device, historical disk and GPU state
into fresh workers. Both restored physical canvases exactly match their saved
pixel digests; each restored guest accepts new trusted keyboard input and renders
again. The visible library saves/reopens a point and opens it from the ordinary
demo in a fresh document. Incompatible build/physical host, crosswired disk/GPU,
changed boot identity and lost context are refused while retaining the original
manifest bytes/revision. This proves historical GPU checkpoints, not GPU result
or event replay; that remains E9-T18.

Frozen product/acceptance head:
`5ac10674243b4a690c3930afd63f688dbe55ed88`. From the pristine full clone
`/Users/blamy/Documents/Codex/.e9-t17-proof-cold-5ac10674`, the scrubbed recorder
ran `make verify-E9-T17` with exit 0 in 1925.58 seconds. It ran the transport and
archive boundary tests, `make web-dist`, the built-page 127/0 suite with zero
browser errors, the actual supervisor-GPU adversarial/public-restore regression,
and the original cold Omarchy/Mesa capture/restore/input/library matrix. Exact
commands/environment and the executed recorder are retained in
`/Users/blamy/Documents/Codex/e9-t17-final-cold-5ac10674/`; `report.json` SHA-256
`f699ad01a8411037d240bdbe3f939161096f6fda51a5a7bb2a1ddb6e5c26bfef`
records a clean final checkout and hashes all 2060 evidence files.

The native/Wasm/features/RISC-V/determinism/performance and browser-storage gate
at `709b19717553fdbeb65117d201641aac908b5862` is carried only for unchanged
code and dependencies. Its report SHA-256 is
`3b04d37a30b4abfa69ed8e9626ac2b95204736fc3ff3c6547e7a89f153767ea7`;
the exact five pre-existing quarantined `zicsr-stub` dead-code diagnostics remain
narrowly waived, with strict production linting and the remaining gauntlet green.
No Rust/Cargo, worker, renderer or Wasm code changed. The fresh verifier rehashed
449 native inputs and all 56 worker/runtime files; aggregate runtime identity
remains `be4efb0a789b707ee38cb4aaae0313b1ebb9327aebb1680cab8f3e02ac712917`.
The changed public launcher is proved by the new browser runs, not by that native
gate. Carry receipt: `target/evidence/e9-t17-runtime-carry-5ac10674.json` SHA-256
`67fc8938f05cfc0d5a06aed1fc521e1e6adb4b456821581f97d8d83183a14ec4`.

Real-desktop evidence:

- `desktop/e9-gpu-session-desktop.json` SHA-256
  `18ede0195c3e9677fd4cb0970cdab79eade9dbcc205461053a36fb7592047a67`.
  The points are at transitions 38400921493 and 39351366743. Restoring the first
  removes the later first marker, preserves the original Foot process, and lets
  trusted input create the second marker. Restoring the second retains the first
  marker, excludes the second, and lets new input create the third. The library
  and fresh-document route retain first/third, exclude second, and accept another
  new trusted file write. All four input/clock probes pass.
- The first saved/restored physical canvas SHA-256 is
  `9a64eb8a469be4e312c0ac834322ec881b29ed07b81fa503094ff338f134ab8f`;
  the second is
  `b33c0ac1c42e026d516d9574aad45144bdfc47564e395ec5ae3a751c1099b6b7`.
  Each fresh owner advances saved native epoch 2 to its own epoch 3 and records
  current-epoch drawn retirement. Equal worker-local epoch numbers are not
  mistaken for a shared owner. The authenticated ICount/divider-64 policy and
  declared paced-on-keyboard transition remain intact.
- `desktop/retained-session-objects/receipt.json` SHA-256
  `cf8c13776a81ed178bac24ebdad7bfa3d2f4951bb96f238973ceda84a159778e`
  indexes 1933 exact immutable objects, 343317156 bytes: canonical manifest and
  revision 2, both actual WVGPAIR/native seals, descriptors, configuration/assets
  and complete historical COW root closures. Original bytes and owner were
  unchanged across collection. `desktop/browser-trace.zip` SHA-256
  `bdae749a96614477a76be84157e31b6e6fcb04e3e26be54ac7caf76bda21d96e`
  retains the actual browser interactions and network/source observations.
- `target/evidence/e9-t17-worker-submission-5ac10674.json` SHA-256
  `d8d9a1594afc420cc8f0ef7cb26689355e53e503bf2ee135b1e86bfad4fae4a5`
  records an independent worker rehash of all 2060 files and all archived object
  hashes/lengths, both exact canvas matches and the native carry boundary.

The same fresh standard critic has independently passed the unchanged-boundary
attacks, the new public-route regression/URL case and isolated removal-of-fix
sabotage. Its raw review of the prior failed run remains scoped to that run's
successful capture/refusal observations; it is not substituted for this final
successful recording. Full review of the final evidence and hunk coverage is now
required. Status is `implemented`; production publication awaits verification.


### 2026-10-21 — verifier — VERDICT: verified

Independent critic session, continuing its preserved preflights and predictions;
not the implementer. Product head `5ac10674243b4a690c3930afd63f688dbe55ed88`,
worker submission `97968a538f522da1928af886325345fab567231d`. The submission adds
only task/queue metadata. No implementation was changed by this review.

- **F1/F7 — HELD:** the pristine exact-product-head `make verify-E9-T17` completed
  with exit 0; its checkout remains clean. Independently rehashed all 2060 final
  evidence files, 36 frozen changed sources, 23 executed source copies, 13 executed
  harness copies and all 56 worker/runtime files. Cold report SHA-256
  `f699ad01a8411037d240bdbe3f939161096f6fda51a5a7bb2a1ddb6e5c26bfef`;
  independent `final/provenance-audit.json` records the comparisons. Built demo
  127/0 and zero console/HTTP errors, transport/archive tests and actual short
  hardware/public restores passed. The unchanged native gate, its previously
  rehashed 449 files and 4096-instruction trace carry under the same pinned digest
  `3b04d37a30b4abfa69ed8e9626ac2b95204736fc3ff3c6547e7a89f153767ea7`.
  Only the exact five pre-existing quarantined zicsr-stub diagnostics are waived;
  production linting stays strict. That gate is not used to prove the page launcher.
- **F2 — HELD:** independently authenticated the new 1933-object, 343317156-byte
  closure, both WVGPAIR/component digests, native self-seals/witnesses, descriptors,
  full configuration/clock/profile identities and complete historical COW roots.
  Each root reconstructs the pair's exact disk delta; each sparse RAM stream is
  exactly 1 GiB and native counters equal positions 38400921493 / 39351366743.
  Canonical original manifest SHA-256
  `1bdf7f83c0aee5e2cb7f695e52ee9660802aaaa3bbf69e59eb99c6fb48b25766`,
  revision 2. Archive receipt SHA-256
  `cf8c13776a81ed178bac24ebdad7bfa3d2f4951bb96f238973ceda84a159778e`;
  `final/raw-archive-audit.json` and `final/raw-object-index.json` retain details.
- **F3/F4/F5 — HELD:** in the final real Linux/Mesa trace, public restores
  `call@10535` (trace.trace line 5977) and `call@10909` (6455) return restored=true.
  Fresh distinct owners advance each saved local epoch 2 to epoch 3. Their actual
  physical canvas digests match the original saved values
  `9a64eb8a469be4e312c0ac834322ec881b29ed07b81fa503094ff338f134ab8f` and
  `b33c0ac1c42e026d516d9574aad45144bdfc47564e395ec5ae3a751c1099b6b7`.
  Matching resource bindings, current-epoch drawn retirements and later new draws
  (840→935, 876→975) accompany original Foot PID 773 and the historical file matrix:
  first restore excludes first and creates second; second retains first, excludes
  second and creates third. All four uid-1000 trusted-input/new-file/clock probes
  pass; pause freezes retirement/mtime and resume progresses under the declared
  divider-64 paced-on-keyboard policy. The physical screenshots were visually
  inspected. Seven canonical fingerprints preserve original bytes/revision after
  build, actual host-limit, disk/GPU/configuration and context-loss refusals.
  Desktop report SHA-256
  `18ede0195c3e9677fd4cb0970cdab79eade9dbcc205461053a36fb7592047a67`;
  trace ZIP SHA-256
  `bdae749a96614477a76be84157e31b6e6fcb04e3e26be54ac7caf76bda21d96e`.
  `final/trace-audit.json` gives exact before/after lines, calls and digests.
- **F6 — HELD:** visible default-database Save (`call@11375`, line 6958), Open
  (`call@11387`, 7009) and general-page Open (`call@11467`, 7216) execute the real
  library. Independently resolved recorded DOM snapshots at lines 7002/7047/7280/
  7286 confirm active/selected IDs, point and status. The saved post-restore point
  is at 42325727390, beyond the 39351366743 baseline plus earlier local retirement.
  Reopening and fresh-document navigation retain first/third, exclude second;
  new trusted route input creates another file and more current-epoch GPU draws.
  The library and route restore saved epoch 3 into separate fresh local epoch 4
  owners. Repeated worker-local numbers are valid; global uniqueness is not required.
- **Unchanged adversarial predictions — HELD:** carry the independent RAM/native,
  profile/build, disk/GPU and full boot/image identity attacks; original canonical
  bytes/revision preservation; authentic old-worker callback isolation with retained
  frame/binding/canvas unchanged and a successful current completion; actual early
  and asynchronous-publication context loss; GC, four tab interruptions and twenty
  two-tab races. The prior before-commit loss guard-removal regression and current
  public-query fix-removal regression each fail at the intended defect only.
  The bounded image-text/duplicate and no-debug-URL cases remain HELD. Capture's
  boundary is final owner validation immediately before publication; later loss
  does not invalidate an already committed pair. Earlier failed runs and receipts
  remain unchanged, including the 795dc scope failure; none is restore proof.
- **F8/F9 — HELD:** all 126 submitted hunks are classified: 103 executed, 23
  nonbehavioral/declarative waived, 0 dead, 0 needs-evidence. Coverage SHA-256
  `012454dfbfa4ddf1a528521d2aa4eeb22abcb3ee067467e4ba15a07b708991b3` (`final/coverage.json`). Four bounded UI/route
  cases additionally execute same-session metadata append, New GPU URL assignment
  (request aborted before boot), invalid route and missing-route error reporting;
  exact V8 ranges are retained. No extra Linux boot or native suite was run.
  Only this verification log/status, supported AC checkboxes and regenerated queue
  are committed. Final receipt: `target/evidence/e9-t17-standard-verifier/5ac10674/final/receipt.json`.
  Receipt SHA-256 `3ce9f9c5b2eb723e3732114c2b9c2af96bd95608f57a0f3a5085376ff6ceed63`.
- **SUITE:** retain `make verify-E9-T17` and its deterministic transport/archive,
  actual worker/public-restore and real-desktop regressions. The one-off bounded UI
  probe over an archived graph remains evidence, not a portable permanent test;
  the existing verify target supplies the recurring machine/library proof. GPU
  event/result replay is E9-T18; no bar-glyph or latency claim was added.

Commands: independent read-only archive, trace/DOM and provenance auditors plus
`node .../final/ui-coverage.mjs` (four cases, zero Linux boots); exact commands and
hashes in `final/commands.json`. Task policy is run before queue generation;
`final/workflow.json` and `final/commit-result.json` retain those results. Prior
HELD preflight/raw receipts remain intact. No rr is required under AGENTS' waiver;
no implementation fix, deployment, merge or new task was performed.

### 2026-10-21 — worker — production publication

Published verified runtime plus roadmap/task metadata at source commit
`1f2a93db1210409e2277e14b9a9944573af5062d` using
`bash tools/deploy-cloudflare.sh` (`--branch main`), deployment `9a0c435f`.
The direct main URL is <https://wasm-vm.pages.dev/>. The built-page recheck passed
127/0 with zero errors and a verified T17 detail. No worker/Wasm/runtime bytes
changed after the frozen acceptance; only declarative roadmap, task and bundle
metadata changed.

`node target/evidence/e9-t17-release-check.mjs target/evidence/e9-t17-production-9a0c435f-r2`
then checked the main URL itself: all 64 assets (including all 56 pinned runtime
files, both case-study pages and marketing CSS) exactly match the deployed bundle;
the actual in-page ISA harness passes 127/0, the public roadmap badge is verified,
and there are zero console/HTTP errors. Browser trace/screenshots and executed
checker are retained beside `report.json`, SHA-256
`220651bac65bd2dcb5fc7d84a5b2a35739453153daa2662c91764f26972d5a7e`.
The first checker attempt's 64 hashes passed but its visible-click action targeted
the launcher's hidden legacy harness; that failure remains separately recorded.
The corrected checker invokes the existing handler as the frozen acceptance does.
Deploy log SHA-256
`9d06faae4039b2239648136cf566c5b3603277db514fae34d2fa017c56900ee4`.
Expected R2 manifest staging rewrites were retained as evidence, then restored to
the committed local build form. The PR remains open; no merge was performed.
