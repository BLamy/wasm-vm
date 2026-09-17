# AY independent predictions

Written after reading the complete AY task and the diff since `9e610792`,
before opening AY runtime JSON, pixel files or screenshots. The only changed
runtime-facing source is the wrapper's explicit combined diagnostic option at
`f89062c7`; prior AX verifier evidence and task planning metadata are separate.
I did not implement AY.

1. The actual candidate URL must equal AX's cap-1024 / recycling / 16384-entry
   decoded-cache URL, apart from the ephemeral localhost origin. Compared with
   AW the only policy difference is decodedCacheEntries=16384. Actual runtime
   observations must agree, with original geometry, clock and probes unchanged.
2. AT WASM must remain 1602266 bytes, SHA-256
   `7d7b300003cf68076c28958694062dacf3c879efe921bc631bade568ee143bdf`.
   AR RAM/delta, AQ kernel and R3 manifest must retain prior hashes
   `265551f8ff8bed6bd5c0d775852c72c81cf448d4ecdc3f1b89f56fdbf60a0cd8`,
   `1b6b6598373a65b97bfe564ea023cd78938e84f15bbe4f9c04b87625371cfa4c`,
   `3cf8bed0d9a9941a6f2f81b7c8de86cefcba3e4e6bd5e5846bd395714a25642d`,
   `5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44`.
   Recorded source and served-resource hashes must bind the frozen head.
3. Raw trusted keys, keyboard/sync acknowledgements and the independent raw
   serial fence must reconstruct the physical nonce. The original
   300/60/120/20/30-second budgets remain unchanged; no nonce is sent by serial.
4. The original product image and result remain frozen during one 180-second
   continuation. Checkpoints at 0/40/80/120/160 seconds share one deadline.
   No new physical/serial input, configuration write or readiness stimulus
   occurs during continuation; owned cleanup starts only afterward.
5. Every checkpoint must bind an actual latest Worker frame, quiescent presented
   canvas and screenshot: sequence/counts unchanged through capture, no pending
   frame, valid hashes/sizes, independent pixel normalization and PNG agreement.
6. Personal image inspection must establish the first sampled terminal change
   and whether it contains the exact typed command and returned prompt. Separate
   cursor-only changes from terminal text. Compare both sampled and retained
   frame timestamps against Enter +120 seconds without promoting a late image.
7. Forged nonce, cache/runtime setting, deadline or late desktop-success claims
   must reject. Frame counts alone cannot prove text. The 59-test gate and one
   bounded adversarial checkpoint attack must cover the changed option route;
   unchanged AT/AR/AX/AU/AV boundaries carry forward without a new runtime build.
