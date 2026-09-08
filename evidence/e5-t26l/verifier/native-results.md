# E5-T26l — frozen native/portability and adversarial results

**Native selection boundary HELD; final L verdict NEEDS EVIDENCE from the new cold/reuse browser record.** No L/F status change or commit. Heavy work ended at **2026-09-08T13:42:48.990Z**; no further compilation/browser launch is planned during the coordinator's timed reuse.

## Exact source and independent recording

Reviewed the full frozen diff from activation `b1024e77966d2f844c93cca5fc7a1bbe0925e166` to candidate **`42bb34d854aca091a3940191a8da3b7aff765cad`**. Core and R1 bytes match the source-closed preflight. Stage → cancel-stale → recount → refresh → pop is unchanged from that reviewed design. Source and dist release WASM both hash to `264db1b1f82664e115a14d68502977610a07339c94824f8a740c65261f242b54`; no shared runtime source was modified.

One `git clone --no-local --no-checkout --single-branch --branch codex/e5-t26l-live-compile-priority` into `/private/tmp/e5-t26l-verifier.WIYRcw/repo`, then detached checkout at the exact candidate. No alternates, initially empty porcelain status, and no existing clone-local or selected Cargo target. Downloads/toolchain caches may be reused; built targets were not.

The recorder removes inherited `CARGO_*`, `E5_*`, `RUSTFLAGS`, `RUST_LOG`, `RUSTDOCFLAGS`, compiler wrappers and Make flags. Only the fresh `/private/tmp/e5-t26l-verifier.WIYRcw/cargo-target` and build parallelism4 are introduced as Cargo settings. In this invocation the only matching inherited key actually present was `RUST_LOG`; names, not secret environment values, are recorded. Toolchain: Rust1.96.0/aarch64-apple-darwin, Node24.20.0, with wasm-pack version retained.

The exact command `make verify-E5-T26l-runtime` ran **13:37:37.379–13:40:17.115 UTC**, exit0. Final worktree status was still empty and all initial source pins were unchanged. The recorded preflight path error happened **before any Git/Cargo launch** and is retained separately; it is not a failed candidate run or second clone. All nine command-log digests in `pristine-result.json` were checked.

## Prediction / changed-hunk coverage

| Ledger | Disposition and direct evidence |
|---|---|
| P1 — bounded mutation | HELD. All five new queue fixtures execute in pristine log lines217–223, covering exact visits, unchanged payload/order/allocation/counters/recount, empty/equal/saturated values, missing/reset hits and cancellation. The helper body changes only hotness; comments and cfg/visibility are source-reviewed configuration, not a new runtime behavior claim. |
| P2 — pump placement | HELD. Frozen `lib.rs:4121–4124` is after recount and before selection. Cross-pump and stale/incoming tests reach it; no admission/cancellation reorder. The no-new-staging path is explicit rather than inferred from a public queue composition. |
| P3 — real Machine backlog | HELD. Pristine log586–588 selects `0x8000007c` first after staging32 then0 and attempts8 then8. Independent interpreter registers/PC and full-RAM digest agree at fixed retirements. RAM SHA-256 `e26a6c58d7f68718119123775969c6e4cec179dccaa0fbd7db0154b760e387a6`. Mutation below proves the assertion depends on the production refresh call. |
| P4 — stale/reset safety | HELD. Stale resident plus incoming FIFO and fresh same-PC integration passes at log588–589, with fresh `0x8000009c`, RAM `b29bb15887c0f21af7c7c88bf7c1dab120c5c56fd8d55798a78d242ec785eede`. Queue byte refusal/reset tests and unchanged actual-WASM page/SMC/permission refusal execute separately. |
| P5 — guards/budgets/progress | HELD. Existing-backlog disabled/missing/zero-attempt fixture passes at log592; finite-burst/backpressure and cooperative eight-attempt/64-staging tests pass. The novel outer-scope case below independently covers no budget renewal by internal calls and refresh at a zero-work final pump. No numeric long-run counter equality or starvation freedom is asserted. |
| P6 — gates/sensitivity/portability | HELD for the prescribed runtime target: one clean clone, sensitive sabotage, one novel case, and the closed worker recording independently agree. No new ignore or fixture-only runtime replacement. |
| P7 — browser | Built-demo portion HELD by independent PNG inspection and JSON/digest audit. Fresh authenticated cold + actual physical-play reuse remains pending; no live/unfinished record is interpreted as a result. |

