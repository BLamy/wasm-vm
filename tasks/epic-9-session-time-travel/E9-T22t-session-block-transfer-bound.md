---
id: E9-T22t
epic: 9
title: Bound large session block DMA independently of host completions
priority: 524.92202987
status: implemented
depends_on: [E9-T22s]
estimate: S
risk: high
capstone: false
---

## Goal

Let the frozen original cold desktop complete its observed 1,179,648-byte
virtio-blk write. E9-T22s proved that the in-range write currently completes
`S_IOERR` before the COW backend because a host completion-payload limit is
also used as the guest's block DMA limit. Keep these two boundaries separate.

## Boundary

One bounded session-block transfer change. The maximum guest block request
must remain finite and fit the 16 MiB authenticated base-chunk cache; host
completion envelopes, immutable base chunks, the 524,288-sector COW limit,
device ownership, frozen image/workload/clock/checkpoint cadence, and replay
policy stay unchanged. This task makes no first-frame or full-workload claim.

## Acceptance criteria

- [ ] The real virtio descriptor path completes an in-range 1,179,648-byte
  session COW write with `S_OK`, exact bytes and used-ring advancement. Reads
  spanning multiple authenticated base chunks remain atomic across parks and
  overlays; replay preserves the resulting disk state.
- [ ] A sector-aligned request above the new finite DMA bound still completes
  `S_IOERR` without a backend call, while out-of-range and COW-capacity paths
  retain their distinct behavior. Host `MAX_RESULT` and authenticated
  completion validation do not widen.
- [ ] The built browser exercises the corrected guest-visible path without
  console errors, and the demo's session-capability evidence is updated.
  Record exact-head guest and browser evidence, then obtain a fresh Daybreak
  adversarial verdict on the diff and evidence.

## Deterministic acceptance

`make verify-E9-T22t` on a clean exact head.

## Adversarial verification

Attack just below, at and above the transfer boundary; split DMA over
multiple descriptors; exercise a read that needs more than one authenticated
base chunk, a partially overlaid read, out-of-range sectors, COW capacity,
reset/park and replay. Try to use a larger guest DMA to smuggle an oversized
host completion or to exhaust the cache with pinned chunks. Reject evidence
that only calls the backend directly and never executes the virtio chain.

## Verification log

### 2026-10-28 — worker — implemented at `1bbaaf6fd62f9d875e9b0fbdc832de3db3309503`

The exact-head `E9_OUT=target/evidence/e9-t22t-1bbaaf6fd make
verify-E9-T22t` passed policy, format, affected all-target Clippy, 433 core
unit tests, 22 device-completion tests, 20 virtio-blk tests, three new real
session-block tests, no-std wasm build, reproducible `web/dist`, 127/127
browser ISA tests, the live device-completion pip and the RV64 large-block
browser probe with zero console errors. The independent oracle found 384 guest
trace lines, two actual block MMIO notifications at lines 247 and 357, zero
OUT/IN status stores at lines 267 and 377, and the completion marker at line
382 (one-based). The report, guest trace and Playwright trace SHA-256 digests
are respectively `fae6a984ca2ecd45d6ad53a9bbf2c68e2e48cb068c84caa88fd5375b5236a183`,
`04d53c9bed9b8d7173053d3c61d444452e79337cffd8d302f6c3be58a0badc2e`,
and `bf808d60867538382f0d13a5886219ff40014a3f8e2dceb7a79e4c54fc900755`.
The browser report and trace are in
`target/evidence/e9-t22t-1bbaaf6fd/browser/`.

The final pristine sparse clone at the same commit, with `RUSTFLAGS`,
`RUSTDOCFLAGS`, `RUST_LOG` and all `CARGO_*` environment overrides scrubbed,
passed `make verify-E9-T22t` again. Its evidence is
`target/evidence/e9-t22t-cold-2-1bbaaf6fd/`; report SHA-256
`d787d7f105dd8cbd992936202b57b11cca4943e0ac3415f6e3447bf618b338ef`,
guest trace SHA-256
`04d53c9bed9b8d7173053d3c61d444452e79337cffd8d302f6c3be58a0badc2e`,
Playwright trace SHA-256
`f88d8472f404c4dbdad99254c20de4ea3b73f816ce6693eb362bc2dd759c7465`.
The first sparse-clone attempt omitted two small, tracked, unrelated compile
fixtures in `evidence/e5-t11c` and `evidence/e5-t26p`; its Clippy error is
retained under `target/evidence/e9-t22t-1bbaaf6fd/cold-attempt1/`. Adding
those fixtures made the source checkout clean and the same command pass.

`make ci` reached workspace Clippy, then stopped on pre-existing dead-code
warnings in the unchanged `zicsr-stub` configuration of
`session_clock.rs`, `session_clock/sources.rs`, and `session_devices.rs`.
The exact log is `target/evidence/e9-t22t-1bbaaf6fd/gauntlet/e9-t22t-make-ci.log`.
Its remaining prescribed gates ran independently and passed: `make test`,
`make wasm`, `make features`, `make test-riscv`, `make riscv-tests-suite`
(128/128), `make determinism`, and `make perf-smoke` (64.4 MIPS versus the
15 MIPS floor). Their logs are in the same `gauntlet/` directory.

The claim is limited to the changed session-block boundary. A 1,179,648-byte
split virtio write now commits its exact COW bytes and used-ring status,
restores and reads back byte-identically, while an 8 MiB+512-byte request is
rejected before the backend. An 8 MiB read across 33 authenticated chunks
parks until complete within the 16 MiB cache, and mixed base/COW reads remain
atomic and restore identically. Host `MAX_RESULT` stays 1,048,320 bytes.
No first desktop frame, full Omarchy workload, or later performance budget is
claimed; E9-T22p and E9-T22c remain separate.
