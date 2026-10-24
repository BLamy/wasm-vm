---
id: E9-T22l
epic: 9
title: Admit bounded local session metadata above the portable payload cap
priority: 524.922029
status: in-progress
depends_on: [E9-T22k]
estimate: S
risk: high
capstone: false
---

## Goal

Let a real long exact-GPU local session continue beyond the shared manifest's
4 GiB aggregate payload cap without changing portable archive admission.

## Boundary

One explicit local-versus-portable manifest policy in the native codec and
its browser callers. Local validation, append, references, publication, open,
GC and reader paths may admit a bounded history above 4 GiB. Portable bundle,
storage-only witness archive and immutable import/export keep the 4 GiB bound.
Keep the 4 GiB per-blob bound, 1 MiB encoded manifest bound, index limits,
64 GiB local graph ceiling, 8 GiB configured physical retention, object
hashing, replay semantics and checkpoint cadence unchanged. E9-T22c owns the
next complete cold-workload run.

## Acceptance criteria

- [ ] Independently reproduce the exact E9-T22c `cold-257` rejection from
      the retained failed prefix, account for committed/candidate event and
      checkpoint lengths, and admit the candidate through local validation.
- [ ] Prove above-4-GiB local publication, reopen, witness graph inventory,
      GC and GPU-reader admission with intact references and no revision or
      epoch acknowledgement on failure. A local aggregate bound remains explicit.
- [ ] Prove the same candidate is rejected for both portable export paths and
      immutable archive admission; preserve the old per-blob and 4 GiB portable
      boundaries on native and Wasm.
- [ ] Run scoped high-risk native/Wasm/browser gates, threat-model attacks,
      exact-head evidence and a final cold clone; obtain a fresh actual
      Daybreak adversarial verdict and verify the production demo.

## Deterministic acceptance

`E9_T22L_DESKTOP=target/evidence/e9-t22c-submission-bcc6bc1c4/desktop make
verify-E9-T22l`: reconstruct and replay the saved failed candidate in a copy
of the retained browser state, run focused native/browser policy attacks and
the built demo. A pristine clone must point `E9_T22L_DESKTOP` at the retained
absolute path. A resumed prefix is not C's full workload acceptance.

## Adversarial verification

Cross 4 GiB with deduplicated checkpoint references and event chunks. Admit a
local candidate below its explicit ceiling, reject one byte above that ceiling,
and prove rejection is atomic. Attempt portable export/import through every
entry point, including a misleading `scope: local`; reject oversized single
blobs, malformed append prefixes and absent/corrupt referenced objects. Audit
every changed caller so archive and immutable readers cannot silently choose
local policy. Sabotage one bound assertion and prove the focused test fails.

## Verification log

### 2026-10-24 — planning — exact failed C prefix retained

`E9-T22c` failed at transition `12900000000` under exact head
`bcc6bc1c4a8eb7d6cb82a1ffc1653b2827d63a60` with
`TooLarge("session payload")`. The independent Daybreak calculation puts the
candidate at `4296534553` aggregate bytes. The unchanged failed report and
saved graph are in
`target/evidence/e9-t22c-submission-bcc6bc1c4/desktop/`. This task changes
the shared metadata policy only; complete workload qualification stays in C.
