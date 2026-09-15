# E5.5-T03w independent arithmetic review

Frozen implementation: `357dd1a0f9f984747f3f92ad83b0ae556e6689f5`.
Predictions precede evidence in `predictions.md`; source and early recording
hashes are in `candidate-hashes.json`. No final verdict yet: the ordinary frozen
submission, live suite, physical trial, pristine clone and public bytes remain
to be audited. No implementation code was changed by this verifier.

## Provisional prediction results

- P1–P3 — HELD. `pre-freeze-native.log:10–13` and
  `pre-freeze-wasm.log:24–26,42–44` record 8,832 literal rounding/flags cases
  and 3,072 independently seeded exact-integer identities. The all-three-path
  receipts match: literal FNV `17621813032391191516`; seeded FNV
  `12643572604827571813`. Assertions cover every defined static/dynamic mode,
  all initial flags, zeros, cancellation, half-ulp ties, normals/subnormals,
  signed overflow/underflow, both NaN types, malformed boxes and aliases.
- P4/P6 pure call boundary — HELD. `pre-freeze-native.log:14–15` records
  1,024 instrumented generated-module cases: exactly 540 legal helper calls,
  zero illegal calls, canonicalized malformed input, and no memory/atomic
  import or unexpected state byte write. Each generated body has one call to
  import index 5 and no native WASM floating-point operators. Independent
  seeded cases include 1,488 FS-Off or invalid-rm exits with precise parcels,
  virtual PCs and state after the integer prefix.
- P5/P7 handoff — HELD. `pre-freeze-native.log:8–9` and
  `pre-freeze-wasm.log:26,44` match the 11-case CSR/dependency/fault receipt
  `12235252711163659176`. A generated rounded result is immediately consumed
  by FMUL before a later load/store/illegal-instruction exit. Genuine CSRRW and
  CSRRS operations replace/read fcsr between dynamic operations. Same-module
  and cross-module successor counters and fuel exits hold at
  `pre-freeze-wasm.log:29–34,47–52` (0/1/2 entries; 0/0/1 direct links).
- P6 growth/indices — HELD. Private/shared real memory growth, growth-store
  fault and later-load fault run once and preserve exact result/flags at
  `pre-freeze-wasm.log:19–21,37–39`. Subsequent CSR replacement and a dynamic
  add regenerate NX without resurrecting prior flags. The mixed integer →
  arithmetic → integer module executes exports 6/7/8 and helper import 5 at
  `pre-freeze-native.log:6–7`; integer-only modules still have five imports,
  and the five tested unselected FP families remain untranslatable.
- P8 sensitivity — HELD. `wrong-golden-wrong.log:10–15` fails at the named
  FADD half-ulp assertion with actual boxed 0x3f800000 versus the deliberately
  wrong boxed 0x3f800001. Restoration passes at
  `wrong-golden-restored.log:6–9`. Exit codes 101/0 and unchanged shared test
  SHA-256 are recorded in `wrong-golden-result.json`. Only an isolated copy of
  the critic's tests changed; shared code and source fixtures remained intact.
- P9/P10 — NEEDS EVIDENCE until final submission and physical trial arrive.

Both final independent processes exited normally: native 5/5 (9.08 s),
private/shared WASM 6/6 (2.44 s). The affected verifier Clippy gate passes in
`test-clippy.log`. The pre-existing `hart_ctrl` warning is preserved.

## Backend prerequisite and changed-hunk coverage

The worker found and corrected the inherited APFloat status omission for
finite-saturating F32 add/mul overflow. This widened the task's explicitly
documented prerequisite, not its instruction set. The independent literals
retain IEEE expectations rather than copying the interpreter's flags.

- `core/src/softfloat.rs` widened overflow check: both add and multiply,
  positive and negative saturation, and all five rounding modes execute.
  Values strictly below 2^128 retain NX-only directed truncation; exact 2^128
  and larger values acquire OF|NX. The separate product witness
  `(2^64−2^41)*(2^64+2^41)=2^128−2^82` exercises the false side near the
  threshold. Normal/subnormal tininess-after-rounding witnesses exercise the
  unaffected flag cases. The widened product has at most 48 significant bits;
  the closest relevant add boundary is at least 2^80 apart, larger than
  binary64 spacing there. The helper therefore cannot change that predicate
  through binary64 rounding. The original binary32 result is retained.
- F64 add/mul pass through the new private `arithmetic_flags` wrapper but its
  compile-time `$mant == 23` condition is false; this is a static equivalence
  waiver for the nonselected format. Other arithmetic families, comparisons,
  rounding mappings and backend dependencies have no changed hunk.
- `core/src/jit.rs` pure helper: both operations and all modes execute in the
  literal/seeded corpus; its integer-only parameters contain no guest-state
  reference. The inherited SoftFloat code has no mutable global context. Its
  invalid-mode panic is a defensive precondition, with generated rejection
  proven before the helper is called.
- `jit-translate/src/lib.rs` admission/classification, optional import,
  function-index resolution, FS/rm guard, parcel/PC publication, helper
  arguments, result boxing and sticky-flag publication execute in the native,
  private and shared tests described above. Both valid and malformed source
  boxes, both operation selectors, static/dynamic modes and all illegal
  variants execute. Import presence/absence and actual mixed-module direct
  targets are asserted.
- The integer-only byte-identity claim is a static equivalence waiver: no
  optional helper/type is inserted; `add_function` is invoked in the same
  order with the same run type and indices 5+i. The temporary Rust vector
  merely retains those returned indices; exporting and resolving them emits
  the same numbers previously calculated by 5+i. No integer emit arm changes.
- `jit-runtime/src/lib.rs` registration and `wasm/src/jit_browser.rs` closure,
  registration and retained ownership execute through real generated modules
  and remain alive across repeated calls and memory growth. The browser
  helper has no active execution-context capture and does not set chain abort;
  actual direct successors demonstrate that arithmetic does not force a
  scheduler return.
- Documentation and roadmap metadata are non-runtime; final suite/deployment
  evidence must prove their published claims. The Makefile and browser guest
  harness await the final ordinary acceptance run.

## Fixture corrections and carried proof

The initial native test compile error was confined to test closure type/exit
enum conversion. The first custom mixed-module harness had not armed chain
depth. After arming, it exercised the dormant legacy `Abi::FROZEN` direct-call
path, which production native deliberately leaves disabled; that unchanged
path does not publish integer locals before its call. The instrumented module
now uses the production-supported direct-chain ABI and register globals, as
the browser does. Archived logs retain both fixture failures. The final mixed
test proves the required changed import/function indices and state publication.
No runtime code was fixed by the critic.

T03t's FPR identity/control transport, T03u's memory authority/precise exits and
T03v's comparison/flag handoff proofs remain HELD where their source and
dependency boundaries are unchanged. In particular, no FPR, MMU, load/store,
comparison helper, CSR implementation or dependency version changed in this
submission. Their sealed prior evidence remains the proof for those boundaries.
`carried-boundaries.json` independently confirms byte identity from `f0833e1c`
for the dependency lock, relevant guest-state/memory files, prior independent
fixtures and all existing `CpuStateHandoff` code. It also rechecks the prior
comparison worker seal and final critic audit against their published digests.

Instruction correctness does not establish physical desktop responsiveness.
T03q remains gated until independent nonce readback and terminal image both
demonstrate a response at the unchanged deadline.
