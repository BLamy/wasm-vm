# AW independent verifier predictions

Prepared after reading AGENTS.md, the complete AW task and the implementation
diff at `96a4c890e5d01b4110f2ea65ff28f3012a93056e`, before opening AW's runtime
report, receipt, raw traffic or screenshot. Worker submission:
`fc9f242e86a1a7f45a17612baf2a9ab52a76343d`. I did not implement this task.

1. The actual candidate has `jitResidencyPolicy=cap-1024`, cap 1024, cold
   counter recycling enabled, JIT enabled, decoded cache 4096, icount divider
   64, no admission/timing probe, and original 1280x800 presentation. The only
   URL policy difference from prepared cap-256 is `jitResidency=cap-1024`.
2. Served AT WASM is exactly 1602266 bytes with SHA-256
   `7d7b300003cf68076c28958694062dacf3c879efe921bc631bade568ee143bdf`.
   Carried AR RAM, delta, kernel and chunk manifest hashes are respectively
   `265551f8ff8bed6bd5c0d775852c72c81cf448d4ecdc3f1b89f56fdbf60a0cd8`,
   `1b6b6598373a65b97bfe564ea023cd78938e84f15bbe4f9c04b87625371cfa4c`,
   `3cf8bed0d9a9941a6f2f81b7c8de86cefcba3e4e6bd5e5846bd395714a25642d`, and
   `5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44`.
   Runtime/guest bytes and ordinary prepared-cap-256 selection remain unchanged.
3. Trusted physical key events reconstruct exactly one printf command; its
   nonce comes back through an independent read-only serial file check within
   120 seconds after Enter. No serial input can create the file or inject the
   nonce, and no readiness/input helper bypasses physical typing.
4. Original 300/60/120/20/30-second phase budgets hold. There is one fixed
   candidate, no late-display observation or alternative runtime experiment.
5. The actual post-input PNG remains the empty-prompt baseline SHA-256
   `431be977157bf77dcd21ca8bf3b640bce9e02dc8c54f09a30d58af78a8195b24`.
   Therefore a passing nonce/counter check cannot establish desktop acceptance.
6. A forged success with wrong cap, recycling, deadline, nonce/input provenance
   or stale image must fail independent evidence validation. Candidate fixtures
   must not erase the unchanged cap-256 path's existing protections.
7. Recorded acceptance plus affected deterministic tests cover the seven-file
   implementation diff. Harness-only scope carries AT/AR/AV runtime findings;
   no cold clone or runtime rebuild is required. Negative AW proves only that
   this cap change failed this gate, not that desktop responsiveness is solved.
