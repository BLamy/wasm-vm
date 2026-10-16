# Binding audit predictions (written before evidence inspection)

Frozen implementation/harness: 81cd3a4c403176be4b0191fa00ed37f4fd1e1e35.
Base: 5af5600c33c69e926c96a3dc82369c31da391565.

- B1 Source identity: every claimed source hash in worker receipts will equal both the working tree bytes and frozen-commit blob bytes; served renderer/module/package hashes will identify the actual files used in browser captures, not unrelated source text.
- B2 Translation parity: recorded native and Wasm fixture translations will have identical full translated texts, metadata and success/rejection results for both declaration orders, optimized-out/inactive declarations, and out-of-range addresses.
- B3 Literal transport: raw command packets independently decoded from the recording will encode exact admitted184-word buffers and rejected188-word/misaligned/stage-slot neighbor payloads; no report count may substitute for the bytes.
- B4 Output binding: independently derived vertex/pixel expectations will agree with hardware observations, and high upload sabotage must produce an output mismatch while retaining the same shader/packet identity.
- B5 Cold clone: the completed pristine run will name the frozen commit, show a clean initial tree and scrubbed RUSTFLAGS/CARGO_*/RUST_LOG, pass the same acceptance target, and bind identical source/runtime evidence.
- B6 Production isolation: all modified runtime entry points remain reachable only behind the prior test-only opt-in boundary; production manifest/boot paths will not newly activate virgl.

This helper will inspect receipt.py as evidence-generation code, not use its success as an oracle. Only completed artifact sets are eligible for final conclusions.
