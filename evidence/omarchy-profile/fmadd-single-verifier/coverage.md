# Frozen diff coverage map — E5.5-T03an

Frozen revision: `618286f3b1431990bbeddb9ef40d894b67be0605`, against verified
predecessor `29ea3537`. `runtime-diff.patch` and `frozen-inspection.json`
identify the exact inspected bytes. Final worker submission `1479a263` contains
unchanged runtime/harness bytes. `submission-inspection.json` audits its sealed
83-file record; all proof obligations below are now exercised or narrowly waived.

| Changed boundary | Concrete exercising proof or narrow waiver |
| --- | --- |
| `core/src/jit.rs` packed FMADD helper | Native instrumented legal calls compare all four received arguments, packed result publication and full state bytes; every illegal path makes zero calls. Native/private/shared literal tests execute the real registered helper. The panic for a violated internal validated-mode precondition is waived: reserved modes must be rejected before helper entry, as instrumented directly. |
| `core/src/softfloat.rs` F32 flags repair guard | Exact, NaN, inexact ordinary, underflow, overflowing-to-infinity and finite-saturation literals exercise early return and candidate boundary paths. |
| Positive/negative widened operands, overflow comparison | Both signs of largest-finite overflow and `2^128 +/- min_subnormal` independently distinguish a true boundary crossing from a tiny opposite addend. Output bits are independently asserted, not copied from the backend. |
| UF nearest / away / toward-zero comparison arms | Literals straddle nearest `normal - 2^-151` and away `normal - 2^-150`; `normal + 0.5*min_subnormal` executes the toward-zero arm without adding UF. Positive and negative cases distinguish RDN and RUP. |
| Macro F32 dispatch / F64 unchanged branch | F32 literal/backend/generated tests execute the correction. F64 retains the identical `Flags::from_status` expression and rounded value; software-FP regression proves unchanged behavior. The compile-time format condition is a narrow type-selection waiver, not a new F64 implementation. |
| Translator FMADD detection and optional import in block/batch | Actual Wasmtime modules execute standalone, all 16 subsets of preceding helpers, and a five-helper direct batch. Parsed imports, exports and call indices are asserted, including FMADD indices 5 through 9 and defined functions starting at 10 in the full batch. |
| FMA admission / FS classification / resolved-rm guard | Every legal mode, FS 0..3, reserved static and dynamic encodings are executed. Rejections preserve original parcel, virtual PC, prior FPRs/flags/FS, completed integer prefix and absent suffix. Nonselected fused-S/D and other families remain rejected in 15 exact parcel guards. |
| Three independently boxed source loads / packed-result publication | All 15 equality partitions of rd/rs1/rs2/rs3, f0/f31 endpoints, three independent seeds, and malformed/signaling operands in each slot. Native instrumented memory-byte comparisons assert exact destination mask and existing sticky flag bits. |
| Wasmtime registration | Independent native literal and state/control tests use `WasmtimeExecutor::new`; instrumented linker separately verifies generated argument/count/index behavior. |
| Browser closure, import binding and retained closure owner | Private/shared emitted modules execute actual callback lifetime; same/cross-module direct chains exercise FPR/flags across successors and budgets. Memory grows by 65,536 bytes inside an MMIO callback between FMADDs, with normal, store-fault and later-load-fault exits in both executor modes. The struct field declaration itself is a type/storage waiver. |
| Existing unsupported test lists | Four focused one-parcel updates replace newly admitted FMADD.S with still-unsupported FMSUB.S. No other assertions are removed. Their regression targets passed in the final affected submission. |
| New worker/verifier fixtures and `Makefile` target | Final frozen acceptance executes each new target. Verifier expected values derive from exact Python fractions, with a wrong isolated fused-cancellation assertion proved to fail and the restored copy proved to pass. No test is ignored. |
| Built-browser FMADD guest harness | Production and cold artifacts expose four exact FMA parcels, all five helper families in a 400-iteration loop, matching independent register/RAM expectations, actual 65,536-byte memory growth, 4,570/5,000 compiled retirements, 127/0 ISA suite and verified real capture hashes. Both sets of three images were personally viewed. |
| New physical wrapper / scope entry | `physical-fidelity.json` proves only runtime identity/label differs from AM's wrapper and all guest knobs/pins/deadlines match. Actual trial executes pinning, spawn, negative audit and owned cleanup. The existing 10s browser-server close timeout takes the unchanged bounded kill fallback; actual cleanup is 10,138ms within 30s. Unused positive outcome validation carries AM's unchanged tested auditor proof. No extra deadline or input route was used. |
| Policy docs / roadmap capability | Declarative description is checked against the implementation and actual live FMADD test pip; status stays partial and explicitly leaves desktop response unresolved. No runtime behavior is hidden in these text lines. |
| Generated task manifest | Metadata-only waiver: 14 added task entries and three updated entries match frozen task files; source/dist JSON bytes agree; no Epic 6 entry changed. `task-manifest-inspection.json` records the comparison. |
| Generated WASM/JS/service-worker and artifact URL manifests | Final cold rebuild reproduces the submitted WASM byte-for-byte; independent public downloads match all six artifacts at both origins. URL-only manifest changes preserve all size/hash fields. Cold source/fixtures equal the freeze; all 33 critic receipts equal the hot run. |

No semantic runtime hunk is classified dead. No material implementation hunk
is waived merely because interpreter and JIT share a backend: independent
literal bits and flags attack that shared dependency directly.

The actual physical proof is negative: eleven exit-75 reads, no nonce, no new
frame and three identical empty-prompt images. This closes the required trial
without establishing desktop responsiveness. The post-verdict diagnostic profile
is bound through all eleven executable sections and independently recounted;
its measurements do not promote the failed input verdict or establish a speedup.

Broad `make -k ci` remains exit 2 in five carried AL categories. The exact failing
source boundaries are unchanged and the affected submission is green; this is
not a claim that the full workspace gate passed.
