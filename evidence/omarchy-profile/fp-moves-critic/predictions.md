# E5.5-T03t — independent critic predictions

Written 2026-09-15 before inspecting implementation evidence or running acceptance.
Task activation: `ecb958dc`. Critic: `/root/fp_moves_critic`; implementation belongs
to a separate worker session. The source contracts read for orientation were
`hart/mod.rs`, `hart/fregs.rs`, `hart/regs.rs`, `csr.rs`, `core/jit.rs`, the core JIT
exit dispatcher, `jit-translate/lib.rs`, both JIT runtimes and the existing FP
policy. Worker design notes are claims to attack, not evidence.

## Predictions

Each result remains **NEEDS EVIDENCE** until a recorded observation below names a
file/line and digest. All selected instructions are 32-bit encodings.

1. **P1 — exact opcode boundary.** FSGNJ.S, FSGNJN.S, FSGNJX.S, FMV.W.X and
   FMV.X.W blocks compile and execute actual generated WASM. No f32/f64 arithmetic,
   conversion or reinterpret opcode is needed in their emitted function bodies.
   Every FP load/store, comparison, arithmetic, conversion, classification and
   double-precision family previously rejected remains rejected in this slice.
   A passing interpreter fallback alone does not hold this prediction.
2. **P2 — boxed NaN payload and sign.** For boxed `a=0xffffffff7f812345` and
   `b=0xffffffff80000000`, J/JN/JX yield respectively
   `0xffffffffff812345`, `0xffffffff7f812345`, `0xffffffffff812345`.
   The signaling payload remains unchanged and pre-existing fflags are unchanged.
   For `a=-0` and `b=-0`, J gives -0, JN +0 and JX +0, all boxed.
3. **P3 — malformed box differs from a raw move.** For
   `a=0xfffffffe81234567`, sign injection uses canonical `0x7fc00000` as a;
   with negative boxed b, J yields `0xffffffffffc00000`. A malformed b whose
   raw low bits have sign 1 supplies the canonical NaN's positive sign instead.
   FMV.X.W from the same malformed a instead yields `0xffffffff81234567`.
   FMV.W.X with integer `0x1234567881234567` yields
   `0xffffffff81234567`; the upper integer bits are discarded.
4. **P4 — register-bank and alias boundaries.** f0 is both readable and writable;
   x0 remains zero. FMV.W.X f0,x0 writes boxed +0, and FMV.X.W x0,f0 discards
   its result. FSGNJ with rd==rs1, rd==rs2, rs1==rs2 and all three equal uses
   both original source values. Number-equal x/f registers never alias each other.
   Comparison checks include all 32 integer and 32 raw FP words, not just rd.
5. **P5 — CSR state and same-value writes.** Starting from FS Initial/Clean,
   each FSGNJ or FMV.W.X execution sets FS=Dirty and SD=1 even if the result bits
   equal the old destination. FMV.X.W preserves FS and SD. All five preserve
   fflags and frm, including nonzero flags and frm values 5, 6 and 7; these
   bit operations do not spuriously consult rounding mode.
6. **P6 — disabled root at first instruction.** With FS=Off each selected
   instruction traps as IllegalInstruction at its original virtual PC with
   `mtval` equal to the original 32-bit encoding. No register/FP/CSR changes or
   retirement precede it. Concrete encodings include FSGNJ.S f0,f1,f2
   `0x20208053`, FSGNJN `0x20209053`, FSGNJX `0x2020a053`, FMV.W.X f0,x1
   `0xf0008053`, and FMV.X.W x0,f1 `0xe0008053`.
7. **P7 — disabled mid-block prefix.** For two integer operations followed by
   disabled FP, only those two retire and their results persist. No later
   register destination changes. Trap PC is entry virtual PC plus the actual
   prefix byte lengths; mtval remains the FP encoding. A reused physical block
   at a different virtual entry must report the new virtual PC correctly.
8. **P8 — disabled direct successor.** An integer-only root directly entering a
   selected-FP successor while FS=Off must trap at that successor's first FP,
   retaining root and successor integer-prefix retirement exactly once. An
   enabled run followed by a disabled invocation must not reuse stale enabled
   control. Test actual same-module and cross-module successor paths; a fallback
   dispatcher call is insufficient evidence for a claimed direct chain.
9. **P9 — FP prefix before precise memory fault.** A selected FP write followed
   by an integer load/store fault commits the completed FPR result and FS/SD,
   preserves fflags/frm, reports the precise fault cause/address/PC and exact
   retirement prefix, and leaves all later destinations untouched. A committing
   store/MMIO prefix must occur once; no restart may replay earlier effects.
   Cover native private handoff and browser shared/direct-chain unwinding.
