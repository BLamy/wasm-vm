# E5-T26h session-fence verifier results

## Verdict

`VERDICT: verified`

Frozen implementation: `2325c05f756f9a9746099051db9ab46866b874e8`
(parent `e37ddc6343db7865efc87dfe0ff34043859de36e`). The current upper-layer
workspace had moved to `ee24e80a51b4a2c6ced4b23926864f7e426ec57b`, but the three reviewed files
remained byte-identical to the frozen commit:

- `console.rs`: `3e1e7da281bd7ecee928d38eb596b3061094e7ae`
- `lib.rs`: `e0b0528930ea23bbbe3e3b9af005532097194554`
- `desktop_machine_resume.rs`: `9b668b3f7ca9aea22f1421468303c758da1bb55a`

## Prediction results

- **P1 HELD.** The old-HELLO promoted regression passed, and the stronger worker fixture showed
  saved agent-TX descriptors completed with zero used length while `take_agent_output` remained
  empty. A HELLO posted only after `load_resume`, before the first guest instruction, was delivered
  and accepted (`clean-exact-head-native.log:92-101,107-116`; fixtures
  `desktop_machine_resume.rs:822-947` and `desktop_machine_resume_verifier.rs:587-679`).
- **P2 HELD.** Empty, nonzero, wrapped, full, RAM-last, closed-port, control-TX, and serial-TX
  boundaries passed. The implementation drains after all restored sections and before execution
  (`lib.rs:3227-3239`), while only control and serial queues are re-armed
  (`console.rs:418-423`).
- **P3 HELD.** A valid old descriptor followed by malformed descriptor DMA completed the first
  with length zero, raised `NEEDS_RESET`, forwarded no bytes, stayed blocked after repair/notify,
  and recovered only after reset (`desktop_machine_resume.rs:949-993`;
  `clean-exact-head-native.log:92-101`).
- **P4 HELD.** The one novel attack moved the fault to the changed `push_used` branch: a valid old
  HELLO plus an out-of-RAM saved used ring raised `NEEDS_RESET`, exposed no output, refused HELLO,
  stayed blocked after the used address was repaired, and accepted a fresh HELLO only after a
  transport reset (`used-publish-attack.log:7-16`). This confirms the error fence at
  `console.rs:1033-1051`, the service guard at `console.rs:1061-1065`, and reset clearing at
  `console.rs:678-695`.
- **P5 HELD.** Worker evidence hashes exactly as claimed and records 119 passing checks, strict
  fmt/clippy, wasm32 core build, and wrapper check. The nine unchanged promoted attacks pass
  (`worker-session-fence-gates.log:1-197`). Prior HELD topology, corruption/missing/duplicate,
  held-input, sound/RNG cursor, legacy atomicity, sparse-parser, headless, and no-same-state-oracle
  results are carried forward; their implementation/evidence boundaries did not change.
- **P6 HELD.** One local clone at exact detached frozen head, with inherited `RUST_LOG=warn`
  scrubbed and no `RUSTFLAGS`, `RUSTDOCFLAGS`, or `CARGO_*` variables present, was clean before and
  after `make verify-E5-T26h`; the target passed all 119 checks and both wasm32 checks
  (`clean-exact-head-native.log:1-337`). No browser gate was run or required for H.

## Coverage and suite

The new state bit is exercised on restore, malformed blocking, service refusal, and reset. The
bounded drain's unready/empty, interrupting/non-interrupting completion, descriptor-pop failure,
used-publication failure, and success paths are exercised. The machine call site is exercised with
RAM reordered last. All changed worker tests executed. The temporary publication-failure test was
discarded after recording because it is a second malformed-DMA representative of the same stable
protocol-reset policy already permanently locked by `malformed_saved_agent_dma_blocks_tx_until_transport_reset`;
no shared implementation or permanent test was changed.

## Digests

- Worker record: `1978f7ac0284ab4b3d9127a84083920e1d7a0ca401bd7fc19fe2e5dbb5570349`
- Predictions: `87c846fd7f19199abc9a98d64806d78aef4843e85100b8e0273515390e0acfee`
- Novel attack: `3e869801070444326666378b9b26c44b8dc50234b892163abad87bebaf9fa3ee`
- Clean exact-head acceptance: `92773b14effc7bad1c3c11481ae66a3a7d43efbedc32caba1bc5816db5dadaba`
