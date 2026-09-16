# FDIV.S independent predictions — 2026-09-15

Recorded before inspecting worker evidence or running the implementation. Parent
`dffdff3548b5cbc22ee9ede6e5a3233c2cea79fd` is already verified. Unchanged
predecessor instruction/helper proofs carry forward; this critique attacks only
division and its changed dependency boundary.

## Numeric predictions

Modes are RNE, RTZ, RDN, RUP, RMM. Flags are NX=1, UF=2, OF=4,
DZ=8, NV=16. Expectations use exact rational integer arithmetic, never host
floating point, APFloat, the interpreter, or the new helper.

- P1 `3f800000 / 40400000` (1/3) yields
  `[3eaaaaab,3eaaaaaa,3eaaaaaa,3eaaaaab,3eaaaaab]`, all NX.
  The negative numerator produces
  `[beaaaaab,beaaaaaa,beaaaaab,beaaaaaa,beaaaaab]`, all NX.
- P2 minimum subnormal / 2 gives `[0,0,0,1,1]`, all UF|NX.
  Three minimum subnormals / 2 gives `[2,1,1,2,2]`, all UF|NX.
- P3 `00ffffff / 40000000` is exactly `2^-126 - 2^-150`.
  It yields `[00800000,007fffff,007fffff,00800000,00800000]`,
  **all UF|NX**. Tininess-after-rounding uses precision-24 rounding with an
  unbounded exponent, before the reduced subnormal precision. The final normal
  result alone cannot establish that UF is absent.
- P4 `00800000 / 3f800001` yields
  `[007fffff,007fffff,007fffff,00800000,007fffff]`, all UF|NX.
  `00800000 / 40000000` is exact `00400000`, flags zero.
- P5 `7f7fffff / 3f000000` and `7f7fffff / 3f7fffff` yield
  `[7f800000,7f7fffff,7f7fffff,7f800000,7f800000]`, all OF|NX.
  Negative results interchange the directed infinity/saturation directions.
- P6 finite nonzero / signed zero yields signed infinity and DZ; infinity /
  signed zero yields signed infinity with no flags. Zero / zero and infinity /
  infinity yield canonical `7fc00000` and NV. Finite / infinity yields signed
  zero with no flags. Quiet NaNs canonicalize without NV; signaling NaNs add NV.
  A malformed source box is a quiet canonical NaN regardless of its low bits.

Primary references inspected while predicting:
[Berkeley SoftFloat f32_div](https://raw.githubusercontent.com/ucb-bar/berkeley-softfloat-3/master/source/f32_div.c)
lines 75–93 (infinity/zero precedence) and
[roundPackToF32](https://raw.githubusercontent.com/ucb-bar/berkeley-softfloat-3/master/source/s_roundPackToF32.c)
lines 64–71 (tininess before the subnormal shift), 73–78 (overflow).

## Integration predictions

- P7 All five static modes ignore reserved frm; dynamic rm uses current frm.
  FS Off, static rm 5/6, and dynamic frm 5/6/7 exit before any helper call.
  They retain raw parcel, exact virtual PC, retired prefix, all FPRs and flags.
- P8 A legal instruction calls only `fp_div_s(a,b,resolved_rm)` once, with each
  bad box canonicalized independently. The helper has no mutable execution
  context. It returns only raw result plus flags. Generated code changes exactly
  the destination FPR, its one dirty bit, the FP-written marker, accrued flags,
  and normal PC/exit bookkeeping. f0 is writable; x0 remains zero.
- P9 Division alone has function import 5. Each of the eight combinations of
  arithmetic/from-integer/to-word preceding imports shifts it by the number of
  enabled predecessors, through index 8 and nine function imports. Actual
  exports and direct calls use those indices. Integer-only import layout stays
  unchanged, and unselected arithmetic/format families stay excluded.
- P10 Same- and cross-module successors see a boxed division result and sticky
  flags immediately. Block budgets stop before a whole successor. Later memory
  faults commit exactly the retired division prefix; an interpreted CSR write
  replaces live flags/frm before re-entry.
- P11 A real `WebAssembly.Memory.grow(1)` inside an MMIO store separates two
  division operations safely in private and shared memory. No prefix replay,
  lost flag/FPR publication, stale view, or post-fault write is permitted.
- P12 One isolated literal sabotage must make the verifier fail and the
  restored fixture must pass. Final source, artifact and guest hashes must bind
  worker records; cold acceptance must run on the final exact source revision.
- P13 Production guest divisions compile; the page has 127 passing ISA tests
  and no console errors. Physical typing still has the original 120-second
  independent nonce and real visible-output requirements. A failed physical
  trial leaves T03q gated regardless of instruction proof.

Novel bounded attack: distinguish a normal final result with UF|NX from an
exact normal result by comparing `00ffffff/40000000` with
`00ffffff/3fffffff`, in all modes and both signs, across actual generated
modules and the interpreter.
