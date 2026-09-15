# E5.5-T03x independent review before sealed submission

This is not a verdict. Source/fixtures/bundle froze at `b587faf6` after the
independent tests below. No implementation code was edited by this verifier.
Predictions were written first in `predictions.md`; tests derive results from
literal binary32 encodings or constructed significand/remainder identities.

## Predictions so far

- P1 — HELD in preflight. `native-preflight.log:10–11`,
  `wasm-preflight.log:24` and `:44` each record 12,672 literal states, receipt
  `11332523716468034169`. Every initial fflags value, all five static modes,
  dynamic frm, f0/f31, low-word signedness, 64-bit extrema and high unsigned
  values agree with independent bits/flags and interpreter results. Integer
  source/register state remains unchanged; results are NaN-boxed, FS/SD dirty.
- P2 — HELD in preflight. `native-preflight.log:12–13` and
  `wasm-preflight.log:25,45` record seed `6d42a8c9f03175be`, 3,584 cases with
  1,736 illegal exits and receipt `8412752937936467894`. The construction puts
  integers below/on/above a rounding midpoint and varies signs, high words,
  static/dynamic modes, aliases and prior flags. Equal-numbered X/F registers
  are distinct, x0 remains zero and f0 is writable. The x12 prefix update is
  consumed before conversion.
- P3 — HELD in preflight. `native-preflight.log:14–15` records 3,072 instrumented
  executions: exactly 1,620 legal conversion calls and zero illegal calls.
  All FS/rm/frm combinations retain the exact original parcel/virtual-PC/prefix
  state. Each legal helper receives full-width source bits, width 0..3 and rm
  0..4. No bus/atomic imports run; only allowed ABI output bytes change. No
  generated F32/F64 opcodes exist. The upper FP_STATE word is explicitly tested
  as an FPR destination mask; it is not confused with the architectural SD bit.
- P4 — HELD in preflight. `native-preflight.log:6–7` proves actual generated
  integer -> conversion -> arithmetic -> conversion execution with imports
  5/6 and exported run functions 7/8/9/10. Integer-only, arithmetic-only and
  conversion-only block and batch modules retain 5/6/6 function imports. The
  real chain consumes newly written x31, writes/reads f0, carries NX and ends
  with an x0 -> f31 zero. Six unselected operation families remain rejected.
- P5 — HELD in preflight. `native-preflight.log:8–9` and
  `wasm-preflight.log:26,46` retain 12 CSR/clear/fault cases and receipt
  `5904181122689446553`. `wasm-preflight.log:29–36,49–56` proves 16 real same-/
  cross-module budget/fault cases, including an integer-only predecessor whose
  updated x31 must reach a mixed conversion/arithmetic successor. At fuel 1
  neither block retires; fuel 2/5 retires only the 2-instruction predecessor;
  fuel 6 retires 6 or exactly 4 before the load fault. Exact PC, flags, FPR and
  direct-entry/link counters are asserted. `wasm-preflight.log:19–21,39–41`
  proves six actual 65,536-byte host-WASM growth calls: private/shared successful
  store, faulting growth store and later load fault. The import executes once,
  new integer values and FPR bits survive, and interpreted fcsr replacement is
  used by re-entry. The native/private frozen executor deliberately reports
  retired=0; shared direct-chain and the worker's real Machine runloop prove
  exact prefix retirement through the authoritative integration surface.
- P6 sensitivity — HELD. `sabotage.log` fails at the named
  `CRITIC_FCVT_POSITIVE_HALF_GOLDEN` assertion after one expected word changes
  from `ffffffff4b800000` to `ffffffff4b800001` in an isolated test copy.
  `sabotage-restored.log:6–9` then passes the unchanged 12,672-state literal
  receipt. `sabotage.json` records exits 101/0 and unchanged production fixture
  SHA-256 `c2fe4a8b016d2f7d459993316664062e37b77230406ee4e9f9e348bcd70ae54d`.
- P6 final provenance/product — awaiting sealed recorded acceptance, gauntlet,
  pristine rebuild, browser captures, public artifacts and physical-input trial.
  No final task-status recommendation exists yet.