10. **P10 — interpreted mutation between compiled calls.** After one compiled
    call, an interpreted FLW/FLD/arithmetic/raw FPR write which changes no integer
    register must be visible to the next selected compiled operation. Include f0,
    same-register mutation, a different FPR, a fresh module and a reused module.
    FCSR/FS refresh must not depend on either integer or FPR version changing.
11. **P11 — version identity attack (novel).** Two distinct architectural FPR
    files can have equal numeric mutation versions and different contents. A
    retained browser handoff reused for those states must not read the first
    file's contents for the second. Hold integer words/versions fixed to isolate
    this new FPR boundary. If production lifecycle makes replacement impossible,
    require the concrete lifecycle invariant and reset invalidation evidence;
    equality of numeric per-object versions alone does not prove identity.
12. **P12 — direct successor state and dirty masks.** FP writes in a root are
    visible to same-module and cross-module successors; their FP writes survive
    final return and a later successor fault. Unexecuted successor destinations
    must not commit. f31 tests bit 31 of the dirty mask without signed-shift
    truncation. Budget refusal before a successor does not execute or dirty it.
13. **P13 — elision and transport integrity.** Adjacent unchanged integer-only
    shared-memory calls do not copy all 32 FPRs. A changed FPR file is refreshed
    before its next use, and only executed FPR destinations commit. Existing
    integer/exit/chain offsets and the 568-byte handoff remain unchanged; FPR
    words roundtrip little-endian and the control/exit header never overlaps f31.
    Nonarchitectural mutation versions do not alter architectural equality or
    snapshot bytes/digests. If tests claim copy savings, inspect actual ledger
    updates against the copies rather than accepting printed byte totals.
14. **P14 — independent varied cases.** A deterministic corpus with critic-chosen
    seeds, source/destination indices, boxed/malformed values, flags, frm and FS
    states agrees on full architectural state and retirement. One deliberately
    sabotaged exact expectation must fail at the asserted boundary, proving the
    assertion is reached. Remove the sabotage before final acceptance.
15. **P15 — recorded submission coverage.** Every changed runtime hunk executes
    in native/wasm/browser evidence or receives a narrow justified waiver; no
    ignored test, compile-time-only branch or stale log can substitute for a
    behavior claim. Commands, source head, built WASM, recorded state/trace and
    cold-clone provenance are pinned. The final pristine clone scrubs inherited
    RUSTFLAGS/CARGO_*/RUST_LOG and passes the committed acceptance command.
16. **P16 — browser and publication.** The built page's current riscv suite has
    zero failures and zero unexpected console errors; the selected FP fixture
    proves compiled execution in the real browser. The roadmap capability and
    screenshot match what was proved. Committed web/dist and the Cloudflare
    deployment must identify the tested artifact rather than another rebuild.
17. **P17 — honest desktop outcome.** The physical-input trial uses real trusted
    keyboard events, independently reads its generated nonce, and retains the
    unchanged 120-second deadline. Any failure remains a recorded failure and
    T03q stays gated. T03t instruction/state verification is not desktop success.

## Initial source-contract hazards

- `hart/mod.rs:2088-2095` distinguishes read-only FMV.X.W from dirtying FMV.W.X.
- `hart/mod.rs:1349-1357` checks FS before reading FP operands and returns raw bits.
- `jit_browser.rs:905-916` currently keys x-state reuse on the integer version;
  it cannot detect an FPR-only interpreter mutation.
- `jit-translate/lib.rs:1358-1377` lets same-module successors bypass root state
  loads; a root-only FP precondition is insufficient.
- `jit-runtime/lib.rs:850-889` and `jit_browser.rs:1544-1584` have separate precise
  fault commit paths that must preserve a newly supported FPR prefix.

## Findings and evidence

P1–P17 are **HELD** with the narrow coverage waivers and the honest recorded
regression-wall failures in `observations.md` and `coverage.md`. Those files
preserve each predicted boundary, exact observed states, file/line citations,
source provenance and the incremental test-only proof repairs. The cold clone
and live deployment contain the unchanged runtime WASM SHA-256
`55557d7a158bb274d214692a76a2a876bbe56ecd7798cbc9adfcbb4bfc9a0c40`.

The physical deadline failure is held as an honest outcome, not as desktop
success. The task's final Verification log records the verifier's verdict.
