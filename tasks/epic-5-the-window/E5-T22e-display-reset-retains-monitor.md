---
id: E5-T22e
epic: 5
title: Preserve the host monitor mode across guest GPU reset
priority: 522.25
status: verified
depends_on: [E5-T22a, E5-T22b]
estimate: S
risk: high
capstone: false
---

## Goal

Keep the physical host monitor dimensions, refresh and EDID across a virtio GPU
device reset, while clearing all guest-owned GPU state. Linux performs this reset
during boot, after the browser has already supplied its initial viewport size.

## Boundary

Only the reset ownership distinction in VirtioGpu and its deterministic native,
actual-Wasm and browser-worker tests. No compositor, pixel-presentation, renderer,
JIT, snapshot format, or guest-image change belongs to this slice.

## Acceptance criteria

- [x] Set an odd host mode, then perform a guest status=0 MMIO reset. The exact
      dimensions, refresh and all EDID bytes survive, in native and actual Wasm.
- [x] Resources, backing accounting, scanout, cursor, queue kick state and pending
      device events/IRQ are cleared; no old guest resource remains usable.
- [x] Repeated resets and repeated/new host mode requests remain deterministic.
      A fresh second VM instance still starts at the unchanged default mode.
- [x] Record the actual guest reset instruction trace and state digest; the built
      browser worker reads the preserved mode after executing the reset fixture,
      and the normal built demo still reaches 126 passed, zero failed/errors.

## Verification command

make verify-E5-T22e

## Adversarial verification

Reset during a pending host config event with live resources/cursor; verify stale
interrupts and resource references are gone while monitor identity remains.
Probe two resets in succession, new mode after reset, min/max/odd sizes, and a
fresh second VM instance to catch accidental shared monitor state. Independently
read EDID rather than accepting width/height counters alone. Sabotage preservation
once. Carry unchanged host-argument and stale-frame proofs from T22a/b forward.

## Verification log

### 2026-09-06 — coordinator — prerequisite discovered

T22c's first non-default initial-mode boot requests 901x701 before guest execution,
then stalls on an actual 1280x800 resource. VirtioGpu::reset restores monitor
defaults along with guest-owned resources. Preserve that reproduction under
`evidence/e5-t22c/initial-mode-reset-v3/`. This new S task separates the core reset
boundary from the blocked compositor adaptation work.

### 2026-09-06 — worker — in-progress

Activate the isolated reset prerequisite above the blocked T22c work-in-progress
branch. T22a/b dependencies remain independently verified. First record the
odd-mode reset regression against the old code, then make the ownership-only
reset change and prove native, actual-Wasm, browser-worker and fresh-VM behavior.

### 2026-09-06 — worker — implemented, frozen reset proof

Runtime change: `7490e64ea6414df978a0101f628a74df5481b0bf`. Final test/head:
`779efb7dfafc55db8ee476e3626a6d5f78b18a8c`. The later commit only strengthens the
native IRQ/cache observation; it does not alter runtime semantics. The preserved
old-code failure is `evidence/e5-t22e/red-native-reset.log` (expected 901x701,
observed 1280x800).

Authoritative command: `tools/verify/cold_clone.sh --keep verify-E5-T22e` from the
frozen head, with RUSTFLAGS/RUSTDOCFLAGS/RUST_LOG/CARGO_* scrubbed. Retained clone:
`/private/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/tmp.QTgy3W3bq1/repo`.
The self-contained target rebuilds wasm and installs pinned npm dependencies;
269 native GPU/core tests, five actual-Wasm tests, eight real guest reset fixtures
across direct/worker controllers and the built 126/0 demo pass, zero browser
errors. Scoped core/wasm-library strict clippy and fmt also pass. This is not a
claim that the unrelated previously recorded broad make-ci failures are fixed.

