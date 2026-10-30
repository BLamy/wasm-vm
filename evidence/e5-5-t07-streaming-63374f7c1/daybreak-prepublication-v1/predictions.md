# Frozen predictions — 2026-10-28 Daybreak prepublication review

Frozen after reading AGENTS.md, the full E5.5-T07 task, changed source, generated glue,
build configuration, and the exact f2e4ab0..0144 diff; frozen before opening worker or
pristine-proof outputs.

- P1 HELD expected: the shipped `SnapshotBuffer.append(Uint8Array)` copies the bytes of
  the supplied view (including a non-zero `byteOffset`) directly into one pre-reserved Rust
  `Vec`, in chunks no larger than 256 KiB, with no full expanded JS ArrayBuffer.
- P2 HELD expected (novel attack): after a valid prefix, an append that exceeds the declared
  total fails before invoking its copy closure and leaves length, prefix digest, and ownership
  usable for a later valid suffix; zero and >256 KiB appends likewise leave the prefix unchanged.
- P3 HELD expected: `restoreSnapshotBuffer` consumes its JS wrapper before entering Rust.
  Incomplete, incoherent, malformed-TLV/sparse/device, or valid restores cannot reuse that
  wrapper; every refusal leaves the machine's complete saved snapshot byte-identical.
- P4 HELD expected: foreign core/base/generation are classified respectively as
  `foreign_build`, `foreign_image`, and `stale`; full framing/component/device failures are
  `corrupt`; no refusal clears or otherwise mutates unrelated machine state.
- P5 HELD expected: the actual published gzip authenticates to the manifest compressed size/hash,
  expands to exactly 634,769,246 bytes with the claimed hash, contains the complete 16-section
  container and exactly 1 GiB sparse RAM image, restores successfully, and matches an independent
  RAM oracle. Evidence will not justify an RSS/peak-memory number or physical-iPhone claim.
- P6 HELD expected: the frozen gate at 63374f7c1 remains FAILED solely on its twelfth obsolete
  roadmap lookup after eleven zero-exit commands; continuation at 0144 carries those immutable
  receipts, proves only two fixture paths changed, and passes only the corrected decorative/demo
  step. The original failure must not be relabelled.
- P7 NEEDS EVIDENCE expected until inspected: the first pristine proof remains FAILED at its added
  byte-identity assertion, with own cold-built wasm 4aae7a.../2,633,541 bytes differing from shipped
  6d3082.../2,650,103 bytes; no cause may be assigned from size/hash alone. A same-clone v2 must use
  only its own wasm plus matching generated glue and closure stamp, then pass bounded functional warm
  acceptance. Source/Cargo/features/tool versions/exports/glue will be compared for material drift,
  but byte reproducibility is not silently waived or claimed.
- P8 HELD expected: runtime semantics stop at 63374f7c1. 63374f7c1..0144 changes only
  `software-snapshot-gate.py` and `e5-t18e-demo-smoke.mjs`; GPU runtime/factory identity and artifacts
  remain untouched, and any simulator GPU extension/profile conclusions remain separate HELD facts.
- P9 NEEDS EVIDENCE expected: publication is not complete until the exact open PR head is deployed
  and live Cloudflare is verified. A local simulator/browser pass is readiness evidence, not live
  deployment, task verification, physical-phone success, iOS 26.7.2 causation, or `gpu=0`
  reconfirmation by the human.

Sabotage prediction: changing the bounded-copy assertion to require a maximum below an observed
real chunk, or corrupting the expected expanded digest, must make the relevant harness fail. The
sabotage will be performed only on an isolated scratch copy, never the repository.
