# T03g built-page cold LP0 capture — pre-result plan, 2026-09-13

This is a local diagnostic, not a desktop fix, verification verdict, or release.
Native R1 remains UNPROVEN. Carry forward the existing preparation receipt and
corrected LP1 baseline; do not rewrite their identities or increase the input
deadline. The task log contains Daybreak Blue's pre-result predictions P6–P9.

## Frozen inputs

- LP0 image: `target/omarchy-thread-r1/omarchy-profile-lp0.ext4`, SHA-256
  `bbd63fcc64bdd21d7348af600276bd2b52f433d7b4d61161006e424e973c2637`.
- Candidate chunks: `target/omarchy-thread-r1/chunked`; manifest SHA-256
  `38e8d3144e2e0be26290763a8fd1a712e93b70fc39f93131d80ed3937cbb09fc`.
- Kernel: `releases/kernel/6.6.63/Image`, SHA-256
  `af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce`.
- Built core: `web/dist/pkg/wasm_vm_wasm_bg.wasm`, SHA-256
  `c48e9c2d9ec550c7daf4875716fef1dc729072fdfc91b805394d379bee4b9305`.
- Preparation receipt: `../thread-r1/preparation-receipt.json`, SHA-256
  `d518fd1f4b4439c9802eec77e2058250f767f0767c3c2dec634ddb0a10209942`.
- Corrected LP1 report: `../softpipe-r1/baseline-built-r2/report.json`, SHA-256
  `88496d6e239c36348e72d3c62a41c66b342071c3a4c08c81a8586de69e63ccc7`.

Record the revised harness commit and complete built/harness identities in a
separate preflight receipt before launch. The original R1 receipt stays intact.

## Recording sequence

After focused helper tests and the critic's bounded preflight, freeze the helper.
Run from the repository root with no supplied candidate pair:

```sh
OMARCHY_CANDIDATE_CHUNKS=target/omarchy-thread-r1/chunked \
OMARCHY_EXPECT_RENDERER=llvmpipe OMARCHY_EXPECT_LP_NUM_THREADS=0 \
OMARCHY_BROWSER_TIMEOUT_MS=5400000 \
node tools/verify/omarchy-desktop-live.mjs local \
  evidence/omarchy-profile/thread-r2/cold-built cold-pair
```

The actual built page uses local kernel/chunks only, `noSnapshot=1&persist=1`,
fresh Chromium context, blocked service workers, and observed empty origin
storage before app code executes. Record the stored-restore decision and shipped
restore result; URL flags alone are not sufficient. The 90-minute budget starts
before app navigation. Retain implicit readiness RPCs and their fences. Do not
add guest startup polling, prewarm, physical input, or guest-setting changes.

Require actual mapped Foot/package desktop layers and the current compositor's
unique LP0 environment/no exact `llvmpipe-N` thread. Blank GL labels establish
configuration only, not the active renderer. Export a coherent paused RAM/disk
pair only after those observations. Bind loader base, generation, headers,
hashes, resources, wire evidence and actual screenshots.

If and only if capture succeeds, run a separate fresh built-page restore:

```sh
OMARCHY_CANDIDATE_PAIR_DIR=evidence/omarchy-profile/thread-r2/cold-built \
OMARCHY_CANDIDATE_CHUNKS=target/omarchy-thread-r1/chunked \
OMARCHY_EXPECT_RENDERER=llvmpipe OMARCHY_EXPECT_LP_NUM_THREADS=0 \
node tools/verify/omarchy-desktop-live.mjs local \
  evidence/omarchy-profile/thread-r2/restored-built verify
```

The physical nonce/readback deadline remains exactly 120 seconds. Inspect the
actual before/after screenshots. Input failure means only this exact LP0
configuration did not fix responsiveness; startup/export timeout is UNPROVEN.
Positive improvement remains provisional until the predeclared matched clean
LP1/LP0 logging-enabled arms identify the actual compositor renderer, with
identical logging disabled before input timing. No production, R2, PR merge,
runtime architecture, or Epic 6 change is part of this recording.