## Changed implementation coverage

| Boundary at frozen source | Evidence / classification |
| --- | --- |
| `crates/core/src/jit.rs:43` width dispatch, backend call, packed result | All four width arms and modes execute across three real engines and instrumented exact-argument calls. The existing backend is unchanged. Invalid-width panic and failed-rm `expect` are defensive unreachable branches under decoded width/guarded rm; waived with the exhaustive generated guard/argument proof. No reference-bearing parameter or captured object is present. |
| `crates/jit-runtime/src/lib.rs:416` native adapter | All independent native corpora use this adapter; high signed/unsigned i64 bit patterns match literal results. |
| `crates/wasm/src/jit_browser.rs:989,1170,1189,1208` closure type/create/register/retain | Private/shared corpora, repeated invalidation/re-entry and real memory-growth tests exercise actual closures and full i64 bit transport. Struct-field/comment declarations are static ABI/lifetime metadata, waived apart from these execution checks. |
| `crates/jit-translate/src/lib.rs:756,849,858,1234` optional import scan/allocation | Block/batch integer-only, conversion-only, arithmetic-only and mixed tests execute both presence/absence paths and verify actual import order. Full mixed execution tests allocated function indices, not merely byte validity. |
| `crates/jit-translate/src/lib.rs:891` integer source read mask | Same-module and cross-module integer predecessor -> conversion successor consumes updated x31. Seeded x12 prefix, x0 and f0/F31 checks cover local/global register boundaries. |
| `crates/jit-translate/src/lib.rs:820,1361,1403,1494,2401` helper-index plumbing | Actual single/batch/mixed execution reaches all call sites with conversion index 5 or 6; no-conversion modules continue to compile/execute through prior proof boundaries. Type/signature plumbing is static and waived beyond execution coverage. |
| `crates/jit-translate/src/lib.rs:1465,2021,2044` admission and guards | All four admitted operations, reserved static/dynamic modes, FS-Off and prior-prefix faults execute. Unsupported single/double/fused/to-integer families are explicitly rejected. |
| `crates/jit-translate/src/lib.rs:2098,2465` result publication and conversion emission | All width constants, source registers, rounded result/flags and f0/f31 destination masks execute. Mixed modules exercise extracted arithmetic publication; later faults and real growth assert immediate visibility. `carried-boundaries.json` additionally proves the extraction's statement tokens exactly match the old arithmetic body. |
| Test admission, acceptance recipe, roadmap/capability metadata and browser harness | Direct test execution plus final built-page/live-pip inspection are required; no runtime semantics are hidden in metadata. Final browser result pending. |

## Mock/environment audit and retained evidence

The independent oracle never imports `f32_from_int`, uses a host float cast or
computes golden outputs with the code under test. The linker calls the real pure
helper only for the actual result; expectations are separate literal tables.
The helper-probe environment intentionally has no guest memory/device/scheduler
object and fatal memory imports, while independent executor/growth tests exercise
the actual Machine/SystemBus boundary. No new test is ignored and no debug assert
is disabled. Native and WASM fixture Clippy both pass; source format checks pass.

`native-initial.log` retains one verifier-harness failure: the rd=f31-only write
mask expectation was initially reused for f0. Correcting it to bit 32+rd proves
the documented existing ABI. This did not require a runtime change or alter the
independent conversion result goldens.

`carried-boundaries.json` independently confirms 17 byte-identical prior boundaries
against `51dd9864`: dependency lock, software backend, FPR/CSR/hart/MMIO/RAM,
existing handoff implementation, prior independent fixtures and sealed arithmetic
proof/audit (which itself retains T03t/u/v proofs). Carry those HELD results forward.
No MMU, memory authority, comparison semantics or arithmetic algorithm changed.
New call indices/source masks/result publication receive new coverage above.

The tests are suitable permanent regression artifacts if the sealed submission
holds. The actual physical trial remains a separate gate: T03q cannot be claimed
responsive without nonce readback and visible typed terminal image within its
original 120-second deadline.

## Light capture/public audit after recorded acceptance

