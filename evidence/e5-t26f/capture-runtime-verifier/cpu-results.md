# E5-T26f post-P CPU diagnostic — independent results

**VERDICT: HELD for profile integrity, exact binding, and partial-interval scope.**

This verdict authenticates one read-only CPU diagnostic on a fresh copy of the already closed
`415db223` checkpoint. It is not F acceptance, a whole-interval profile, a performance comparison,
or a causal finding. I did not boot a guest, rebuild symbols, rerun a test, or alter source/task
state.

## Binding — HELD

- Driver `run-cpu.mjs` SHA-256 is
  `4cc5c89350c13035a19d4cb1671ae651d288fb85a67d99ab33332e99ca60ac36`.
  It requires frozen head `415db223733214b6c6e7b69b0ad331150969be56`, cold exit 0, original
  unprofiled reuse exit 1 specifically at the two-second assertion, a fresh output directory,
  scrubbed E5/Cargo/Rust settings, and complete source revalidation before and after the child.
- CPU invocation SHA-256 is
  `8e088f46bd4481d6070c48f35c4596801e7a224dbab7c79910d7024d11171001`.
  I independently rehashed all 22 recorded inputs successfully, including every original source
  pin plus CPU helper `f75fb382…`, `jit_browser.rs` `0b0830a1…`, the driver itself, and both served
  and dist WASM. Both WASM files independently hash to
  `a3ce02529ae2e6ec175066f4c838451ca7d1472b5f6bd2f5b2d5cbff805c8b42`
  (`cpu-default/invocation.json:2-41`).
- The raw profile record binds the same head, 150-entry runtime tree `21dce9b4…`, kernel
  `af7c4e47…`, unchanged image/helper/observer, origin `127.0.0.1:61637`, snapshot
  `e53e5a39…`, baseline profile `e6df3a0a…`, and headless Chrome 152.0.7977.76. CPU is the only
  diagnostic selector: command, latency, guest clock, JIT selector, residency selector, COMPLETE,
  and divider are all null/false (`record/failure-post-restore-interaction-checks.json:17-35`).
  The actual URL has normal `jit=1`, quantum 500000, and no `jitResidency` override.
- Child exit is 1 with `signal:null`; the driver/outer process completed successfully. The raw
  record SHA-256 is `72e3464f25207800b789a1165c2718357eb1cd57620efdb9aafe22f20a4800da`.
  It reaches matching CRC, fresh HELLO/no `booting`, physical `play`, released input, attached
  running audio, and 1,440 fresh non-silent frames before failing only the original timing
  assertion. These observations do not replace the canonical unprofiled browser verdict.

## Raw CPU profile integrity — HELD

- `interaction-cpu.json` independently hashes to
  `bff1fb08d40163cc40805dfffd548158d154b41355b75564c6e3e0b8bbf6bbbc`, exactly matching
  the raw milestone and symbol summary. Its envelope records `acceptance:false`,
  `diagnostic:true`, the frozen head/runtime, Chrome 152.0.7977.76, the actual
  `linux-worker.js` target, requested 1,000-us sampling, and stop reason
  `interaction-observed` (`interaction-cpu.json:1-4`, `:11712-11724`).
- The CDP profile has 464 nodes with 464 unique IDs, 2,050 samples, and 2,050 time deltas. Every
  sampled node ID resolves, every delta is finite/nonnegative, and the sampled weights sum to
  3,054,874 us. The profile timestamp span is 3,055,616 us. These independently checked
  invariants agree with the saved milestone's 2,050 count and reject a truncated or structurally
  disconnected profile.
- The symbol summary's self-time rows sum exactly to 3,054,874 us and 100% modulo floating-point
  rounding. Its profile hash and sample count exactly match the raw capture. This establishes
  internally consistent sampled attribution; it does not establish that any sampled function is
  the cause of F's wall time.

## Symbol binding — HELD

- The exact production input independently hashes to `a3ce0252…`; the supplied P named companion
  independently hashes to
  `0e99527f97e665b98a5f7fe5710d2075818e4f9f0875aa51ef746894f66ee44f`.
  These values match `cpu-summary.json` and P's independently verified
  `release-candidate-r1/binding.json`.
- The summary's 11 non-custom section IDs and payload digests exactly equal P's authenticated
  11-section binding, and the companion provides 1,876 function names. The existing symbolizer
  (`tools/verify/e5-t22c-symbolize-cpu.mjs`, inspected SHA-256
  `15006e82701a6aa010e1e96638e4d6cf5f07118843c8c4c0d4bb79f1fd9519d5`) refuses any
  non-custom-section byte difference before applying names. P's companion proof is therefore
  carried only for these exact rehashed bytes; no symbol rebuild or broader P re-review occurred.
- Symbol summary SHA-256 is
  `becae6c2c18aa0f8f2427a10e075f4af5ce71ad394ca86b10335e14f2063aa4a`.
  Hotspot ranking is descriptive sampled data for Main's separate inspection, not a verifier
  performance conclusion.

## Partial sampled interval and F disposition

- The profiled diagnostic retains the original endpoint: restore T0
  `1132.9300000667572`, `postRestoreEnd` `4953.910000085831`, independently yielding
  `3820.9800000190735 ms > 2000 ms` (`raw record:173`, `:291`, `:435`). It exits 1 at the same
  runner line-1930 assertion. `acceptance:false` is preserved in invocation, raw record, CPU
  milestone, and profile envelope.
- Sampling starts at `1904.195000052452`, which is 771.2649999856949 ms after restore T0. Its
  3,054.874 ms of time-delta weight is about 79.9500% of the 3,820.98-ms F interval and principally
  covers the later interaction work. It omits the restore-to-profiler-start prefix and remains a
  statistical CPU sample, not exact wall-time attribution; CDP timestamps and page-performance
  timestamps are separate clocks.
- The unprofiled screen is 3,591.9650000333786 ms and this profiled screen is
  3,820.9800000190735 ms. A single instrumented replay versus a single unprofiled replay is not a
  controlled performance comparison. No regression, improvement, profiler cost, speedup, or cause
  is inferred from their difference.
- This profile cannot change `browser-results.md`: F's two-second criterion remains FAILED,
  later coherence/drag/second-reload coverage remains deferred, `fVerified` remains false, and the
  normal full F acceptance run is still required.

Additional immutable anchors: CPU run log SHA-256
`a0556fa04fb162a1e760dec2fc4a15cb876e7b1de034215ca4bea268314bdfdb`; inspected failure PNG
SHA-256 `e9485b2e4c4b59222e23fc2b253ed27c237270b708cac9b0380922fa1126618d`.
No suite promotion follows from this diagnostic profile.
