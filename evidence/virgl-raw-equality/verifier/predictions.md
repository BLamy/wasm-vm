# Fresh E6-T12f1 verifier predictions — 2026-10-03

These predictions were written after reading the task and source diff from
`80813f4e45202cec3769d51b4f7d2b421034df01` to
`cdc9ebd14407976a2ea2fb5a5a2cf634078c2726`, before opening the new recorded evidence.
The authoritative source freeze is `a7be954c1f3bea9dd1e96522e890fa012197c6fe`.

- P1 — Evidence/source closure: the final cold report and receipt have the task's
  cited SHA-256 values, bind the actual compiler, generated artifacts, imported
  validators and fixtures, and reproduce from the retained exact-head clone.
  Runtime bytes after `e5359148` are identical; original retained evidence is
  carried forward only where its code, dependency and digest are unchanged.
- P2 — Raw equality: actual vertex feedback and fragment bit planes reconstruct
  exactly `0x00000000` or `0xffffffff`. Opposite signed zero is equal; every quiet
  or signaling NaN (including identical words) is unequal; a nonzero subnormal
  differs from zero; equal infinities are equal. The oracle classifies encodings
  independently, without converting exceptional raw words to host floats.
- P3 — Authority/snapshots: unknown self-comparisons keep runtime predicates;
  aliasing reads all RHS lanes before writes; computed numeric values compare
  their current raw snapshot; unwritten consumed lanes, modifiers, PRECISE,
  noncontiguous masks and unsafe direct output still reject.
- P4 — Obligations: loop12, indirect10/11, structured8/9 and finite-bank7 outrank
  equality13. Raw equality adds no numeric-bank dependency. The real consumer
  rejects every domain/access/count shape on13 and genuine unknown14, and does
  not invoke hostile getters.
- P5 — Compatibility: exactly the eight named integer/float stage bodies migrate
  unchanged to13. All4,004 other stage results, all264 retained pairs and all19
  original bodies/full results remain exact (12 accepted). Successor GPU probe
  prefixes and independent oracles are byte-exact; obsolete whole gates are not
  claimed.
- P6 — Bounds/recovery: native sanitizer runs use the reported bounded layouts,
  recover after all16 real allocation failures and malformed inputs; Wasm owns
  results/requests, uses the same16MiB buffer through64 maximal stress calls and
  real pressure failures, and loses no requested4KiB capacity.
- P7 — Sabotage sensitivity: each of the four emitted predicate source faults
  causes an independent realGPU word failure, with complete native/Wasm parity;
  a known-NaN fact fault rejects the four admission witnesses before GPU use.
- P8 — Diff coverage: each changed runtime hunk has positive typed LLVM/V8
  counters at the frozen run, including known equality, both opcodes, helper
  emission and13 consumer membership; declarative changes are explicitly waived.
- P9 — Strict receipts: independent receipt mutations using boolean/float
  counters, omitted dependencies, incorrect hashes/results and invented unknown
  profiles are rejected. Untampered evidence passes the same auditor.
- P10 — Novel bounded attack: independently seeded binary32 words, partially
  known operands and consumed-lane aliases preserve IEEE mask semantics and
  conservative output authority under the actual compiler and hardware.

No prediction claims guest graphics acceleration, all19 acceptance, PRECISE
semantics, performance, rr, or any unrelated workspace gate.
