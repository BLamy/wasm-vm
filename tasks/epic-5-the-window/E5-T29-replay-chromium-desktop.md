---
id: E5-T29
epic: 5
title: Recording-capable Replay Chromium Linux desktop (planning parent)
priority: 0.38
status: cancelled
depends_on: [E0-T34]
estimate: L
risk: medium
capstone: false
---

## Ordered replacements

The user explicitly requested Replay Chromium with a Linux GUI and its genuine
recording driver **inside wasm-vm**. Driver-disabled browsing is not completion.
The separate cancelled Epic 8 stock-browser goal remains cancelled. This new local
Replay-port integration is decomposed before execution:

1. E5-T29a: construct an authenticated candidate image with the built browser.
2. First qualify the local RISC-V recording-driver port (decomposition in progress).
3. E5-T29b: cold-boot the recording-capable browser on native wasm-vm and retain a coherent pair.
4. E5-T29c: expose the browser profile in the demo, prove real input, and publish.

Never push or submit a PR to replayio/chromium. Publish only wasm-vm PRs; leave them
open unless the user explicitly asks to merge.
