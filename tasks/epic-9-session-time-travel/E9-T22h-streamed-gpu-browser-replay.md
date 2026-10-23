---
id: E9-T22h
epic: 9
title: Run the complete GPU replay chain through browser consumers
priority: 524.922024
status: verified
depends_on: [E9-T22g]
estimate: S
risk: high
capstone: false
---

## Goal

Run the complete GPU replay chain through browser consumers without weakening the original exact-history contract.

## Boundary

One browser integration boundary for authenticated long histories: timeline seek, private GPU replay and local archive verification use the bounded readers/executor. Entire real-workload qualification remains E9-T22c.

## Acceptance criteria

- [x] Open and navigate a long production GPU history using authenticated bounded window admission while preserving latest-owner cancellation, selected state, branch eligibility and exact event navigation.
- [x] Execute EVERY window from the actual initial checkpoint to final end in a recorded whole-chain proof with zero live replay egress; compare full native/RAM/disk/device/clock, pending/output queues, actual renderer checkpoint content/identity and global event cursor.
- [x] Authenticate all long-history content and witnesses in local export/import and GC/retention, including a middle corruption and incompatible profile. Keep previous selected view/source history intact on rejected or cancelled work.
- [x] Complete scoped high-risk browser/local gates, update the visible demo and publish to the main Cloudflare URL; retain final pristine evidence and a fresh actual Daybreak adversarial verdict including novel attack and sabotage.

## Deterministic acceptance

`make verify-E9-T22h`. Planned single target including `node tools/verify/e9-gpu-whole-chain-replay-browser.mjs --from initial --to end --zero-egress`; no passing target exists yet.

## Adversarial verification

Attempt late/overlapping windows, worker/context loss, rapid seeks/cancel, stale epoch and malformed middle payloads. Interrogate actual readbacks and renderer checkpoint bytes, not just a logical endpoint caption. No full cold-Omarchy, fixed-workload or performance acceptance follows from a small integration fixture.

## Verification log

### 2026-10-23 — worker — complete bounded browser chain submitted for independent verification

Runtime and deployable implementation is commit `7c17d868ffc898ce6adfa126f81fa9725f2c0f97`; harness-only commit `7b46cec346b6001114372ffa45756c4353e3e439` orders the generated Docstream build before the cold-clone docs check. No runtime file changed between those heads. `E9_OUT=target/evidence/e9-t22h-submission-1 make verify-E9-T22h` passed all 22 orchestrated commands at the implementation head. Report `target/evidence/e9-t22h-submission-1/report.json` has SHA-256 `be2d98cd8d4b84bae55fb03769478b9d67534bbdd7fcc9edf8c8bd5bba9c5ba7`; its file ledger hashes 1184 retained outputs. Raw `make ci` exited 2 on exactly the five historical quarantined Zicsr-stub dead-code diagnostics. Strict production Clippy, the narrowly waived stub variant, and the remaining native/Wasm/RISC-V/determinism/perf-smoke wall all passed; gauntlet report SHA-256 `03e3bfc5460ef9a5197de469c945db8ab5ac7bea41135368ce950859ec2eaa12`. Do not describe raw `make ci` as a clean pass.

The actual Chrome proof from separately recorded production GPU histories is `target/evidence/e9-t22h-submission-1/browser/report.json`, SHA-256 `1b309fc366adc39d063d3373bb6539decd989e805e4f2f8317246d5b2943fb2e`. Beginning at the real initial frame, one private GPU worker replayed every witnessed interval to the real final endpoint: 4359 input receipts in two windows, 260 block receipts in two, and 38 physical-GPU receipts in three. Full native/RAM/device/disk/clock state SHA-256 values match the original recorded bytes (`5c395ee98ea939a143bc4cdca015253dcad13eca652fca5f9723852eb562a156`, `7cf35ee6b970a10b08d8ee1310bf99a984fb7368f8caa903d2daac4331185c70`, `a3e819ba87e6aad7e0426607b9a0a21951a8402b8b9060c799d90f57f8402529`), with global event cursors 4359/260/38. It compares pending/output queues, saved renderer state after only the required fresh-epoch rebase, and a real 64×64 green readback pixel `[0,255,0,255]`. Each long history exported, imported, reauthenticated and survived GC; middle-object corruption and incompatible profile were refused without changing the source. Exact event 2048 navigation, healthy branch capture, rapid seek cancellation, and a corrupted-middle rejected seek preserved the incumbent selected view/branch eligibility. Replay network egress, browser console errors and HTTP errors were zero. The built demo report `target/evidence/e9-t22h-submission-1/demo/report.json`, SHA-256 `fdd1558ddc2f1045b2d46509e502db5af777aaab7e99727b9c85ffbdb35c00a5`, has 127 passed/0 failed, three live pips and no mobile overflow.

