# E5.5-T03y independent critic predictions

Recorded before inspecting the worker's final evidence. Boundary: FCVT.W.S and
FCVT.WU.S; neither instruction changes an FPR. Modes below are RNE, RTZ, RDN,
RUP, RMM. `NX=1`, `NV=16`; NV suppresses newly accrued NX.

- P1 — Literal state. For +1.5, the integer results are [2,1,1,2,2], all NX;
  for -1.5 signed results are [-2,-1,-2,-1,-2], all NX. For +2.5 results
  [2,2,2,3,3]; for -2.5 signed results [-2,-2,-3,-2,-3]. Both signed zeros
  convert exactly to zero. Positive minimum subnormal returns [0,0,0,1,0],
  all NX; negative minimum subnormal signed returns [0,0,-1,0,0], all NX.
- P2 — Unsigned negative edge. For -0.5, WU results are zero in all modes,
  with flags [NX,NX,NV,NX,NV]. For -0.25 flags are [NX,NX,NV,NX,NX]. For
  -0.75 flags are [NV,NX,NV,NX,NV]. -1 returns zero/NV in every mode.
- P3 — Clipping and extension. S bits 0x4effffff produce signed 0x7fffff80
  exactly; 0x4f000000 clips W to 0x7fffffff/NV but WU produces
  0xffffffff80000000 exactly. 0x4f7fffff produces WU
  0xffffffffffffff00 exactly. 0x4f800000 and positive infinity yield
  WU 0xffffffffffffffff/NV; negative infinity yields W 0xffffffff80000000/NV
  and WU zero/NV. Both NaN signs, quiet/signaling NaNs and malformed source
  boxes yield the positive clipped maximum/NV. No newly accrued NX accompanies
  an invalid conversion.
- P4 — Architectural isolation. Every legal conversion preserves all 32 FPRs,
  every unrelated X register, x0 and frm; prior flags OR the new flags. FS=1/2/3
  becomes Dirty with SD set, including an exact conversion discarded into x0.
  Source f0 is an ordinary FPR; f31 and equal source/destination register
  numbers do not confuse the separate register files.
- P5 — Illegal precision. FS-Off, static rm=5/6 and dynamic frm=5/6/7 call the
  conversion helper zero times. An integer prefix retires, later instructions
  do not execute, the exact raw parcel and virtual fault PC are published,
  FPR/fflags/FS stay unchanged, and inline retired count includes only prefix.
- P6 — Real helper ABI. Instrumented generated modules pass unboxed source
  bits (canonical 0x7fc00000 for a malformed box), unsigned=0/1 and resolved
  rm=0..4 exactly once per legal conversion. Base imports remain indices 0..4;
  to-word alone is index 5, after either earlier helper index 6, and after both
  arithmetic/from-int index 7. Function exports and direct calls shift by the
  actual optional import count. Integer-only modules retain five imports and
  unchanged behavior. L/LU and D conversions remain unsupported by lowering.
- P7 — Publication. Same/cross-module successors consume the converted integer
  and respect budgets; a later load/store/illegal fault publishes only completed
  conversions. A genuine interpreted fcsr write changes the next dynamic mode
  and clears old flags without their resurrection. Actual private/shared browser
  memory growth inside a store import occurs once and preserves conversion
  results/flags both before and after growth and through a later fault.
- P8 — Coverage/identity. Final native/private/shared tests and built production
  conversion guest execute the changed paths; 127 ISA tests pass without browser
  errors. Source, artifact, guest, cold clone and public bundle identities agree.
  A deliberately wrong literal in an isolated test copy causes its targeted
  assertion to fail; the restored source passes.
- P9 — Physical product result. The single physical keyboard run must retain
  the original 120-second deadline. Its nonce readback and actual terminal image
  are inspected independently. Instruction support alone cannot make T03q
  verified; any missing nonce or unchanged terminal image keeps that gate closed.

Unchanged HELD results from T03x may be carried forward only where source,
dependency boundary and cited evidence digest remain unchanged. All new
conversion/import/publication claims require this task's evidence.
