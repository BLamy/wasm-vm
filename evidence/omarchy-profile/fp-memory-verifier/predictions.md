# E5.5-T03u successor verifier predictions

The verifier read AGENTS.md, the task, and the activation-to-working-tree diff
before inspecting execution evidence. Original P1–P22 in
`../fp-memory-critic/predictions.md` carry forward; this file fixes the additional
bounded predictions before running the new functional checks. Runtime is not yet
frozen; provisional runs cannot support the final verdict.

- **V1: independent raw-bit seeds.** For seeds `d42ac871159e630b`,
  `096af321ca778de5`, and `6b049fa73518dc21`, a malformed raw FPR written by an
  interpreter FLD, then FSW/FLW/FSD/FLD through a generated block, preserves the
  low word exactly, boxes loads only, and never borrows the same-index X value.
  Every named untouched register and neighboring byte remains unchanged.
- **V2: compressed maximum offsets.** Literal parcels `3c60`, `bc60`, `307e`,
  `bf82` access offsets 248, 248, 504, 504 respectively. Each retires two-byte
  instructions; FS Off reports the original parcel after the two-byte integer
  prefix. C.FLDSP/C.FSDSP use f0 legally. Failure never alters data or fcsr.
- **V3: interior PMP denial.** An aligned successful access at the beginning of
  a page cannot fill a whole-page inline tag when an earlier PMP entry denies
  eight interior bytes at page+128. The second FP access at that interior must
  fault once and preserve its destination/data in S mode, MPRV with effective
  S mode, and locked M mode. Unlocked M mode may access both words.
- **V4: effective privilege transition.** After permitted warm M-mode accesses,
  enabling MPRV/MPP=S on the same Hart and same executor must revoke the previous
  inline permission. The next access to the denied interior returns the exact
  access fault, at the current virtual entry, before its FP effect.
- **V5: view refresh.** Carry original P19 into the supplied growth fixture:
  an actual memory.grow in a synchronous MMIO import must preserve the prior
  FLW write, one device effect, FS Dirty, unchanged fflags/frm, and exact success,
  store-fault, or later-load-fault prefix in private and shared modules.
- **V6: partial RAM page and trigger eligibility.** A valid transfer in the
  last partial RAM page cannot authorize an aligned address beyond RAM in the
  same page. An armed data trigger at page+128, after warming the page, fires
  before the second transfer; retargeting that still-armed trigger to the first
  address fires before either transfer. This exercises the new helper's RAM
  and trigger rejection branches through real generated stores and loads.

The final proof will include a deliberate wrong expected payload in an isolated
copy of a verifier test; the production sources will not be modified.
