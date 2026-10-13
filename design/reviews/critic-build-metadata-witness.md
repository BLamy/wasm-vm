# Independent build-path witness

Captured by the read-only critic for the incremental metadata-isolation diff. The owned alternate checkout was removed only after assertions completed. No browser/runtime/deployment/task state was touched.

## Run and assertions

```json
{
  "source": "/Users/blamy/.codex/worktrees/website-docstream/wasm-vm",
  "checkout": "/tmp/wasm-vm-critic-metadata-yurwp2_f/alternate-checkout",
  "sourceBefore": {
    "head": "a6670ee88ed60a342471fc84628bfc74f250fc5e",
    "status": "?? design/reviews/critic-build-metadata.md"
  },
  "checkoutBefore": {
    "head": "a6670ee88ed60a342471fc84628bfc74f250fc5e",
    "status": ""
  },
  "reportDirectoryInitiallyAbsent": true,
  "commands": [
    {
      "argv": [
        "npm",
        "ci",
        "--no-audit",
        "--no-fund"
      ],
      "cwd": "/tmp/wasm-vm-critic-metadata-yurwp2_f/alternate-checkout/web",
      "exitCode": 0,
      "elapsedSeconds": 2.699,
      "output": "\nadded 158 packages in 3s\nnpm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:\nnpm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)\nnpm warn install-scripts   fsevents@2.3.2 (install: (install scripts present))\nnpm warn install-scripts\nnpm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.\n"
    },
    {
      "argv": [
        "npm",
        "run",
        "build:docs"
      ],
      "cwd": "/tmp/wasm-vm-critic-metadata-yurwp2_f/alternate-checkout/web",
      "exitCode": 0,
      "elapsedSeconds": 1.028,
      "output": "\n> wasm-vm-web@0.0.0 build:docs\n> node ../tools/build-docs.mjs\n\nDocstream corpus: 154 pages; 1533 baseline prose files accounted for; {'preserved': 1879, 'rewritten': 110, 'obsolete': 6}\nDocstream reader bundled locally; heavy renderers keep their dynamic chunks.\n"
    },
    {
      "argv": [
        "npm",
        "run",
        "check:docs"
      ],
      "cwd": "/tmp/wasm-vm-critic-metadata-yurwp2_f/alternate-checkout/web",
      "exitCode": 0,
      "elapsedSeconds": 0.736,
      "output": "\n> wasm-vm-web@0.0.0 check:docs\n> node ../tools/check-docs.mjs\n\nDocs checks passed: 1533 source documents accounted for; 154 pages parsed/round-tripped; 225 local links; 181 unchanged code blocks; original shader SHA-256 7c02808459cd4af76ec975490232d401bf5b77d58729eb77b51e7f78a05d6742.\n"
    }
  ],
  "results": {
    "head": "a6670ee88ed60a342471fc84628bfc74f250fc5e",
    "checkoutStatusAfter": "",
    "sourceHeadAfter": "a6670ee88ed60a342471fc84628bfc74f250fc5e",
    "sourceStatusAfter": "?? design/reviews/critic-build-metadata.md",
    "trackedReviewRecordCount": 45,
    "checkoutReviewRecordMismatches": [],
    "sourceReviewRecordMismatches": [],
    "generatedAssetCount": 330,
    "generatedAssetMismatches": [],
    "historicalTrackedMetadataSha256": "8c65331ce1cc0b15d37495bac534bbef326f6770d9aab93b6a58b77dccf2ae89",
    "report": {
      "path": "target/docs-build/bundle-metafile.json",
      "sha256": "a54ea0b021c19da90aae2b7c940e01c71ff8e7befaefbf1925290a689e6f19a8",
      "ignoreResult": "target/docs-build/bundle-metafile.json",
      "inputs": 5497,
      "outputs": 174,
      "inputExample": "node_modules/react/cjs/react.production.js",
      "outputExample": "docs-bundle/features/abnfDiagram-VCTEODGH-PVZXWUGN.js"
    },
    "preservedValidationMatchesColdReceipt": true,
    "generatedRecordPathsSha256": "7c690172fdf0d18a5026ccd3feca337f88641d63ce19f9c4ee2fd3c0f1c25814",
    "generatedAssetGroups": {
      "web/docs-bundle/": 174,
      "web/docs-content/": 156,
      "web/docs": 330
    },
    "generatedPathSetMatchesColdReceipt": true,
    "reportContainsCheckoutPath": true,
    "historicalMetadataContainsOriginalPath": true,
    "pathDependentInputExample": "source-text:/private/tmp/wasm-vm-critic-metadata-yurwp2_f/alternate-checkout/web/docs-src/architecture-demo.jsx",
    "gitDiffExitCode": 0,
    "coldReceiptSha256": "30d25f5f7c2ed4ed39592cedd623f9f3e68723c4e809d6bfd1201be14c47810e",
    "reviewFilesUnchanged": 44,
    "ownedScratchRemoved": true,
    "sourceHeadAfterCleanup": "a6670ee88ed60a342471fc84628bfc74f250fc5e",
    "sourceTrackedDiffAfterCleanupExitCode": 0
  },
  "reviewDateUTC": "2026-10-13T15:59:58.631994+00:00",
  "sanitizedEnvironment": "NODE_OPTIONS, NPM_CONFIG_NODE_OPTIONS, RUSTFLAGS, RUST_LOG and every CARGO_* variable omitted from npm subprocess environment",
  "cloneMethod": "git clone --shared --no-checkout --quiet; sparse-checkout cone web/tools/design; checkout --detach a6670ee88ed60a342471fc84628bfc74f250fc5e. Git objects share the local source repository; dependencies installed fresh via npm ci. This tests build path independence, not repository availability without the source object database."
}
```

