---
id: E3-T21b2b
epic: 3
title: Static riscv64 WVFT guest agent
priority: 321.222
status: implemented
depends_on: [E3-T21b2a]
estimate: S
risk: high
capstone: false
---

## Goal
Bind the verified WVFT protocol to the verified guest storage engine in one reproducibly built
static riscv64 agent providing the service and `vm-download`.

## Deliverables
- A bounded socket/framing adapter for uploads and downloads over `10.0.2.2:10021`.
- One reproducible static riscv64 executable with service and `vm-download` entry modes.
- Build metadata and checks proving architecture, static linkage, and byte reproducibility.

## Acceptance criteria
- [ ] Native adapter tests round-trip upload/download hashes and exercise cancellation, timeout,
  malformed framing, peer disconnect, and two transfers without a destination-dial capability.
- [ ] Two clean builds produce identical SHA-256 and the artifact is identified as static riscv64.
- [ ] `vm-download` accepts only a normalized outbox basename and cannot select an arbitrary path.

## Adversarial verification
Mutate framing/state between endpoint and storage, disconnect at every boundary, inspect the binary
for dynamic dependencies and forbidden capability strings, and rebuild from a scrubbed environment.
Any architecture/linkage drift, path escape, general proxy, or nondeterminism refutes.

## Verification log

### 2026-07-27 — worker — implemented

Commit `c5938a7` adds the `wasm-vm-file-agent` crate and binds the accepted WVFT framing to the
verified storage engine. The agent has one compiled-in connector,
`10.0.2.2:10021`, and fixed inbox/outbox roots. Service mode maintains exactly two outbound WVFT
slots; `vm-download` accepts one basename and obtains its held, mutation-checked source from the
outbox. Neither mode accepts an address, port, URL, arbitrary path, command, listener, or proxy
operation.

The adapter incrementally parses bounded frames, streams upload/download bytes under four-frame
credit, independently checks offsets, lengths, and hashes, and treats timeout, malformed framing,
EOF, cancellation, and completion ambiguity as terminal without exposing false completion. Native
tests cover fragmented upload durability, credited download completion, cancellation/timeout/
disconnect/malformed framing, a real Unix-stream EOF, two shared transfers plus third rejection,
and hostile `vm-download` names.

The pinned build uses Rust `1.96.0`'s `riscv64gc-unknown-linux-musl` target with Zig's musl linker,
fixed source epoch, disabled incremental state/build IDs, one codegen unit, and stripped symbols.
Two independent clean target directories produced byte-identical artifacts identified by `file` as
stripped RISC-V ELF64 static PIE.

Exact-head evidence:

- `cargo fmt --all --check` — passed.
- `cargo clippy -p wasm-vm-file-agent --all-targets -- -D warnings` — passed.
- `cargo test -p wasm-vm-file-agent -- --nocapture` — 6 passed, 0 failed.
- `bash tools/verify/e3-t21b2b-capability.sh` — `OK (one fixed connector, fixed roots, no
  proxy/process authority)`.
- `bash tools/verify/e3-t21b2b-static.sh` — two clean builds matched at
  `sha256 6dba9661ff8116748d6119701d9cee748eee49a229de06aac9707a33aee3e50b`; artifact is
  `ELF 64-bit ... UCB RISC-V ... static-pie linked, stripped`.
- `cargo check --workspace --all-targets` — passed.
- `git diff c5938a7^..c5938a7 --check` — passed.

This slice produces the verified agent artifact and native adapter proof. Rootfs installation,
startup wiring, guest execution, and browser/boot proof are deliberately isolated in E3-T21b2c.