`audit-captures.py` now passes and writes `browser-audit.json` and
`physical-input-audit.json`; `check-public.py` writes eight fresh independent TLS
byte receipts in `independent-public-bytes.json`. Runtime/fixture source still
matches frozen `b587faf6`. All seven affected submission commands exited 0.
The browser report's four encoded conversion parcels and ELF input words were
independently decoded and checked, along with actual register spills/fflags/FS.

- Built browser: 3,611/4,000 instructions execute via JIT; registers, counters
  and RAM digest `5df84ec4c17598ab2c56293bb5b78338947ce9991af18e0ef795aa4a07d2df44`
  match the interpreter. ELF SHA-256 is
  `170850ed3232b08073a037a511a4c4e1c3e8e6ec15da282aca38a2fd62285b2b`.
  The suite shows 127 passed, 0 failed, 127 done; the conversion pip is visibly
  green/live 1/1 and T03x appears in the real roadmap detail. All three saved
  browser images were viewed independently and match their report hashes.
- Public bytes: four assets fetched independently from each of
  `https://d3e13537.wasm-vm.pages.dev` and `https://wasm-vm.pages.dev` match the
  tested local bundle. WASM remains
  `0ce4a5a304d82574b5f4118725bcffc2547121605e49304d280153eae4a5d312`.
  An initial sandbox DNS failure is retained separately; the authorized TLS
  fetch succeeds without bypassing certificate verification.
- Physical input: measurement/gating HELD; response FAILED. At the unchanged
  deadline `2026-09-15T22:40:14.941Z`, 128 trusted accepted events have produced
  no nonce. Thirteen completed independent reads return exit 75; one is pending.
  Serial commands are read-only nonce-file checks with no nonce injection.
  Frames remain 2→2. Both actual images were viewed and show the same empty Foot
  prompt/cursor, with identical SHA-256
  `97fc180d4d35c68ca5941dc591afb315220550165469f3c4ead7827989cc2f3f`.
  Report SHA-256 is
  `29b15c67cd97e1d8daac22b4bf449ba7bd35f3ec5fd6703e8a1e8054fdd7f1fa`.
  Source/helper/served-WASM identities, pinned R3 guest artifacts and cleanup
  are checked independently. T03q remains pending.

The full-gauntlet result, final pristine-clone proof and sealed worker manifest
are still pending. No final verdict or task status change has been made.

## Complete recorded CI audit

`audit-ci.py` independently checks the complete `ci.log` and exact source blobs;
its result is `inherited-gates-audit.json`. The broad gate remains failed with
exit 2. No whole-workspace pass is claimed. Its five failed targets match the
prior verified arithmetic submission, including the same diagnostic signatures:

| Failed target | Concrete point in new `ci.log` | Independent scope check |
| --- | --- | --- |
| `clippy`, `test` | `:5–43,73–111`: macOS lacks Linux `prctl`, `PR_SET_NO_NEW_PRIVS`, `SYS_seccomp`; syscall type differs. `:46–68`: unused `live_blocks`/`fetch_phys` with all features. | Relevant seccomp, dispatch/hart and dependency/feature manifests are byte-identical to `51dd9864`. |
| `wasm` | `:581–638`: existing resume test still asserts VIRTIO_RNG unsupported. | The resume test and resume implementation are unchanged. Conversion worker 2/2 and verifier 6/6 pass earlier at `:407–424`. |
| `test-riscv` | `:714–742`: existing browser tests call APIs absent under `zicsr-stub`. | Complete existing wasm32 test-module suffix is unchanged; core API gating and Cargo features are unchanged. This distinguishes the old tests from the new adapter in the same file. |
| `determinism` | `:769–773`: the existing static scanner flags the GPU resource test's `Instant`/`Duration`. | Scanner and flagged source are unchanged. |

Fourteen independently checked files/boundaries and all old Make recipes are
unchanged. The completed native ISA wall is 128/128 (`ci.log:764`), and the
uncontended smoke is 25.3 MIPS against its 15 MIPS floor (`:780`). These facts
record the existing platform/test debt without expanding T03x or masking the
failed broad gate. The pristine clone and final evidence seal remain pending.
