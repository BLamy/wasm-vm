---
id: E9-T16
epic: 9
title: Seek and reverse-step with cancellable replay-forward
priority: 524.916
status: implemented
depends_on: [E9-T14, E9-T15]
estimate: S
risk: high
capstone: false
---

## Goal

Reach a selected recorded instruction by restoring an earlier keyframe and replaying forward.

## Boundary

Keyframe lookup, exact run-to-target and seek request ownership. Rapid scrubbing cancels superseded work; a stale response cannot replace the latest selected machine.

## Acceptance criteria

- [x] Targets before/after events and between keyframes reach the same state digest as a from-start replay.
- [x] Forward-step and reverse-step use precise instruction semantics, including traps, WFI and boundaries sharing an event position.
- [x] Rapid alternating seeks terminate or cancel within the declared bound; only the latest request publishes state, progress and its rendered result.

## Deterministic acceptance

`make verify-E9-T16`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Issue 100 seeded forward/backward seeks with overlapping requests. Delay an old seek completion and prove it cannot win; independently derive target digests by replaying from the initial checkpoint.

## Verification log

### 2026-10-20 — worker — exact-head claim submitted

Product commit `eff226c9473b78f6782f3e0a6481fea436290a98` implements bounded exact replay quanta, position and transition fences, keyframe selection/restore, and a serial latest-request seek controller. The committed demo runs a saved Alpine guest fixture and publishes its selected frame only after the replay and offscreen render complete. The final recording demonstrates the five requested before/after and between-keyframe positions against independent from-start SHA-256 state digests: transition 0 before events (`27e546c0…`), after each of two same-boundary events (`7d516ec0…`, `1024d1ef…`), transition 65 from `delta-1` (`469c43c8…`), and transition 2,000,163 from later `base-2` (`e1ed4eb9…`). Forward and reverse steps land at transitions 2,000,164 and 2,000,163 with exact from-start digests. Native directed tests additionally prove WFI/interrupt boundaries with transition/retirement sequence `[0,1,1,1,2]` and an ecall trap at transition 1 with zero retirements.

