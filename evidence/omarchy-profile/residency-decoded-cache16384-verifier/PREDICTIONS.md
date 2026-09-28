# AX independent predictions

Prepared after reading AGENTS.md (unchanged), the complete AX task and six-file
implementation diff at `9c63ad84b442d62f15ace9b90475552e6b6c0c92`, before reading
AX runtime evidence or viewing its image. Worker submission is
`9e6107927d0ef14690e727bb83380a355a044466`. I did not implement AX.

1. Both actual runtime observations must show cap-1024, cap 1024, recycling
   enabled and decodedCacheEntries 16384. JIT remains enabled, icount divider
   64, admission/timing probes off, presentation 1280×800. Compared with AW,
   the only URL policy difference must be decodedCacheEntries=16384.
2. AT WASM remains 1602266 bytes, SHA-256
   `7d7b300003cf68076c28958694062dacf3c879efe921bc631bade568ee143bdf`.
   AR RAM/delta, AQ kernel and R3 chunk manifest must match these prior pins:
   `265551f8ff8bed6bd5c0d775852c72c81cf448d4ecdc3f1b89f56fdbf60a0cd8`,
   `1b6b6598373a65b97bfe564ea023cd78938e84f15bbe4f9c04b87625371cfa4c`,
   `3cf8bed0d9a9941a6f2f81b7c8de86cefcba3e4e6bd5e5846bd395714a25642d`,
   `5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44`.
   All recorded helper and served-resource hashes must bind the frozen head.
3. Raw trusted key events must reconstruct exactly one physical printf; its
   independently named file must return the nonce through a read-only serial
   command within 120 seconds. No serial nonce injection, additional keys,
   readiness injection, profiling or late-display continuation may occur.
4. The original 300/60/120/20/30-second budgets must hold without retry or a
   control arm. Cleanup must close normally. Existing AW/default selection
   must still use the 4096-entry decoded cache without an extra query setting.
5. The actual final PNG must show the claimed negative result and equal the
   prior empty-prompt baseline SHA-256
   `431be977157bf77dcd21ca8bf3b640bce9e02dc8c54f09a30d58af78a8195b24`.
   A nonce or frame-counter pass cannot establish a visible response.
6. Forged cache/cap/recycling, physical-input, nonce or deadline evidence must
   reject. Changing only success metadata cannot overcome the stale image.
7. Affected deterministic tests and the recorded run must cover each changed
   behavioral hunk. This medium-risk harness-only negative experiment needs
   neither a runtime rebuild nor cold clone. It cannot promote Q or establish
   that desktop responsiveness is solved.
