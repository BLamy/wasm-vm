---
id: E5-T30
epic: 5
title: Genuine Replay recording-driver RISC-V port (planning parent)
priority: 0.38105
status: cancelled
depends_on: [E5-T29a]
estimate: L
risk: high
capstone: false
---

## Ordered replacements

The user's explicit goal is Replay's real recording driver inside wasm-vm. The
browser-only pre-check is not completion. Split the architecture port before
activation: T30a Linux signal/stack context; T30b generated call ABI bridges;
T30c ELF loading/interposition; T30d actual driver attachment and recording data.
T29b then proves recording on wasm-vm's own CPU, and T29c owns browser-host input
and final delivery. No shim or disabled-recording run can satisfy these tasks.

The driver source is a private Replay repository, retained only under the ignored
project-local driver workspace. Keep its code, local patches, binaries and full
verification artifacts private/local. Public wasm-vm PRs may contain integration
and task metadata, not copied private implementation. No Replay pushes/PRs,
merges, upstream CI or GitHub Actions are authorized.
