# E4-T38 residency policy ledger

Implementation head: `3a92f16` (`jit: add residency policy ledger`).

The authoritative browser capture is
`residency-policy-2026-09-03.json` (SHA-256
`70497e0b0b52e2f11f5dafe6f34e1a5d978f2d4ad77a2d8593ff28d928a77257`). It uses the exact
E4-T32 Node chunk manifest (`ac6a298883c36d170534a679fd976c5681a20f1fa48ef2d587e6bc124e70b1c1`),
the restored Node image, the same `node -e 'console.log(3)'` oracle, and one fresh
whole-machine Worker page per policy.

## Capture

```sh
E4T32_NODE_ASSET_DIR=/tmp/e4t32-node-assets
E4T32_NODE_ASSET_BASE=/e4t32-node-assets
E4T32_NODE_BENCH=1
PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8133 PLAYWRIGHT_REUSE_SERVER=1 \
  E4T32_NODE_BENCH=1 E4T32_NODE_ASSET_DIR=/tmp/e4t32-node-assets \
  E4T32_NODE_ASSET_BASE=/e4t32-node-assets \
  ./node_modules/.bin/playwright test tests/e4-t38-residency-policy.spec.js
```

The server was `bash tools/serve-dev.sh 8133` with the same asset directory. The run passed
`1 passed` in 1 minute, with zero non-favicon HTTP/console errors, restored snapshot identity,
and `whole-machine-worker` for all three legs.

| policy | wall ms | first output ms | submitted members | compile pause ms | live modules / cap | code bytes | evictions | retranslations | logical blocks / engine call | JIT retired share |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| repack-off | 19,434.095 | 17,268.410 | 2,304 | 165.945 | 22 / 24 | 1,665,851 | 441 | 879 | 4.29565 | 0.40684 |
| cap-256 | 17,646.450 | 15,754.340 | 2,110 | 228.270 | 201 / 256 | 15,356,751 | 260 | 173 | 3.80943 | 0.55740 |
| cap-1024 | 17,321.400 | 15,557.375 | 2,172 | 248.510 | 484 / 1024 | 36,458,954 | 0 | 0 | 3.83243 | 0.58128 |

All three legs retired the same `243,490,289` guest instructions and produced the exact framed
output `3` with exit `0`. The focused wrapper test also passed all three labels/caps and the
invalid-policy fail-closed check.

## Decision

No experimental cap is promoted to the production default. Both larger caps reduce cache
eviction/retranslation counts and wall time, but cap-256 records four pauses over the documented
5 ms single-pause target (maximum 13.71 ms), while cap-1024 grows compiled code to 36.46 MiB,
past the documented 32 MiB cache budget. The existing conservative `repack-off`/24-module
production screen therefore remains in force; the policy experiment is closed as refuted while
the measurement ledger is verified.

## Adversarial coverage

```sh
wasm-pack test --node crates/wasm --test jit_browser_parity -- \
  --include-ignored browser_handles_remain_bounded_across_retranslation_churn
wasm-pack test --node crates/wasm --test jit_browser_parity -- \
  browser_inline_static_code_store_cuts_link_before_target_reuse
wasm-pack test --node crates/wasm --test jit_browser_parity -- \
  browser_inline_static_link_unlinks_and_rearms_after_target_reinstall
```

Results: `1 passed, 0 failed` for the smallest-cache churn attack, and `1 passed, 0 failed`
for each same-page invalidation/reinstall attack.
