## Summary

Adds only saved supervisor previous privilege (mstatus bit 8) to the browser
inline-cache context projection. Live privilege, memory permissions and guest
trap/return semantics remain unchanged.

## Verification

Daybreak Blue independently verified E5-T26n. Luna's real guest SRET tests cover
S-mode cache/link reuse, U-mode compiled entry followed by an S-only store fault,
and authentic SBI timer cancellation with nested return. Daybreak's independent
guest-set/guest-cleared SSIP variant is promoted as a permanent regression test.

- Final exact test head: `b50491ceafc5be9029ee96dc9229085efd354e22`.
- 29 native and 51 actual-WebAssembly tests; scoped format/clippy/target builds.
- One pristine clone with scrubbed overrides, fresh target and clean checkout.
- Built Chromium demo: 126 passed, 0 failed, no collected non-favicon errors.
- Deliberately unsafe SUM mask fails both private and generated-code controls
  in an isolated scratch copy, automatically restored.

Full evidence: `evidence/e5-t26n/README.md` and
`evidence/e5-t26n/verifier/final-verdict.md`.

This does not claim a speedup or satisfy E5-T26f's two-second desktop deadline.
No production-only outage release or Epic 6 work is included. Leave this stacked
PR open until the user-authorized Epic 5 merge milestone.
