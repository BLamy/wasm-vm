---
id: E6-T12g6m5b1
epic: 6
title: Authenticate original 92cb compositor draw-time quad geometry
priority: 525.0270105821
status: implemented
depends_on: [E6-T12g6m5a]
estimate: S
risk: high
capstone: false
---

## Boundary

Reconstruct every original 7bf4d0d0/92cb866a draw's paired constant banks, vertex elements, buffers, resource lifetime, draw parameters, and draw-time backing from authenticated VirGL packets and snapshots. Prove the exact vertex input used by the recorded draws is the finite `[0,1]` quad or reject. This is a capture fact only: a future compiler or renderer must separately enforce the geometry at draw time. Do not grant a shader numeric certificate or production admission here.

## Deterministic acceptance

`make verify-E6-T12g6m5b1` independently parses and hashes the original capture, inventories all 1,957 relevant draws and every buffer snapshot and mutation, emits a bounded geometry/paired-bank artifact with packet citations, and rejects changed vertex coordinates, format, binding, lifetime, count, source and bank. A native/Wasm verifier consumes that artifact byte-identically and computes the bounded `CONST[4] * uv - CONST[0]` first-power base for each captured bank, including endpoint and interior values. Record exact-head evidence and a pristine clone; submit to a fresh critic.

## Adversarial verification

Attack stale backing, resource-ID reuse, write-after-snapshot, vertex format and offset, indexed/instanced topology, negative/nonfinite vertex words, bank/source substitutions, and arithmetic overflow. A sampled pixel alone cannot bound every accepted fragment. Inspect packet citations and the entire draw set; the translator must still reject the unchanged full original shader without geometry authority.

## Verification log

### 2026-10-05 — worker — implemented; adversarial verification requested

Source head `77aee01dc216b03d3dd5c5620c3c138b8187531c`. Ran `make verify-E6-T12g6m5b1` and `python3 tools/virgl-92cb-geometry/cold.py target/evidence/virgl-92cb-geometry/cold-exact` at that exact head, then sealed `evidence/virgl-92cb-geometry/worker/recording.tar.gz` (SHA-256 `be2329a85314bea6a9d843216182ebbec0a86d03bfc42f9dc7b94e734502cf3e`) and `records.json` (SHA-256 `59ba8f7678cde050ad952c022ee13f09ca958df7af5a30fac24545514a56698d`). The 34 recorded files include authenticated packet/draw citations, the 1,069 vertex-resource snapshots, complete three-bank binary, native/Wasm byte-identical outputs, fault rejections and native coverage. The pristine clone passed with empty before/after status. Independent endpoint arithmetic over all four vertices and captured banks gives maximum first-power bases `(306,306)`, `(1030,774)` and `(988,732)` for all interpolated UVs in `[0,1]`. Both full original pair entry points remain rejected; this capture-only result grants no future draw or shader numeric authority. `make ci` was attempted at the frozen head and fails in untouched macOS-incompatible `crates/wvseccomp` libc symbols and existing `items_after_test_module` Clippy error in `crates/core/src/dev/virtio/gpu/mod.rs`; log at `target/evidence/virgl-92cb-geometry/make-ci.log`.