The first cold clone failed only because the harness checked generated `web/docs-content/catalog.json` before building it; that failure is preserved at `target/evidence/e9-t22h-cold-1/report.json`, SHA-256 `d0d804af7b412830589eafb3f1398df38f2ab3605d9a966f260f79b8ec57fb88`. The corrected pristine source projection, with scrubbed Cargo flags and fresh npm dependencies, passed all 25 commands at the harness-only head. `target/evidence/e9-t22h-cold-2/report.json` SHA-256 `697ac90d1218f22eb44402986da017a52bf74892a57ef603fddc6a234240d441` has 1183 hashed outputs, exact rebuilt runtime bytes and a clean checkout. Its independent browser report SHA-256 is `d9b7e3545e4d9a0912ac364bbee0d854638f20540d33821ee06ec895e22a124e`; its demo SHA-256 is `1c171d17d6c08e2c00f8caaccc131d85021dc2718c9216b16dca60a67782c895`. These are worker claims awaiting a fresh actual Daybreak critic, native stacked PR submission and direct main Cloudflare publication. They do not qualify the full Omarchy workload or timing budgets in E9-T22c/d.

### 2026-10-22 — worker — ordered prerequisite from authenticated cold-boot failure

The fresh actual Daybreak capacity review is retained at
`target/evidence/e9-t22c-daybreak-capacity/report.md`, SHA-256
`a341f3ffc80ca87b347d97cc1ea6e2270323e1004e752fcd6db47a4a2f9d53ec`.
Its controller completed on requested/returned `gpt-daybreak-blue-latest` with
`daybreakBlue`, fallback disabled, no errors. Corrected original Omarchy attempt
3 rejected receipt 702 at transition `2207340032`: `67179533` lifetime envelope
bytes exceeded `67108864`, although the resident pending+candidate window was
only `524420`. All 256 block envelopes alone exceeded the lifetime bound. The
retained production store authenticates an exact durable prefix through 701;
this is a runtime prerequisite finding, not C qualification or performance.

Keep the original assets, pure ICount/64 cold profile, fixed 50M maximum
checkpoint gap, workload amounts and numeric budgets. Only this slice may enter
the active lane after its dependencies are verified. Prospective checkpoint,
witness-extension and storage limits are not waived; independently reproduce
any additional blocker and give it its own ordered S boundary. All PRs remain
open; no merge is authorized.

### 2026-10-23 — fresh actual Daybreak final-publication verifier — VERDICT: verified