- `make verify-E9-T16` passed at the product head: three new native seek tests and all 21 deterministic replay regression tests, rebuilt `web/dist`, a Playwright 127 passed/0 failed suite, zero page errors or missing assets, a live seek roadmap pip, a screenshot, and a browser trace. The 100 seeded alternating requests all cancelled their predecessors within 0.54 ms, a request during keyframe restore cancelled within 0.39 ms, and the delayed old render never published; only the final request published a machine, progress, and rendered text. Evidence: `target/evidence/e9-t16-verify-warm.log` SHA-256 `c1a8ba59f5b80340795f2c557b52a38773db1cae73a561e094c426d2df981e62`; `target/evidence/e9-seek-final/report.json` SHA-256 `6322ebe1228dad8f7aebcb16681b7668aaa0e8e601e0f079ff7a03bf38474dd7`; `target/evidence/e9-seek-final/browser-trace.zip` SHA-256 `e2c775dd4ef532aad6d4d69a9f5f8850dfa5fdbabbefbaa42ca9a6ebb7b702b7`.
- A fresh clean clone at `eff226c9473b78f6782f3e0a6481fea436290a98`, with `RUSTFLAGS`, `RUST_LOG`, and `CARGO_*` removed from the environment, passed the same `make verify-E9-T16`. Its worktree remained clean. Preserved evidence: `target/evidence/e9-t16-cold/command.log` SHA-256 `a066f97622b032f09ff4eb821d088ebdf3ca5c6d3ea849f02eed69e4c9d1ea49`; `target/evidence/e9-t16-cold/report.json` SHA-256 `eae4487f5cbdb5ff45d095facfeb974b413d9e43db824697068317a4d9abb298`; `target/evidence/e9-t16-cold/browser-trace.zip` SHA-256 `3bc8120ed55653fc42fdd8f1dc83645e1bcfc2179ac55873f85dd432875b0d75`.
- Two additional public-browser stress runs replaced only the probe's deterministic LCG seed with 29 and 991; their first target offsets differed from seed 17. Each issued 100 overlapping alternating seeks and passed the same exact-state, latest-publication and 250 ms cancellation checks (observed 0.565 and 0.535 ms). `target/evidence/e9-t16-seed-stress/report.json` SHA-256 `efe0bbf5db980e272f17e9d5f3788cc9a33c7de6e1544117e6da611d6bc06eda`; traces `target/evidence/e9-t16-seed-stress/seed-29-trace.zip` SHA-256 `e9d33a6c5457c33e936674922b84690b228e3170cd7584dfbb6709dd09587a46` and `seed-991-trace.zip` SHA-256 `aee8d2871b71b10f5f12992029d5767914411efb253edc7f4f96c8266760cb64`.
- `bash tools/deploy-cloudflare.sh` published the committed `web/dist` to the **main production** `https://wasm-vm.pages.dev/` deployment `319b90a8-1b74-4ba7-a497-bca6e66236a7` (Wrangler source `eff226c`). `target/evidence/e9-t16-deploy.log` SHA-256 `03b3aa41e3e4868c6edbacc973be578d2d58d2cdf211e1594f7c1653032c5e71`; deployment listing `target/evidence/e9-t16-deployment-list.json` SHA-256 `ef61a69aa0bec332628656a234bbd5c0734377641359a0c0a3a3f51414214ad7`. Nine public app/Wasm files matched the committed build byte-for-byte (`target/evidence/e9-t16-public-assets.json` SHA-256 `d29c3f7168bf6df8f98e84c05d23e3a46aec6a04410a7a35b5876513af24b18b`). The independent production Playwright run passed 127/0 and the same seek probe, with zero page errors and zero non-favicon missing responses; Chromium's implicit favicon 404 was the only allowed console entry. `target/evidence/e9-t16-public-browser/report.json` SHA-256 `73041f74a6d35748d07a73063a1c0fa90b6d3378f31c1d5bc4ef6b1f72f84cb2`; `browser-trace.zip` SHA-256 `716191bb242afb4c6fd112052c78a2cad661ac2f422f99f46a8ce7ba2a0b35d6`.
- `cargo fmt --all --check`, affected native and wasm32 Clippy, `make test` (the entire native workspace, doctests and determinism hazard checks), `make wasm` (wasm32 build, Wasm package and node tests), `make features`, `make test-riscv`, `make riscv-tests-suite` (128/128), `make determinism`, and `make perf-smoke` (56.4 MIPS above the 15 MIPS floor) passed. `make ci` passed its workspace Clippy phase but stopped at the same five pre-existing `zicsr-stub` dead-code diagnostics as the verified parent task; none are in this diff. Logs and SHA-256: `target/evidence/e9-t16-make-test.log` `8c0f89ede021be056fa713475eb618d8623d68defa36702982ff0fe8b3aea90f`; `target/evidence/e9-t16-wasm.log` `220b90c00f6c801059cb9be4ed1373b5feaa9274f1d5b7d09cdb215378fec39c`; `target/evidence/e9-t16-features.log` `1837d366207ff57326e4a4e39ee5fc17bc088c0459c1b7a02d607bf61f23e3b1`; `target/evidence/e9-t16-test-riscv.log` `fc31bac6afccfcb2322da939191e3867dc72b2b5eb22df1a00867b08307994d6`; `target/evidence/e9-t16-riscv-suite.log` `3643c56292b320648fbe0a55b900c6e3440e4e65f560b3978d07068b8bc92f2a`; `target/evidence/e9-t16-determinism.log` `3a1b776fa1ea59543ed8aa61a9d5d0031f29c37ae69467a921e9f45aa49fe6a0`; `target/evidence/e9-t16-perf-smoke.log` `38a9e13ea84ad629b72e8bf8e04aea2918fbe37cc5aa89b8b5afca3d7a277a5d`; `target/evidence/e9-t16-make-ci.log` `a7af6fa5e3eceed63c79b48f37dd8024e9909f4549df3e58beb5223f4772358b`.

The public browser, public asset and varied-seed attack scripts used for these supplementary recordings are preserved at `target/evidence/e9-t16-public-browser.mjs` (SHA-256 `3ec9d28a816648260464f57a44ae62aa466e357a1b6ba4d6b8b0dff43fa6b155`), `target/evidence/e9-t16-public-assets.py` (`0920d636391d79f967584550bfe9954a2da7a7244b1e5f805f76484626be12a7`), and `target/evidence/e9-t16-seed-stress.mjs` (`d5a98e2b3cb9c84b19dfa0bcc80d41d9252cb307ca9db7504eaceb99302227e4`). The local deterministic acceptance harness is committed in `tools/verify/e9-seek-browser.mjs`.