## Immutable tracked review/evidence manifest

All 44 `design/reviews` files and the tracked historical esbuild metadata were hashed before and after the alternate-path build. Each digest remained identical in both source and alternate checkout.

```json
{
  "design/docs-bundle-metafile.json": "8c65331ce1cc0b15d37495bac534bbef326f6770d9aab93b6a58b77dccf2ae89",
  "design/reviews/00-current-docs-desktop.jpg": "00712df8044a9d6cc18fe548dcce798932af0dcb0f6a6f4740ade9fef147a2a4",
  "design/reviews/00-current-home-desktop.jpg": "50f259c3ce5ef297c30c51f8db11dbe2c117c87e89096634ecd4b754b26bde73",
  "design/reviews/01-home-desktop.jpg": "66597cf5f540ca3892631223828f88a0304f3f8e226852fbb636660a5fca0970",
  "design/reviews/01-home-mobile.jpg": "516064cd017ddaef2232c8493b54378f0bf179e464a9dffad378a79b864c3225",
  "design/reviews/02-docs-desktop.jpg": "4163ba0822e389e12195ad89f789b12866fa347aca0708ac444225565819562e",
  "design/reviews/02-docs-mobile.jpg": "bb9e0d203777ed0f0a629f303781155585418c9863f9b11a3ced4a377a81d14f",
  "design/reviews/02-home-desktop.jpg": "5ab7148df069320ebdb9922d5aca1f0c7709a5209a3da098f5bd9261ba7a1aa6",
  "design/reviews/02-home-mobile-model.jpg": "54706ada2ab459984e0d63a6a0575f25cf84cda2c5f0f975df8c78ee4e908c52",
  "design/reviews/02-home-mobile-top.jpg": "3f268cf0f6811039f6599dd1fc2781b4d740b4d25058ea3d3e471c43ddff24b0",
  "design/reviews/02-products-desktop.jpg": "27fbc2a4e824b1671fe542b6a98477818f00c423ded0abc81060b94ea72e87ce",
  "design/reviews/critic-01.md": "8224ef3dbf83b10880d3748790a5d69f550fc229fdfde0f5d8ce711622c3a569",
  "design/reviews/critic-02-boundary-code.jpg": "a62112281caaa7b41dcbae7096490d8f6e6e141a2ca52cd1d732bcb196d4ae49",
  "design/reviews/critic-02-boundary-failure-production-landing-Back.jpg": "74cc242ddf9ab20908efaf6086bc68da8057260374008281a27e084287c67d44",
  "design/reviews/critic-02-boundary-launcher.jpg": "10f500a55cd7a7547f12178b46b679c445d9a59a0e98e2753ff5f676f0bd9883",
  "design/reviews/critic-02-boundary-security-mobile.jpg": "95b32d6e091cc6144e30d3bd078665bf7e6d5d2b7508f9add5174bda16bc4d19",
  "design/reviews/critic-02-boundary-security.jpg": "b5c889d591b4695c5569d3c63dd0906811f2e1d40b5f2dc18da5e9542a1f6ea5",
  "design/reviews/critic-02-boundary-witness.md": "48268ca3653c98586ceab3f19c4cb6c45275779d060d3dcc2ad6c5f848004507",
  "design/reviews/critic-02-failure-architecture-demo.jpg": "8cbdbcc2aaad121b59a26e7803a301d7aa351eccc15984ead0c108aabb3adceb",
  "design/reviews/critic-02-failure-copy-and-markdown.jpg": "719b6431a2b5d94a959d4ca3b092a7951db21eb6b65bf620c32e507dc8fbda05",
  "design/reviews/critic-02-failure-table-of-contents.jpg": "719b6431a2b5d94a959d4ca3b092a7951db21eb6b65bf620c32e507dc8fbda05",
  "design/reviews/critic-02-final-controls-witness.md": "66718faf5d9390214dd821a05aff997ff9a406abc5ee2aa9c7738ce1d4a1546e",
  "design/reviews/critic-02-final-failure.jpg": "d26789de45cb15aa30c32f02d273a47b5ac1fe26cf64e622814bcd568460ea11",
  "design/reviews/critic-02-full-launch-ready.jpg": "cc7d16f2088cc7e61567f1e46d375cbff1f1eefd7bcc84d6dbc35c64b538e0be",
  "design/reviews/critic-02-launch-witness.md": "1bcaef6cf49b9d994b9129287c1ba763fa6ea9ef364279da3f287ed6869bc2ab",
  "design/reviews/critic-02-live-devices-desktop.jpg": "58347fe644eed5db0ac1049a1b185903b40a106d1f73be9651c7e85325e09d00",
  "design/reviews/critic-02-live-embedded.jpg": "202254bbfae2030e1277d5ad14364998abfe9f94d2743c754abff9b6f0550284",
  "design/reviews/critic-02-live-home-desktop.jpg": "ff31c2c3ff8e20ad8f6304d3357c78ce4544607ceef0ff387b2e7372f0ca8bad",
  "design/reviews/critic-02-live-home-mobile-model.jpg": "9aae61e1ca134b6a5e6a5d30e4446ad169578fb10aeedc9025e576000510920c",
  "design/reviews/critic-02-reader-archive-live.jpg": "28c8b402b0e26654d505875785fc86dc1e9d8138411a8826fa0ae0c1d2e22c1c",
  "design/reviews/critic-02-reader-desktop-live.jpg": "3621308e5b2ce7d86391ccac28e11fee0bfeedc491feb5716c31ea1feae21d60",
  "design/reviews/critic-02-reader-graphics.jpg": "d185d4a647a70221d1e8c2508646bceadbea5c398d9063189b372b0e8097b53b",
  "design/reviews/critic-02-reader-mobile-live.jpg": "765fffa7d6c88a92348650387b51290ed9dce7fd3463d5137d729319603e11fb",
  "design/reviews/critic-02-reader-reference-docs-gpu-3d-decision.jpg": "4430bb150be5ab3963f3688ebe3c1d6f0464600356e9aeceea1f5f9bfe2916ba",
  "design/reviews/critic-02-reader-search-live.jpg": "c0e019cacc318903618d6461e856ca43a93bf0bb3292f3254b0ac84b15ab3ba8",
  "design/reviews/critic-02-reader-witness.md": "3f323ba032b1d5fe1a65d633cfbfcc3e2264f8b01eac2ba710b0dc6fe25aa644",
  "design/reviews/critic-02.md": "5fe45042aae39674f30d9359fe97efa1d9eaa804feff7a0ea2eb739c6f769f16",
  "design/reviews/critic-03-back-devices.jpg": "937926700a776d088eda97e436c936761a4af59ba61e27b3ea4670a859d46bb2",
  "design/reviews/critic-03-failure.jpg": "b184622b7f337fabc487e063c4ca970d6d49c56d804b272c240f8b027a229235",
  "design/reviews/critic-03-markdown-view.jpg": "768c0d07c7960799278bcea409ca18065f21a7e835b02d73f1fd8fda11e48a94",
  "design/reviews/critic-03-no-webgl.jpg": "7e61654a458349762181fc989fcad458c98283cb03ea9bbf2060f26369523d10",
  "design/reviews/critic-03-reader-desktop.jpg": "4d73bf3a5cf94bfd3455b0510dd48a6e7512d9f45f64a796ccc3a941d280ad15",
  "design/reviews/critic-03-reduced-mobile.jpg": "a6fa9553837c9e43feb0bab79977bda9c4c59de55beab1863292df647d940824",
  "design/reviews/critic-03-runtime-witness.md": "3658a144d737450a899ec2c395f7a8dc1eb4a0f75c8520d2ad352764bd50d16e",
  "design/reviews/critic-03.md": "09bf7fdec39d6724cab0e1b537dca0236068b5d9de7f8058bdc97d859536fb04"
}
```