Both the full closed worker log and independent clone result contain **338 core unit +35 integration =373 native tests**, the **127-ELF** instruction-trace differential, no_std wasm32 build, **43 actual WASM passes** (34 JIT parity/cooperative-budget +6 discovery +3 capacity), and **63 Node passes**, with fmt/clippy/syntax successful. Pristine summaries occur at lines578–800 and the runtime completion at875; worker summaries at376–623. New native tests use a stalled recording executor to expose actual Machine selection, not compiled execution; the separate real WASM executor tests supply that coverage.

One pre-existing long externref churn test stays ignored and is not counted as passed; its annotation is unchanged. The pre-existing `hart_ctrl` unused import, expected `should_panic` register tests, and build's wasm-bindgen fallback are retained, not new failures or suppressed diagnostics. No unrelated warning cleanup or old F/K experiment rerun.

## Sabotage — original test is sensitive

Only the two-line production refresh call was removed in the scratch clone. The patch is retained.

- Selection regression exits **101**, fails at `async_compile_pipeline.rs:703`: actual **`0x80000020`** versus required **`0x8000007c`** (`sabotage-selection.log:19–31`). Earlier fixture/setup/parity assertions had reached this exact selection point; this was not a build failure.
- With the **same mutation**, the stale/fresh same-PC regression exits0 and keeps the original RAM digest (`sabotage-stale.log:16–20`). Removing ranking refresh does not remove stale protection.
- The mutation-created unused-method warning is expected only in this mutant, not attributed to the frozen implementation. Exact frozen lib bytes were restored before the next check.

## One novel attack — outer scope, exhausted budget, zero-work final selection

`novel-outer-scope.patch` adds one test to the existing integration fixture **only in the scratch clone**. After the first eight submissions, multiple interpreted inner runs plus a zero-work inner run and outer close cannot replenish that scope's budget. In a new external scope, zero guest instructions and zero newly staged nominations precede the sole final pump: it must now choose the accumulated-hot resident first.

Observed **exit0** at `novel-outer-scope.log:5–9`: original scope stays at8; renewed zero-work final pump stages0/submits8, first `0x8000007c`; retirement stays **574**, RAM SHA-256 `4c2b6fc6fa51b0a242cd1d99da043e7fc21d37139208f8114ccace42d413f920`. Separate interpreter snapshot equality and unchanged generation/dedup are asserted. The queue/runtime source pins are the exact frozen ones; only the test file differs afterward.

**SUITE:** at coordinator request, deliver this useful formatted 63-line test-only patch for later promotion. It is not applied to the shared tree, and does not require a second pristine clone. The `.rs` file is the original readable fragment; the `.patch` is the exact formatted test used for the recorded run. No additional attacks are requested.

## Built demo / limits

I independently viewed `demo-42bb34d8/demo-suite.png`: visible L **IN PROGRESS**, 126 total/passed,0 failed. JSON gives empty non-favicon console/page/HTTP errors; its retained console log contains a favicon404, not an all-console-zero claim. The release build log completes and stamps SW `0a9e1be7c8f2`. Shared pre-existing dirty dist manifests remain outside the owned release/cleanliness claim; the **runtime-only clone** itself had no tracked build dirt.

R1 is covered by the revised wrapper test (actual absent-top-level-head success shape, exact nested binding, mismatch refusal and checked aggregate head). Real success/failure browser records still require later review. The composite's cold/reuse leg is not yet HELD. Prior F/K/H/I/J/T19a and unchanged architecture/functional boundaries carry; F's two-second failure is not waived, and no causal speedup is inferred.

## Digest audit