Evidence: `evidence/e5-t22e/acceptance.log` SHA256
`76e2a911d222a6fd84cd558830c9d9fe8a5a91740168d1bcdf29155f89318237`;
`evidence/e5-t22e/browser/browser-proof.json` SHA256
`0664a5a4929b92d61a37a2b9389ab17619548045ed4557795d431161ee4e79d0`;
`evidence/e5-t22e/browser/demo-suite.png` SHA256
`d23dc60df6f059ea4e9dd3846bbf7d14610a8300cf3b3905789827fb5a5da1b3`.
Rebuilt production wasm SHA256 is
`c1c854b8bb3b5cfbcc5a6a6f45199fca2151d7d949e7c707b546343504d7cb0f`, identical
in the worker checkout and the clean-clone browser proof. Initial 7490e64e results
remain separately preserved under `evidence/e5-t22e/initial-7490e64e/`.

The recorded guest executes `SW zero,112(t0)` at 0x80200004, writing zero to
0x10008070; its next `LW` at 0x80200008 reads GPU events=0 from 0x10008100. The
state digest `4e280b0d92d2251e2d0afeb62ccc8b03b35de2aaf6eb6c75d21b6227d14c4d25`
is the existing RAM/snapshot digest and **excludes GPU state**. GPU preservation
is instead established by the separately recorded, hash-bound direct observations
of dimensions/refresh and all 128 EDID bytes, independently decoded in the browser.
Native reset tests separately assert raw scanout/cursor/resource accounting,
pending and latched transport IRQ clearing, both cached queues invalidated with
old used-ring sentinels untouched, and same-mode event rearming. A fresh second
VM retains default monitor identity. This is a worker claim awaiting the fresh
verifier's reserved independent reset/reconfiguration attack and sabotage check.

### 2026-09-06 — fresh independent verifier — VERDICT: verified

- P1/P2/P8 HELD: frozen `779efb7d` source/artifact/evidence hashes match. Actual
  reset store at `evidence/e5-t22e/acceptance.log:530` is followed by events=0;
  native/actual-Wasm/direct/worker observations retain mode, refresh and all
  128 EDID bytes. Independent EDID decoding/checksums and 126/0/errors=[] hold
  in `evidence/e5-t22e/verifier/audit-evidence.log:2-13`. RAM digest is explicitly
  separate from GPU state. Screenshot inspected; full frozen cold-clone pass
  at `acceptance.log:656` is carried without a repeat.
- P3/P4/P5/P6/P7 HELD: independent 1373x907 attack combines live resource/backing,
  cursor, pending vs latched config+used IRQ, double MMIO reset and same-mode
  rearming before queue reconfiguration. New rings complete 5 control + 2 cursor
  requests; stale resource id 43 is rejected until recreated; old ring/response
  sentinels remain intact and fresh devices retain default identity. Both cases
  pass at `verifier/independent-attack.log:7-10`; worker IRQ/cache test also passes
  at `acceptance.log:221`.
- S1 HELD: one restoration of old monitor-reset assignments in a disposable
  copy makes all three focused reset tests fail with the expected default-mode
  mismatch (`verifier/sabotage.log:7-17`, exit 101). Shared runtime untouched.
- COVERAGE/SUITE: promote `crates/core/src/dev/virtio/gpu/reset_verifier_tests.rs`
  through the existing test module; formatting and focused promoted run pass
  (`verifier/promoted-test.log`). Full prediction results, hunk coverage,
  integrity hashes and scope limits: `evidence/e5-t22e/verifier/final-verdict.md`.
  T22a/b HELD boundaries unchanged by this reset diff carry forward. No claim
  about compositor adoption or unrelated broad-suite baseline failures.

Commands: `node evidence/e5-t22e/verifier/audit-evidence.mjs`;
`cargo test -p wasm-vm-core --lib --features gpu-trace
display_reset_verifier_reconfigured_rings_reject_stale_resources -- --nocapture`;
single disposable-copy sabotage run with filter `display_reset_`;
`cargo fmt --check -p wasm-vm-core`; standalone promoted-test rustfmt check.
No runtime fix, other task-status edit, push, merge, or deployment.
