---
id: E6-T12f4a
epic: 6
title: Preserve ordered nonprefix destination masks in checked shader writes
priority: 525.02699141
status: pending
depends_on: [E6-T12f4]
estimate: S
risk: high
capstone: false
---

## Boundary

Untouched lighting bodies 12f6d594 and d4f702f7 finish with
`MOV OUT[1].yz, IN[2].xxyx`. The parser admits xy/xyz and single-lane
destinations but rejects this ordered yz subset. Accept bounded ordered unique
destination subsets without changing source swizzles, declaration or output
authority. Snapshot consumed sources before aliased writes and preserve
untouched lanes. Keep declared component limits and reject duplicate/reversed
masks. This is separate from the PRECISE word-operation boundary.

## Deterministic acceptance

`make verify-E6-T12f4a` records every nonempty destination subset in both stages,
aliases/swizzles and untouched-lane witnesses, duplicate/reversed/undeclared
write failures, native sanitizer/Wasm parity and independent shared-renderer
GPU words. Record unchanged 12f6d594/d4f702f7 compile/link with capture hashes
and existing finite-bank contracts, caps and final pristine clone.

## Adversarial verification

Widen yz to xyz, map sources from mask position instead of destination lane,
overwrite a neighbor or publish an aliased destination early. Actual compiler
faults must fail the independent word oracle. Preserve the separate arithmetic
and ordinary output-authority boundaries.

## Verification log

### 2026-10-03 — worker — planning evidence

F4 read-only diagnostics isolate the existing rejection at original 12f6d594
instruction17 and d4f702f7 instruction27. Unmarked versions reject identically.
`register_name` permits xy/xyz or one component. This task precedes the
integration-only closure task; diagnostics are planning context, not evidence.
