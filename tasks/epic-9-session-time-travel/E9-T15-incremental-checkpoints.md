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
