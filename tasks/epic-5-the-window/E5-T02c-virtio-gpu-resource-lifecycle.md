---
id: E5-T02c
epic: 5
title: virtio-gpu resource unref and scanout lifecycle
priority: 502.3
status: implemented
depends_on: [E5-T02b]
estimate: S
risk: high
capstone: false
---

## Goal

Complete the resource lifecycle with `RESOURCE_UNREF`, scanout-bound cleanup, and deterministic
leak coverage. Destroying a resource releases its host pixels and backing metadata exactly once
and leaves scanout state unable to reference the removed id.

## Context

Scanout and later transfer/flush work retain resource ids across queue commands. Unref must
therefore coordinate with the device's scanout binding instead of merely deleting a map entry.
The lifecycle slice also provides the direct proof that repeated mode-setting churn returns the
resource budget to baseline.

## Deliverables

- `RESOURCE_UNREF` dispatch with unknown-id and malformed-request errors and idempotent cleanup
  of host pixels/backing state.
- Scanout binding integration: unref of a bound resource disables or clears that scanout before
  removing the resource.
- Native lifecycle tests for create→attach→detach→unref, unref with backing attached, bound
  scanout unref, duplicate/unknown unref, and 10,000 create/unref cycles.
- Accounted-byte and resource-count assertions that make ownership leaks observable.

## Acceptance criteria

- [ ] Create→attach→detach→unref returns OK at each step, leaves no resource, and restores
      accounted bytes to the pre-create baseline.
- [ ] Unref of a scanout-bound resource clears the binding and cannot leave a dangling id;
      subsequent scanout/transfer lookup reports the resource as absent.
- [ ] 10,000 create/unref cycles show zero net growth in accounted bytes and resource count.
- [ ] `cargo test -p wasm-vm-core --lib gpu_resources_lifecycle` passes with exact cleanup
      assertions.

## Adversarial verification

Unref an unknown id, unref twice, unref while backing is attached, and unref one of two
resources sharing the same guest pages. The surviving resource must remain usable and the
scanout must never point at freed host pixels. Run the lifecycle loop with varying valid
formats and dimensions to catch format- or size-specific leaks.

## Verification log

### 2026-09-03 — worker — implemented

- **UNREF cleanup — HELD.** `RESOURCE_UNREF` parses the fixed request, rejects unknown ids,
  clears scanout 0 before removing the resource, drops host pixels/backing metadata, and
  decrements exact accounted bytes. A repeated unref and truncated request both return bounded
  errors while the queue continues publishing used entries.
- **Lifecycle accounting — HELD.** Native tests cover create→attach→detach→unref, a bound
  scanout resource, device reset, and 10,000 create/unref cycles across all supported formats;
  every cycle returns to zero accounted bytes and zero live resources.
- **Scope — HELD.** SET_SCANOUT and pixel presentation remain owned by E5-T03; this slice only
  owns the dangling-reference cleanup boundary.

Implementation commit: `ecf0922`.

Evidence: `evidence/e5-t02c/resource-lifecycle-2026-09-03.json` (SHA-256
`93e326641a0425a4004563484614870e05e7a4e27eb27d0c4c4261b9f0366e1c`).

Commands: `cargo fmt --all -- --check`; `git diff --check`; `cargo test -p wasm-vm-core --lib
gpu_resources_lifecycle` (4 passed); `cargo test -p wasm-vm-core --lib` (199 passed); `cargo clippy
-p wasm-vm-core --lib -- -D warnings`; `cargo build -p wasm-vm-core --no-default-features
--target wasm32-unknown-unknown`; `cargo clippy -p wasm-vm-core --target
wasm32-unknown-unknown --no-default-features --lib -- -D warnings`; `cargo test -p wasm-vm-core
--test virtio_mmio_slots --test virtio_blk --test virtio_net_critic` (22 passed); and
`wasm-pack test --node crates/wasm --test gpu_protocol` (2 passed). Independent-machine, WebKit,
and host-layer rr runs were excluded per the user's direction and current repository evidence
policy.
