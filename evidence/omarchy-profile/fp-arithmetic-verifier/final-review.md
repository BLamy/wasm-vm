VERDICT: verified

E5.5-T03w's selected FADD.S/FMUL.S boundary meets its acceptance criteria.
Worker submission: `ef007bfe80bcad2bb1ea80b312cc2ffcc5c973bb`; runtime and
promoted fixtures: `357dd1a0f9f984747f3f92ad83b0ae556e6689f5`; scoped test/data
repair: `d64b037b362b36490d58b82663a448ac0532b025`; pristine/deployed source:
`f494ef51de1763d3a7f78d11f96d6afc50fc46e0`. No implementation was edited by
the critic. Predictions were recorded before worker evidence in `predictions.md`.

- P1–P3 — HELD. Independent literal rounding, NaN-boxing, flags and preservation
  assertions pass for all 8,832 cases per native/private/shared path. The receipt
  remains `17621813032391191516`; the 3,072 seeded exact-integer cases retain
  `12643572604827571813`. Sources and expectations are unchanged from the
  pre-freeze independent run; the same assertions also pass in the clean clone
  (`../fp-arithmetic-r1/cold/acceptance.log`). These are register/flag receipts,
  not whole-machine hashes.
- P4 — HELD. The actual generated-module import probe records 1,024 cases,
  exactly 540 legal calls and zero illegal calls. It checks canonicalized
  arguments, integer-only WASM operators and unexpected writes/imports. The
  seeded corpus includes 1,488 FS-Off/reserved-rm precise exits. Original parcels,
  virtual fault PCs and completed-prefix state match literal expectations.
- P5/P6 — HELD. The 11-case CSR/dependency/fault receipt remains
  `12235252711163659176`. Same-/cross-module successor tests exercise entry/fuel
  limits and later faults; private/shared growth tests cause one real memory
  growth/store and preserve subsequent dynamic rounding and flag replacement.
  Mixed integer/arithmetic/integer modules execute actual function indices
  6/7/8 with helper import 5; integer-only modules retain their five imports.
- P7 — HELD. Seeded exact-integer operands and aliases use independently
  calculated integer goldens. Additional literal threshold attacks distinguish
  true finite-saturating overflow from values just below 2^128, including
  `(2^64−2^41)*(2^64+2^41)=2^128−2^82`. The latter retains NX-only under
  truncation. Both the shared-backend correction and its false branch execute;
  the original rounded F32 result is retained.
- P8 — HELD. `wrong-golden-result.json` and the named assertion at
  `wrong-golden-wrong.log:10–15` prove one isolated incorrect half-ulp golden
  exits 101; restoration exits 0 (`wrong-golden-restored.log:6–9`). The shared
  test SHA-256 is unchanged. Retained earlier harness setup failures are
  explained in `provisional-review.md`; none caused a runtime edit.
- P9 — HELD. `final-audit.json` rehashes all 56 sealed worker files, checks
  exact runtime/test identities, and interrogates the pristine clone. The
  clone had no tracked/untracked changes before building, scrubbed Rust/Cargo
  overrides, rebuilt the exact committed WASM and passed the ordinary
  `make verify-E5_5-T03w` target. Final and cold browsers each pass 127/127
  with zero errors and execute 3,649/4,000 guest instructions via JIT; actual
  FPR spills, integer registers, flags/frm/FS and RAM digest agree. All three
  cold images were independently inspected (`cold-browser-visual-audit.json`).
  Eight independent TLS public fetches match the committed tested bundle on
  both the deployment and production origins (`independent-public-bytes.json`).
- P10 — HELD for measurement and gating; desktop response FAILED. The actual
  trial received 128 trusted accepted events but no independent nonce before
  `2026-09-15T21:46:39.143Z`, exactly 120 seconds after Enter. Frames stayed
  2→2. Independently viewed before/failure images are byte-identical and show
  only the initial Foot prompt. `physical-input-audit.json` binds report
  SHA-256 `c20fe7de2adb79c581367529f52d942b535d43f4d15e257dfa58cb4ee8cc8b85`.
  T03q remains pending. Arithmetic support establishes no desktop usability.

## Coverage, inherited boundaries and limitations

`provisional-review.md` classifies every implementation/import/handoff hunk.
The final audit confirms those source files stayed unchanged. Pure helper inputs
have no guest/device/scheduler reference; actual import guards and chain tests
exercise its integration. The defensive invalid-mode panic is excluded by a
proven generated precondition. F64's constant-false correction branch and the
integer-only returned-function-index bookkeeping are static equivalence waivers.
Documentation/configuration are non-runtime; the ordinary acceptance, visible
capability and public-byte checks prove their stated published claims.

T03t/T03u/T03v HELD proofs carry forward: 12 source/dependency/evidence boundaries
were rehashed in `carried-boundaries.json` and the final audit. No prior boundary
was reopened merely because the physical trial failed. The cfg(test) admission
and task-data repairs were verified narrowly; the rebuilt production artifact
changed, so its new bytes were proved again in final/cold/public/physical runs.
No byte equivalence with the initial production artifact is asserted.

Full `make -k ci` remains exit 2 on the recorded macOS seccomp, all-feature
unused-method, default VIRTIO_RNG resume assertion, zicsr-stub test-build and
test-only-clock scan failures. `inherited-gates-audit.json` independently hashes
seven underlying files against the verified parent; the two failing zicsr-stub
test bodies are outside the helper-closure diff. The full run's arithmetic
worker/critic tests pass, native ISA compliance passes 128/128 and the uncontended
performance smoke records 25.3 MIPS against a 15 MIPS floor. This is not a green
whole-workspace claim and no arithmetic speedup is claimed.

## Permanent suite and final binding

The three independent promoted fixture files are committed and exercised by
`make verify-E5_5-T03w`: support goldens/seeds, actual native import instrumentation,
and private/shared browser control/growth/chain tests. Wrong-golden sabotage is
retained as evidence, not as a failing committed fixture. No unresolved task
finding remains.

Worker seal SHA-256:
`4dc96dbb22a288fcf33d5839a45c8783dfafd641342f32d217a08b34ad07a2b2`.
Final WASM SHA-256:
`e84c821a12fa5782e229614b9bd3f5a37713e7f3e4d1d38788ac194a7a039db4`.
Independent final audit SHA-256: `7deb38980fc143a40ff59c0aa1451ae19de1c7795c45921101d559498c644956`.
