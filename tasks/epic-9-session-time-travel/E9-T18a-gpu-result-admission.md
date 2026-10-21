---
id: E9-T18a
epic: 9
title: Own GPU result bytes and completion admission at guest event boundaries
priority: 524.9181
status: in-progress
depends_on: [E9-T17, E9-T09, E9-T14]
estimate: S
risk: high
capstone: false
---

## Goal

Make native guest-visible GPU DMA and completion effects deterministic inputs.

## Boundary

The native GPU result adapter and exact event-boundary admission. Bind immutable
result bytes, request/context/backing identity, exchanges and fence/error outcomes
to their actual guest-visible positions. Host completion callbacks retain owned,
revocable mailboxes and never borrow Machine reentrantly. Snapshot/pending restore
is E9-T18b; Wasm/durable/hardware presentation integration is E9-T18c. Until those
are accepted, unsupported recording/keyframe profiles remain explicitly gated.

## Acceptance criteria

- [ ] Record scatter/readback bytes and completion/query/error/fence envelopes at
  their real ordered event boundaries; replay supplies exact recorded effects
  without accepting live host substitutions or advancing past a missing result.
- [ ] Support the admitted production exchange bound with bounded owned payloads
  and atomic admission; do not truncate a result or silently narrow 32 MiB DMA to
  the existing device adapter's smaller inline limit. Failed admission leaves
  guest RAM, rings and committed event position unchanged.
- [ ] An actual RV64 instruction-driven virtqueue/DMA workload has matching CPU,
  RAM, response/ring and GPU virtual-state witnesses under changed host result
  bytes and completion schedules. Missing/corrupt/wrong-intent/stale results have
  explicit outcomes. This native proof does not claim physical GPU presentation.

## Deterministic acceptance

`make verify-E9-T18a`. Implement one deterministic native result-admission command
with guest traces, exact state/effect digests and recorded failures, plus the
high-risk submission required by AGENTS.md. No passing command is claimed yet.

## Adversarial verification

Vary upload/draw/readback timing and returned bytes. Corrupt one recorded result,
duplicate/reorder an exchange, exhaust a payload/batch bound and deliver an old
mailbox reply. Require precise refusal/divergence, no partial DMA/ring effects,
no live replay substitution and no unresolved control request. Prove the test
detects one removed admission/identity guard. Pending capture remains refused
until E9-T18b, rather than silently losing owned results.

## Verification log

### 2026-10-21 — worker — start native result boundary

Selected after independently verified and publicly deployed E9-T17. This is the
first replacement for the E9-T18 planning container. Runtime implementation and
recorded acceptance are pending; only this task enters the active lane.
