# E9-T05 repaired-boundary predictions

2026-10-18: read repair diff `1f7a8f27..4ce36a932feaf171c09cd8b25e90d3fc9ff376ac`
and complete updated task before opening the repaired evidence. Existing unchanged
P0–P5, unrelated P6/P7 and P9 findings remain HELD under the incremental policy.

- **R0 provenance.** The repaired report has digest
  `f503e646a19c05ed7a1c33ecd64cae767eaedc33cf06f8acfd01021a2d1aed37`, frozen head
  `4ce36a932feaf171c09cd8b25e90d3fc9ff376ac`, 543 authenticated originals and 42
  source hashes. Every compact identity/gzip copy and alias matches its original.
- **R1 ABA repair.** Both original producer-buffer schedules either reject without
  changing the committed manifest/revision or successfully admit the original coherent
  snapshot. On successful publication, frame and root disk hashes match, the original
  frame hash survives ABA, and leaf bytes are respectively 67/67 and 68/68. Ordinary
  mutation/detachment likewise retains the coherent original snapshot or refuses
  atomically; configuration pinning and the strict append winner remain true.
- **R2 source ownership.** The only semantic repair bounds the frame and copies it before
  hashing, parsing or any await. Every subsequent tuple view and machine-object chunk
  comes from that owned buffer. Generated source/dist copies agree, runtime identity
  derives from the changed source, and retained GPU factory bytes remain unchanged.
- **R3 repaired guest proof.** Before/restored raw tuples and all 16 native sections are
  byte-identical (frame digest `f558b633c4605c93b5a1770f219f6759dd1cb147f8879e271b3afe446f50b047`).
  Independent sparse RAM and disk decoding agree with exact clock/base/generation and
  queued UART/held-key witnesses. Fresh filesystem reads recover before/restored
  `e9:before\n` and advanced `e9:after\n`; the guest prints its saved memory/UART values.
- **R4 sufficiency.** The repaired recorded gates exercise the promoted tests and all
  changed runtime hunks, or the remaining hunk has a narrow type/configuration/logging/
  defensive unreachable-path waiver. Browser block counts support JavaScript execution;
  native codec/integration calls and deterministic guest traces support Rust routes.
  No new product requirement is introduced by this audit.
- **R5 freeze.** Complete the pre-cold audit and freeze tests without claiming the one
  final pristine-clone or public-deployment proof. Those remain NEEDS EVIDENCE until
  the root supplies their exact-head recordings.

Before the loader topology attack: a saved configuration with a correctly hashed but
false UART kind must refuse and leave the original paused source usable. The schema
correctly refuses an unknown kind before candidate construction. The final fixture
keeps the supported kind and changes only its valid-range IRQ to 1; this should reach
and fail the comparison against the actual constructor topology, free only that
private candidate, and leave the original source usable.
