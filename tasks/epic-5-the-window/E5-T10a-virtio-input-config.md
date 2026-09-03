---
id: E5-T10a
epic: 5
title: virtio-input config protocol and declarative device spec
priority: 510.1
status: verified
depends_on: [E5-T05c]
estimate: S
risk: high
capstone: false
---

## Goal

Build the reusable virtio-input identity and configuration boundary from a declarative
`InputDeviceSpec`, with explicit little-endian wire types and a bounded select/subsel query
state machine.

## Deliverables

- `VirtioInput` identity/config state for virtio device id 18.
- `InputDeviceSpec` carrying name, devids, property bits, event capability bitmaps, and absolute
  axis metadata.
- Typed ID_NAME, ID_SERIAL, ID_DEVIDS, PROP_BITS, EV_BITS, and ABS_INFO payloads with correct
  size semantics; unsupported selections return size zero and a zero payload.
- Native fixture tests for the QEMU-shaped configuration bytes and a wasm32 build/test mirror.

## Acceptance criteria

- ID_NAME, ID_DEVIDS, EV_BITS, and ABS_INFO for a fixture spec match the checked-in reference
  bytes, with the name compared separately.
- Unsupported select/subsel combinations return `size = 0` and read as zero without stale union
  bytes from the previous query.
- Every config read is bounded by the 128-byte union and every selector write/read round-trips
  identically on native and wasm32.

## Adversarial verification

Hammer selector changes followed by reads, including unsupported and maximum subsel values, and
prove no query exposes bytes from the previous selection or reads outside the fixed union.

## Verification log

### 2026-09-03 — worker — implemented

- **Config/spec boundary — HELD.** Added the virtio-input device id 18 with two queues, a
  declarative `InputDeviceSpec`, typed `InputDevids`/`AbsInfo` payloads, bounded property/event
  bitmaps, and the select/subsel query state machine.
- **Wire and zeroing behavior — HELD.** Native tests read ID_NAME, ID_DEVIDS, PROP_BITS, EV_BITS,
  and ABS_INFO through the real virtio-mmio config window, compare exact little-endian bytes,
  exercise width-2 selector writes, and prove unsupported/unknown/out-of-range reads return a
  zero payload without stale union bytes.
- **Cross-target coverage — HELD.** The same fixture is exercised by the wasm32 Node runner.

Implementation commit: `ea342ce`.

Evidence: `evidence/e5-t10a/input-config-2026-09-03.json` (SHA-256
`ef2c90efe7d55e899ca76df301a061863a9cb27c42d72eba0509abbca5334848`).

Commands: `cargo fmt --all -- --check`; `git diff --check`; `cargo test -p wasm-vm-core --lib
dev::virtio::input` (3 passed); `cargo test -p wasm-vm-core --lib --quiet` (222 passed);
`cargo clippy -p wasm-vm-core --lib -- -D warnings`; `cargo build -p wasm-vm-core
--no-default-features --target wasm32-unknown-unknown`; `cargo clippy -p wasm-vm-core --target
wasm32-unknown-unknown --no-default-features --lib -- -D warnings`; `cargo test -p wasm-vm-core
--test virtio_mmio_slots --test virtio_blk --test virtio_net_critic --quiet` (22 passed); and
`wasm-pack test --node crates/wasm --test input_config` (1 passed). Independent-machine, WebKit,
and host-layer rr runs were excluded per the user's direction and the repository's current
evidence policy.

### 2026-09-03 — verifier — VERDICT: verified (user-directed)

- **Acceptance — HELD.** The native and wasm32 fixtures agree on the supported name, devids,
  property, event-bitmap, and ABS_INFO payloads with exact little-endian layouts.
- **Unsupported-query isolation — HELD.** Selector changes to empty and unknown capabilities
  return size zero and a zeroed 128-byte union, including reads beyond the config boundary.
- **Coverage — HELD.** The changed virtio module registration, spec setters, bitmap sizing,
  payload encoding, selector writes, reset path, and config reads execute in the focused/native
  regression and wasm Node runner.
- **Evidence integrity — HELD.** Evidence digest
  `ef2c90efe7d55e899ca76df301a061863a9cb27c42d72eba0509abbca5334848` matches the checked-in
  artifact for implementation commit `ea342ce`.

E5-T10a is verified; E5-T10b is the next active eligible slice.
