---
id: E9-T22j
epic: 9
title: Preserve parked owned block chains in full exact-GPU keyframes
priority: 524.922025
status: implemented
depends_on: [E9-T22b, E9-T22h]
estimate: S
risk: high
capstone: false
---

## Goal

Allow a full exact-GPU keyframe at a fixed guest position to preserve an
already-owned, authenticated virtio-blk read parked after its base-chunk
completion, just as the delta keyframe path already does.

## Boundary

One native snapshot admission inconsistency. Keep the existing exact-session
section-20 encoding/validation and device completion semantics. Do not service
the parked chain, retire an instruction, move the 50M checkpoint, force a delta,
change the original assets/profile/storage limits, or weaken ordinary
non-session snapshot quiescence. E9-T22c owns the later complete workload run.

## Acceptance criteria

- [ ] With an actual owned block request accepted at an exact before-boundary,
      prove the broker has no pending request while the resident chunk, read pin
      and parked descriptor remain. Full and delta exact-GPU captures both
      succeed at the same unchanged position.
- [ ] Restore each capture into fresh compatible machines and show identical
      broker/cache/read-pin/parked-descriptor state. The next native service
      publishes DMA, used-ring and IRQ once, without a second host request or
      double completion; recording and replay witnesses agree.
- [ ] Keep unsupported/malformed section-20 data and non-exact torn snapshots
      fail-closed. Exercise the affected wasm/browser keyframe path, zero
      console errors and the live demo suite/roadmap gate.
- [ ] Freeze high-risk native/wasm/browser/guest evidence at the exact head,
      run the prescribed local gauntlet and final cold-clone proof, then obtain
      a fresh actual Daybreak verifier verdict and publish the browser-impacting
      result to the main Cloudflare Pages URL. No merge is authorized.

## Deterministic acceptance

`make verify-E9-T22j`. Implement a bounded native parked-chain regression and
an affected built-browser exact-GPU capture/replay proof; preserve the original
E9-T22c failure as the long-workload repro, not this task's acceptance shortcut.

## Adversarial verification

Invert the full-keyframe admission guard, corrupt a parked section-20 descriptor,
vary the completion order and chunk identity, and compare full/delta/restored
states at the same exact coordinate. Attempt to double-service the chain and
to admit a legacy torn snapshot. The verifier must inspect the executed diff,
one bounded novel attack, and a pristine-clone run at the final head.

## Verification log

### 2026-10-23 — worker — native stack and main production publication

