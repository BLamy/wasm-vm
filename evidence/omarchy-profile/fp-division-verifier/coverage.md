# E5.5-T03z independent coverage map

Predictions preceded evidence in `predictions.md`. Numeric literals are generated
only from exact rational arithmetic in `derive-goldens.py`, retained in
`goldens.json`, and copied as literal Rust arrays into the promoted fixture.
The interpreter is checked against those same independent expectations; it is
not the oracle that computes them.

| Changed runtime hunk | Independent exercise |
| --- | --- |
| Pure `core::jit::fp_div_s`, RoundMode, result/flag packing | 59 literal operand pairs × 6 static/dynamic encodings × 32 prior flags; 11,328 executions per runtime. Signed zero, finite/zero versus infinity/zero, both NaN classes, bad boxes, exact/inexact normal/subnormal results, ties and directed finite overflow. |
| F32 division correction's unchanged fast path | Exact normal/subnormal quotients, zeros, infinities, NaNs and ordinary inexact quotients; existing correctly raised underflow/overflow; result bits held independently. |
| Normalized numerator and denominator | Subnormal numerator `00000001/34000001` and negative mirror, subnormal denominator `3f800000/00000001`, ordinary normalized operands. |
| Missing OF repair | Overflow with exponent gap >128, exact exponent-gap-128/significand-equality boundary, both signs and all directed modes. Near-boundary `7f7ffffe/3f7fffff` remains NX only. |
| Missing UF repair | `00ffffff/40000000` and negative mirror: nearest and away-directed normal outputs retain UF; `00800000/3f800001` tests strictly tiny away-directed result. `00800000/3f7fffff` and negative mirror round toward zero to an inexact normal without adding UF. |
| Native import registration | Real WasmtimeExecutor runs plus separately instrumented generated modules. |
| Browser closure, env registration and lifetime | Real private/shared BrowserExecutor fixtures and actual outer `WebAssembly.Memory.grow(1)` between calls. |
| Individual/batch optional import allocation and index plumbing | Instrumented division import 5; all eight combinations of arithmetic/from-integer/to-word predecessors in both individual and batch modules. Executed nine-import chain has exports 9–13 and calls helper indices 5–8 and successors 10–13. |
| Admission, FP classification, FS/rm guards | Static rm 0–7, dynamic frm 0–7 and FS Off/Initial/Clean/Dirty. 1,536 instrumented cases prove exactly 810 legal calls and zero illegal helper calls. Original raw parcel, virtual PC and prefix are asserted. Unselected F/D families remain rejected. |
| Source boxing, destination boxing and exact FPR dirty bits | Instrumented argument capture and full memory byte comparison; exact control-word equality includes only the destination bit plus preserved prior bits. f0/f31 and all operand/destination alias classes are exercised. |
| Reused packed result publication | All prior flags, sign and rounding choices; full integer/FPR snapshots; real interpreted fcsr replacement and subsequent re-entry. |
| Direct successors and budgets | Same-module and cross-module browser chains consume predecessor FPR values; budgets 1/2/6/7 permit only whole blocks, and a later load fault commits exactly the completed prefix. |
| Fault and growth handoff | Native/private/shared load/store/illegal suffixes; six actual memory-growth cases (private/shared × success/store fault/later load fault), exactly one MMIO call, precise fault PC and no post-fault writes. |
| Worker boundary regression and generated-module fixtures | The frozen affected run executes the F32-only flag regressions, worker native corpus/runloop/fault tests, and private/shared worker modules. Independent literals and instrumented modules above prevent interpreter/helper agreement from being the only numeric oracle. |
| Three predecessor contrast updates | Their former unsupported FDIV.S contrast is now unsupported FSQRT.S. Frozen `fp-regression.log` executes all three complete verifier targets; existing instruction semantics and their fixtures otherwise remain unchanged. |
| Acceptance recipe and production harness | `make verify-E5_5-T03z` executes all six focused test targets and the actual production browser guest. The critic decodes the recorded ELF, checks independent literal register values and reconstructs its entire RAM digest. |
| Roadmap capability and deployment bundle | Independently viewed built-page/suite/capability screenshots, 127/127 live tests, and exact public fetches on both deployment and production origins execute the new displayed capability and final compiled guest. |

Types, documentation and comments are waived as non-executable; their runtime
consumers are covered above. The helper's invalid-rounding assertion is a caller
precondition; exhaustive generated guards prove guest illegal modes cannot reach
it. No changed runtime hunk is dead. The F64 macro branch remains unchanged and
continues to return the old backend status. Existing arithmetic, conversion,
handoff and interpreter-boundary proofs carry forward where their code and
dependency boundary are unchanged.

Generated task metadata, the pending T03aa plan, queue/dependency updates and
the FP policy are declarative and waived from runtime execution. The metadata
is visible in the inspected built page; its current status describes the
recorded freeze. The nine exact inherited broad-suite failure boundaries in
`ci-inspection.json` remain failed and unchanged. They are carried forward
under the incremental verification rule, without a broad-suite passing claim.

Final built/cold/public evidence and physical deadline results are audited
separately in `final-verdict.md`. The final clean clone reruns every semantic
fixture line and all nine state digests, with 18 passing tests. All 69 sealed
worker files match Git and disk; the runtime remains identical to the freeze.
Instruction correctness alone does not establish desktop response.