All listed file digests were mechanically recomputed. Each recording JSON additionally pins exact commands, times, statuses and source/patch hashes; nested log hashes and shared-source equality were checked. Paths are repository-relative.

| Artifact | SHA-256 |
|---|---|
| `evidence/e5-t26l/verifier/preflight.md` | `9abb455d8c3ba2f0e35a25de0a880fb5a6c388190984315c235ce0c175080458` |
| `evidence/e5-t26l/verifier/attack-plan.md` | `b33c844f6aefe7bbd570e224cdb5d05dfd00cdd3ba8fe077bbe84e03ce832a3e` |
| `evidence/e5-t26l/verifier/record-pristine.mjs` | `95bec5c33db688de589edca2b1edbbcbb628b60db1864c3af879d599254b295a` |
| `evidence/e5-t26l/verifier/recorder-preflight-error.md` | `a3aef151c217282d787c83fec9d5cbef962820692b83becbacb801385264ade2` |
| `evidence/e5-t26l/verifier/pristine-invocation.json` | `751a9c712ad43cdb317da797792e7c44a884b97828aed487e744dd767ed9064f` |
| `evidence/e5-t26l/verifier/pristine-result.json` | `baae2ad39c65a10ed0b9fdbce7c23428f5d3a4d960f2fdd2fd2c05f8e530adb4` |
| `evidence/e5-t26l/verifier/pristine-runtime.log` | `caadac154049d9e7e24cacf3f4f9006d3ebca216993343935d9235969937dfc6` |
| `evidence/e5-t26l/verifier/record-focused.mjs` | `ad06891f5b27c86106ca032ae78141b3624721e6d234baa7e332b292be952e91` |
| `evidence/e5-t26l/verifier/sabotage-selection.log` | `f75c611f2486a2b078287ca51f1ecb854f03835d79617295e803f703db361876` |
| `evidence/e5-t26l/verifier/sabotage-selection.json` | `341c7a58ac58e7f16a980c4a0fbf655033a501ff1d7b7919556fb70b4d9079a2` |
| `evidence/e5-t26l/verifier/sabotage-selection.patch` | `6a6557515e1c558aac71cfa1f66454dd852726212761ac17683b25cb73055a44` |
| `evidence/e5-t26l/verifier/sabotage-stale.log` | `d031ca47c641489546cbc7b51388d5a8e9fcaef096b32df9235d9e8c19ffde34` |
| `evidence/e5-t26l/verifier/sabotage-stale.json` | `d1253e38e82133354d952f0c1e04f042ab5e3281301df7c599989101d72bf4b4` |
| `evidence/e5-t26l/verifier/novel-outer-scope.rs` | `6d800d54521480d5a93fb4baca7ee013c33e17e8f270a3635673db9c29efa8b8` |
| `evidence/e5-t26l/verifier/novel-outer-scope.log` | `d50a7e1c1a9050db8c8c8795831e1b9e485288647c400a624b8bfef0e7490505` |
| `evidence/e5-t26l/verifier/novel-outer-scope.json` | `f0eca5d78edfc8e7e42a1b5e988fa05b47768159b34c424291f8e6931e93851f` |
| `evidence/e5-t26l/verifier/novel-outer-scope.patch` | `1b46a5e59ae5403dbddec8ff17a8b269e38f0418612a8b118e77abe937a4db9a` |
| `evidence/e5-t26l/gates/runtime-42bb34d8.log` | `ec25fdaf1bbf1a6fdde2db7f21a1188b0467a924d6b15402c0b682120d5b3e87` |
| `evidence/e5-t26l/gates/web-dist.log` | `3758803637d9238d831902f6f7b2a3b32d9141f044ecaff2e93f33315ec22dda` |
| `evidence/e5-t26l/demo-42bb34d8/demo-suite.json` | `56270e1205dfc91dc39aec3888f570667d87ba8452045309e34ab83d8042a164` |
| `evidence/e5-t26l/demo-42bb34d8/demo-suite.png` | `880e5fb480c41a0bbdda5f354e04bfcdc66780f5dc12268f0c8fb3ad2af05181` |