- P0-P11 local high-risk charter — HELD. Runtime/deployable head `7c17d868ffc898ce6adfa126f81fa9725f2c0f97`, deployed source/claim head `51a5a1b71ecc095b92820ed876e83d37119702fc`, and all dependency/evidence boundaries remain unchanged. Fresh local report `target/evidence/e9-t22h-daybreak-local/report.md` SHA-256 `f09a3402e3bab5d91c456a6666eea4344baba174e36d2a37fd0ef3d2f51668a7` and routing SHA-256 `d076bac0facb849f258c86a2d476c1ececb828039a728c3b1f982be19e2a8ac9` record requested/returned `gpt-daybreak-blue-latest` on `daybreakBlue`, no fallback/error. Submission report SHA-256 is `be2d98cd8d4b84bae55fb03769478b9d67534bbdd7fcc9edf8c8bd5bba9c5ba7`; corrected 25-command pristine report is `697ac90d1218f22eb44402986da017a52bf74892a57ef603fddc6a234240d441`; failed cold-1 remains preserved at `d0d804af7b412830589eafb3f1398df38f2ab3605d9a966f260f79b8ec57fb88`. Raw `make ci` remains exit 2 only on five historical quarantined Zicsr-stub dead-code diagnostics and is not described as a clean pass.
- P12 native stack — HELD. Sealed receipt `target/evidence/e9-t22h-main-publication-1/receipt.json` SHA-256 `a7ab3e4b73c93bf5044fc4b3913d3a45c0edb443a8ea007e1bbac2fc1fda2266` has exact status `worker-main-proven-awaiting-final-Daybreak-verdict`. Pushed PR #612 remains recorded draft/OPEN at head `cdea08011a868a40878febf36f469814fff30040`, directly above #611 in the local native-stack ledger; neither head is in local `origin/main`. The only deployed-source-to-PR diff is the one-line precisely located `/favicon.ico` console exception in `tools/verify/e9-gpu-reader-stream-demo.mjs`; executed and committed source SHA-256 is `a7d2e25b26d0025f7c9cd3761861b8f8c232a3dbf00b0733ff2bcdce4fd5ffcc`. No runtime, deployable or evidence dependency changed, and no merge, queue, push or remote mutation occurred.
- P12 canonical publication — HELD. Cloudflare Pages production project `wasm-vm`, branch `main`, deployment `9bafecaa` (`https://9bafecaa.wasm-vm.pages.dev`) and canonical `https://wasm-vm.pages.dev/` are fixed by deploy log SHA-256 `7846a1870ef3eec243e0eca62376ccca5328924c1aab4856329eb42106d77d09` and deploy-script SHA-256 `5814fd32da476c23d386a7c81826af8e51c8d1c4fca70df2dadddecf7bb54435`. After freezing predictions, 17 canonical GET bodies matched committed `web/dist` or the five sealed published sidecars; seven content-addressed R2 objects returned exact HEAD lengths without downloading large bodies. Independent ledger SHA-256 is `10b88bfdd19bc4b7aeecc6f9a16108aebf5a058bcce771bc196ca5d4a87f91ce`; the worker's 19-asset report remains `11069928b7f1b385b7a881db57490f2adfa55198beb0960f5e978f29b3444749`.
- Public browser proof — HELD. Successful canonical report SHA-256 `8637e08b98d62efd3eca347cfed522980e045cc826fc1a4d99a4cec9b940ec62` and trace SHA-256 `f3c73f3c5e987cbb2bb2feab60e77ce83136921c3e6276a5dd09539754258817` retain 127/0, authenticated 4359/260 reads, 2/2 whole-chain replay windows and event cursors, physical-GPU replay scope, three live pips, no mobile overflow, and zero non-favicon errors. Failed-attempt report SHA-256 `33fa2e23bcc6d1ce0d9853f24349757b7f8a3b962422a86e2fe923b59296bd8f` completed the suite/probe and its trace pins the sole error to `https://wasm-vm.pages.dev/favicon.ico`; AGENTS.md permits it. The retained trace removed concrete doubt, so no extra browser pass was run.
- Final verifier artifacts: `target/evidence/e9-t22h-daybreak-final-publication/report.md` SHA-256 `feb49782725d000a32b5f9c2621e2428abba5b22341c8a67968536168f305be5`; `report.json` SHA-256 `220468c1903516b10dcfec41cc27370907cbe87c99c9f11ebf6a98d1f2700ee1`. Scope is E9-T22h only: no E9-T22c full Omarchy qualification, E9-T22d performance, E9-T23 or E9-T24 result is awarded. SUITE: retain the existing deterministic/browser/cold artifacts; this incremental publication verifier adds only the canonical byte/R2 ledger and no duplicate promoted test.
