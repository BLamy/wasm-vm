---
id: E6-T12g6m5b1
epic: 6
title: Authenticate original 92cb compositor draw-time quad geometry
priority: 525.0270105821
status: in-progress
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
