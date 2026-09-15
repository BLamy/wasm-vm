# E5.5-T03t — pre-freeze source audit

2026-09-15, independent critic `/root/fp_moves_critic`.
Scope: working implementation diff against activation `ecb958dc`, plus the new
shared raw-encoding fixture and browser gate. No acceptance command or recorded
implementation result was run/read during this audit. This is not a verdict.

## Runtime inspection

No semantic contradiction found in the inspected candidate. These are source
observations to hold against final runtime evidence, not passing predictions:

- `push_boxed_f32` checks all upper 32 bits and canonicalizes each source
  independently. Sign injection snapshots rs1 before reading rs2, so destination
  aliases do not overwrite a source. Result masks preserve a boxed NaN payload.
- FMV.X.W uses raw load → i32 wrap → signed i64 extension. FMV.W.X uses raw low
  integer bits → explicit box. f0 has no x0-discard special case.
- `set_freg` stores to the shared handoff immediately and ORs one FPR mask bit
  plus the FP-dirty marker. Read-only FMV.X.W never reaches it.
- A generated FS guard precedes each block's first selected FP operation and
  uses that MicroOp's raw encoding and relative virtual PC. No supported
  instruction inside the block can disable FP. Root and successor functions
  both contain the guard.
- Exit 9 enters core's existing precise-prefix trap path. The native and browser
  runtime normal/fault branches reach the new FP commit operation. The final
  recorded run must prove those separate branches execute.
- FPR identity/version caching sits after the existing generated-code span in
  CpuStateHandoff; it is absent from the 568-byte transfer. Shared/private module
  transport preserves it. Default and clone allocate distinct identities; each
  raw write changes its local version. Architectural equality and snapshots use
  only the 32 architectural words.
- Every root invocation refreshes FP permission/control and clears old dirty
  metadata independently of whether integer/FPR copies are elided. Only the
  executed mask is committed. Immediate FPR stores avoid same-module global
  register caching complexity.
- All old integer, exit and chain offsets remain unchanged. f31 occupies
  `0x200..0x208`; packed control begins at `0x208` and cannot overlap it.

## Proof gaps communicated before freeze

1. The shared directed fixture uses BrowserExecutor::new(), the private-memory
   path. The new inline tests exercise clean return, disabled successor and
   budget refusal, but do not yet exercise the state=None precise memory-fault
   branch after a completed FP write.
2. Both inline direct-chain fixtures start with an integer-only root. They do
   not yet demonstrate an FPR result/dirty bit produced in a root, consumed by a
   same-module/cross-module successor, then preserved when that successor faults.
   One fixture with that shape can close both gaps.
3. FS=Off reaches FSGNJ.S, FMV.X.W and FMV.W.X as first selected operations in
   current fixed programs; FSGNJN.S/FSGNJX.S occur after the earlier guard. The
   independent critic attack will put each first and check exact mtval.
4. The final opcode-boundary review must inspect emitted WASM instructions or
   equivalent deterministic structure; total JIT retirement alone cannot prove
   that no host floating-point operation was emitted.

## Final audit requirements

The final review will pin all changed sources and evidence digests, inspect
the actual browser screenshot and recorded suite/FP fixture, run the bounded
independent attacks and sabotage once, and inspect the pristine-clone result.
The physical input outcome remains independent of the ISA support verdict.

## Incremental proof correction before final verdict

The first shared `handoff_reuse` fixture alternates a fresh register file at
numeric version 1 with an interpreted mutation to version 2. Its next fresh
replacement therefore differs numerically from the retained cache key. That
sequence did not isolate P11's equal-version/different-identity case, although
the inspected implementation compares the complete identity/version pair.

The critic promoted a test-only insertion immediately after the read-only
FMV.X.W: replace only FRegs at the same address, assert its numeric version
matches and identity differs, leave integer state/version untouched, and require
the next compiled result to use the replacement's different low bits. Next,
change only FS to Off and require the same compiled entry to trap with zero
retirement and untouched architectural state. The prediction is that all four
raw payloads pass both isolated checks under the native and wasm executors.
This is a missing-proof repair; runtime bytes and the frozen cold build remain
unchanged. Results will be cited after those focused fixtures run.

The incremental checks passed without runtime changes:
`identity-native.log:7`–`:10` records all four equal-version replacements and all
four CSR-only disabled rechecks, 1 passed/0 failed; `identity-wasm.log:27`–`:28`
records the same shared fixture in BrowserExecutor, and `:42` records all six
browser executor tests passed. Shared fixture SHA-256 is
`1ac32191be33cb86d413bfe37717793cb4b61c5ca93829c11146d920c711057f`.
Native log SHA-256 is
`01943cae4773bb96f02ad6bb59053088b17b8c85f0fc91e6518ccbdedc003a45`;
wasm log SHA-256 is
`9ea3aacadf822d658a1f85999377fe5eea9afa56bff7f4671688956031852403`.
