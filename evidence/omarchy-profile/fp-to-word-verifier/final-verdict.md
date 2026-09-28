VERDICT: verified

Scope: E5.5-T03y's FCVT.W.S/WU.S boundary and its required recorded submission.
**The physical desktop response still fails. T03q remains gated.**

Worker submission: `4b438ca2980a4b57b5eeb832ff1a6f7d880128ef`.
Runtime/fixtures/artifact: `53a095a485787e4ce6177712830d76728342b083`.
Pristine clone: `95c250fe56fb15f28ee022a21a3766176adca054`.
The post-freeze diff has no runtime, fixture, dependency, acceptance-harness or
tested app-shell change. All 54 worker evidence files rehash correctly; index
SHA-256 is `63857c1c4d19812d2ecf599c3cab24a348248feacf2d16875a1defe47b7d8591`.

- P1–P4 — HELD. Independent literal clipping, ties, negative-fraction WU,
  NaN boxes, WU sign extension, flags and x0/FS predictions match 21,120 literal
  states and 1,792 seeded alias/illegal states per actual native/private/shared
  executor. Every FPR and unrelated X register is compared directly. All three
  executors agree on literal digest `4083560513975942652`, seeded digest
  `4721190114470949240` and control digest `8504544371684976080`.
  Worker `acceptance.log:30–38,75–77,95–97`; cold acceptance repeats all three.
- P5–P6 — HELD. The instrumented module makes 1,080 legal calls in 2,048 cases
  and zero illegal calls, passing canonical source bits and resolved rounding.
  FS-Off/reserved modes preserve the exact parcel, virtual PC and completed
  prefix. Actual eight-import mixed execution, all optional helper orderings,
  exact integer write mask, no FPR dirty bits, rejected L/LU/D and unchanged
  integer-only execution hold. Worker `acceptance.log:32,38`; native promoted
  `verifier_mixed_optional_indices_and_integer_behavior` asserts the live mask.
- P7 — HELD. Genuine interpreted fcsr clear/mode changes, later load/store/
  illegal faults, sixteen same/cross-module budget/fault cases, and six actual
  private/shared memory-growth scenarios retain exact results and prefix state.
  Each growth is 65,536 bytes with one store callback. Worker
  `acceptance.log:70–107`; cold acceptance repeats these paths.
- P8 sensitivity — HELD. An isolated wrong literal expecting NV|NX=17 instead
  of NV=16 fails at `CRITIC_TO_WORD_NEGATIVE_HALF_RMM_GOLDEN`; restoration passes
  all 21,120 literals. See `sabotage.json`, `sabotage-mutant.log:10–13`,
  `sabotage-restored.log:6–9`. No implementation was mutated by the critic.
- P8 provenance — HELD. The scrubbed pristine clone rebuilds WASM
  `7feb3179f4088b4c9ef3f69c23804ff0d9691f412b7270c66f61bbd85dc5a6b9`
  and passes all 17 focused tests. Built and cold production guests both retire
  3,605/4,000 through JIT, preserve the asserted register/FPR-spill/CSR values,
  and have RAM digest `dc6e4da35c08d6733ee59187153ded08bc05a28b97e119120f38f9301ccc08b8`.
  Their guest ELF SHA-256 is
  `00645db64ba22d39876c0db2fe80a05756004ce256e3583efe971338f67bc71f`.
  All six built/cold screenshots were independently viewed and rehashed: 127/127
  live tests, zero errors and live conversion pip. Ten independent public HTTP
  fetches match frozen Git bytes at deployment and production origins, including
  the changed service worker. See `final-audit.json`, `production-inspection.json`
  and `public-inspection.json`.
- P9 measurement/gating — HELD; actual desktop response FAILED. The original
  readback interval ends at `2026-09-15T23:42:59.984Z`, exactly 120 seconds after
  typing. All 128 events are trusted, focused and acknowledged. Thirteen
  completed guest-file reads exit 75 without the nonce, with one further request
  pending. Independently viewed baseline/failure terminal images show only the
  original prompt, are byte-identical (`97fc180d4d35c68ca5941dc591afb315220550165469f3c4ead7827989cc2f3f`),
  and frames stay 2→2. Raw report SHA-256 is
  `9fdf9604e54206d87c27c9e6fb40c1d297b8fbb92768aa270edd40913ec2f687`;
  `physical-input/desktop/report.json:26110–26115` pins the deadline. See
  `physical-inspection.json`. Do not promote T03q or claim responsiveness.

Broad CI remains **failed**: the same five inherited targets and compiler
errors recur. Independent file/test-body hashes match the verified predecessor;
see `ci-inspection.json`. The unchanged interpreter/SoftFloat/decoder claims
remain HELD. Affected production/test Clippy and all nine focused commands pass;
native ISA is 128/128 and the ALU floor is 25.1 MIPS against 15. No broad-green
claim is made, and no unrelated gate is silently waived as passing.

COVERAGE: `coverage.md` maps every runtime hunk to executed proof. Types,
comments, generated metadata and asserted invalid helper preconditions have
explicit waivers; there is no unproven changed guest behavior or dead hunk.
SUITE: the three promoted verifier files retain literal, seeded, instrumented,
mixed-index, integer-consumption, fault and memory-growth checks under the
`make verify-E5_5-T03y` target. The sabotage copy is discarded; its receipts remain.
