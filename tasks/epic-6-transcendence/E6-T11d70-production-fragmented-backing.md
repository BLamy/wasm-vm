---
id: E6-T11d70
epic: 6
title: Admit bounded fragmented original production GPU backing
priority: 525.027049
status: in-progress
depends_on: [E6-T11d69b]
estimate: S
risk: high
capstone: false
---

## Boundary

The qualified production transport and retained browser resource store inherit
an old256-segment backing ceiling despite the32MiB production byte boundary.
Linux uses original page-fragmented attachments larger than256 entries. Select
one bounded16384-entry ceiling only for production, matching the pinned QEMU
mapping ceiling. Preserve every historical private profile's256-entry ceiling,
RAM address/length/padding validation, complete packet framing, byte budgets,
generation ownership and failure atomicity. Do not skip, merge or fabricate
original entries or suppress any transport error.

## Deterministic acceptance

`make verify-E6-T11d70` records native original Machine/MMIO/virtqueue requests
and actual hardware Wasm production attachment/upload/readback through the
retained store. Exercise256,257,420,16384 and16385 entries, independent literal
per-segment bytes and complete scatter/gather output guards; check original
headers, one response per request, guest traces and machine/state digests.
Check zero/excess count, truncated packet, nonzero padding, zero length,
outside-RAM/final-entry overflow, duplicate attach, and byte-budget overflow
before any partial attachment. Refused requests leave generation/state/native
owners unchanged; a later valid attachment remains usable. Private256 admits
and257 refuses; host overrides may reduce the production ceiling but cannot
raise it. Run affected format/clippy/native/Wasm gates, hardware schedules0/1/2,
ordinary built demo127/0 and one exact-head pristine clone.

## Adversarial verification

A fresh verifier authenticates the original bytes and predicts response/state
before inspecting recordings. Invent one bounded last-segment or descriptor
attack, independently vary schedules, and sabotage the production segment
selector or final-entry RAM/budget check so the recorded oracle must fail.
Carry unchanged prerequisite holds forward. Any unexplained actual guest
ATTACH or TRANSFER rejection remains a parent bring-up gap, never a whitelist.

## Verification log

Pending parent integration exposed unbacked original textures following rejected
ATTACH_BACKING requests. The fresh critic identified an earlier original420-entry
attachment rejected with0x1205 and the shared256 limit at
`control3d.rs:17/1063` and `resources.mjs:186`. Its bounded known-valid original
MMIO reproduction distinguishes count admission from malformed source entries.
The parent is not complete; old failures and original SG validity remain
preserved rather than inferred harmless.
