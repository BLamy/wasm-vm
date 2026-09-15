# E5.5-T03w independent critic predictions

Recorded before worker arithmetic evidence or test output is inspected. Starting
runtime boundary is `f0833e1c`; activation is `127332e5`. Existing T03t/T03u/T03v
HELD predictions carry forward only where source/dependency boundaries and sealed
evidence stay unchanged. This review never equates arithmetic support with an
interactive desktop.

- P1 literal rounding: FADD.S(+1,+2^-24) yields 0x3f800000 under RNE/RTZ/RDN
  and 0x3f800001 under RUP/RMM, always NX. The negative counterpart rounds to
  0xbf800001 under RDN/RMM and 0xbf800000 under RNE/RTZ/RUP. Opposite-signed
  cancellation produces -0 only for RDN. Result writes are NaN-boxed.
- P2 multiplication edges: FMUL.S(min-subnormal,+0.5) yields +min-subnormal
  only under RUP/RMM and +0 otherwise, with UF|NX. Its negative counterpart
  yields -min-subnormal under RDN/RMM and -0 otherwise, with UF|NX. Exact
  min-normal * 0.5 is subnormal 0x00400000 with no flags. Overflow yields the
  correctly directed infinity/max-finite and OF|NX.
- P3 special values/flags: signaling NaNs and 0*infinity accrue NV; quiet NaNs
  and malformed single boxes yield canonical quiet NaN without NV unless the
  other operand independently requires NV. Previously set fflags stay sticky;
  frm is unchanged; successful arithmetic dirties FS. Integer state and every
  non-destination FPR preserve raw bits, including all destination aliases.
- P4 illegality and calls: each legal selected operation invokes the arithmetic
  helper once. FS-Off, static rm=5/6, and dynamic frm=5/6/7 invoke it zero times,
  exit at the original virtual fault PC with the complete original parcel, and
  preserve FPR/flags/FS after an already retired integer or arithmetic prefix.
- P5 handoff: direct same-module and cross-module successors consume freshly
  rounded results and sticky flags; remaining/depth budget exits preserve the
  completed prefix. Interpreted fcsr replacement affects the next dynamic
  arithmetic operation and does not resurrect old flags. Later load/store
  faults preserve earlier arithmetic while leaving suffix state untouched.
- P6 growth/imports: private and shared generated modules instantiate and call
  the new pure helper with correct import/function indices. An MMIO store that
  grows outer WASM memory runs once; arithmetic before/after it and subsequent
  fault/import refresh preserve result bits/flags. Integer-only blocks and
  unselected FP families retain prior admission/fallback behavior.
- P7 bounded novel attack: independently seeded exactly representable integer
  operands, alias layouts and illegal modes reproduce the arithmetic identity
  in all five modes without invoking interpreter/SoftFloat to compute goldens.
  A same-block rounded-result -> multiplication dependency must read the new
  FPR and retain NX across a following precise illegal instruction exit.
- P8 sabotage: changing one literal FADD.S half-ulp expected value in an
  isolated test copy causes a deterministic nonzero test result, and restoring
  the golden causes the same case to pass. No shared implementation is changed.
- P9 final chain: worker logs and seals bind the final source, guest and WASM
  hashes; exact-head ordinary acceptance and pristine clone succeed. Built/live
  pages pass 127/127 ISA tests with zero errors and execute the arithmetic guest.
  Public artifact bytes match the tested bundle.
- P10 physical input: independently inspect the unchanged 120-second physical
  keyboard trial report and before/final terminal images. A usable-desktop claim
  requires both independent nonce readback and visible terminal response. T03q
  remains gated when either is absent, regardless of arithmetic correctness.

No runtime verdict has been reached. CPU-heavy runs are held for coordination
with the worker and must not overlap its physical-input measurement window.