Draft PR [#613](https://github.com/BLamy/wasm-vm/pull/613) is open above #612 with base `codex/e9-streamed-gpu-browser-replay`; `gh stack link` appended it to GitHub-native stack #598 (36 PRs), without merging. The first two-PR link attempt was rejected because it would omit older stack members; the full-chain link succeeded. It warned that the existing bottom #575 base update was invalid, but #613's base and open/draft state were checked directly. Cloudflare Pages production project `wasm-vm`, branch `main`, completed deployment `4125e503` at `https://4125e503.wasm-vm.pages.dev` and canonical `https://wasm-vm.pages.dev/`; deploy log `target/evidence/e9-t22j-main-publication/deploy.log` SHA-256 `96a0e044f52208ea24b40f2a067153f3998aac38a66eafec95727320b010f8c8`. The deploy authenticated all seven content-addressed public R2 boot artifacts and uploaded the changed Pages files. Its temporary manifest rewrites in `web/dist` were restored locally, leaving the committed tree clean.

The canonical built-browser proof `target/evidence/e9-t22j-main-publication/demo/report.json` SHA-256 `d7d0f184118e90bc89c87fe1f18a91581b7e008e1551365fe4378dc5562772a6` fetched and byte-compared five public app/probe/Wasm assets against committed `web/dist`, ran 127 tests with zero failures, exercised the parked full keyframe and replay on physical Apple M4 Max Metal, found both visible live pips, and reported zero console/HTTP errors and no mobile overflow. Browser trace SHA-256 is `cf1eef1c03c018fd31687e5e0628817a13c2a1ef0b3196848b8979f232c7f81c`. Fresh actual Daybreak still owns the final independent acceptance and coverage verdict; this worker publication does not mark J verified or claim E9-T22c/d qualification.

### 2026-10-23 — worker — exact-head parked-chain submission

Runtime and deployable implementation is `37927798e`; the harness-only evidence-path correction is `135c0f24afce32d46816e9a0fede94fa86a0ae21`. At that clean head, `E9_OUT=target/evidence/e9-t22j-final-135c0f24a make verify-E9-T22j` passed. The native log SHA-256 is `99889e4e2c783f3a591ed68e0769aaf27166a2fc599de4fd2feff75503ea6c83`; full and delta resume SHA-256 values are `b14d1ccac383f68b4d0654fb81ceeb36c2bfc4896c4225d3ad50ac9648305a62` and `85f89316aadfec4f6a1a72782793f2ce9626fab19e8dc9f6fc6d45f728c977bf`, and the guest trace is `target/evidence/e9-t22j-final-135c0f24a/native/guest.trace` SHA-256 `692f7ef965d0577f3d1de75d177bfced16d9645e5da0725cee1fb7828f15bd8f`. An actual owned virtio-blk read at unchanged before-position transition 74/retired 74/sequence 1 had an empty broker but retained its resident chunk, read pin, and parked descriptor. Both captures restored equivalent broker/cache/pin/parked state; the next service published guest DMA, used ring, and IRQ once with no host reissue. Recording/replay trace witnesses matched. Corrupt section-20, wrong chunk, valid-pin crosswire, network-only exact, and legacy nonexact parked variants refused without a torn snapshot.

The built Chrome/Metal proof `target/evidence/e9-t22j-final-135c0f24a/browser/report.json` SHA-256 `44caba3936a9b2ad238ee60dd00c90dacf30a996a376df4735d04787f531a659` recorded 260 receipts/256 real block reads, took the full `block-mid` keyframe with one parked chain after owned completion, reopened paged authenticated history, and replayed explicitly from that checkpoint through the next service and final digest `894b33e00073ba1592385ea4b61a883764451faf5e4776afb0f1f547df436d51`; error/missing/external lists were empty. The demo report SHA-256 `3be565c4c000789ec784764b779cfdfc1116b316e11074e12143f2b67e8c25ec` records 127 passed/0 failed, live GPU pips, zero console/HTTP errors and no mobile overflow. This bounded proof does not claim that the full Alpine or Omarchy workloads have qualified.

`make ci` passed format and strict production workspace Clippy but stopped at exactly five pre-existing quarantined Zicsr-stub `dead_code` diagnostics; its log SHA-256 is `dc98b81714a87727e6494d3162945db1d51dc23fd88a0175539231b1411145db`. The isolated `cargo clippy -p wasm-vm-core --no-default-features --features std,trace,zicsr-stub --lib -- -D warnings -A dead_code` passed. The remaining prescribed `make test wasm features test-riscv riscv-tests-suite determinism perf-smoke` passed at the same head; log SHA-256 `17442b39f062744d13556ef6dab542f8f14c379237d26fb820342d0995e527ea`, including 128/128 committed RISC-V corpus and 57.5 MIPS against the 15 MIPS smoke floor. The final pristine clone with scrubbed Cargo/Rust flags, `E9_OUT=/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905/target/evidence/e9-t22j-cold-135c0f24a bash tools/verify/cold_clone.sh --parent /private/tmp verify-E9-T22j`, passed. Its log SHA-256 is `c023d47b6bf40240ed1760266656a417c06f3aaec67524c407e40f93d23613b8`; independent browser and demo report SHA-256 values are `32e29bb0fc11e7e0045f49d3effa501230f57436364af23c29323cb2409809ef` and `a65160fc5bc440024d334010d745885de9f4edf7839acb6e42bfc7e9041ed1b7`. The native stacked PR, main Cloudflare publication, and final fresh actual Daybreak verdict remain the publication/verification steps before `verified`.

### 2026-10-23 — worker — activate after E9-T22c exact failure

E9-T22c's full Omarchy cold run at `29fade9013c4a48e5ffd6736f27f756f3ca53e76`
failed its full keyframe at transition `4500000000` with one parked `Chunk`
chain after owned completion sequence 881. The exact report, saved prefix and
fresh Daybreak decode are cited in E9-T22c's blocked entry. This task isolates
the full-only runtime admission inconsistency beneath C; it claims no fix yet.
