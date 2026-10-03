# Draft read-only review — no verdict

2026-10-03, moving uncommitted implementation based on activation `0b7c9341`.
This is orientation, not final evidence. No runtime files were modified by the verifier.

Reviewed the complete initial `control3d.rs`, core dispatch/feature/snapshot/Machine/desktop changes, Wasm marshaller and fixture, and JS bridge with its owner dependencies. The draft has the requested full response preflight before sink dispatch, private SG validation/copy before publication, shared public resource collision checks, explicit proof construction, and early outer snapshot guards. Expected sink failures leave Rust public transport metadata unpublished. Context destruction removes membership without conflating it with public resource unref. I found no independently confirmed semantic refutation in this pass.

Root supplied and fixed a development finding while this review was active: an applied creation followed by a callback throw advanced JS highwater but not Rust generation; preserving highwater across reset then rejected a legitimate retry. Supplemental P16 records an independent check of the corrected epoch transition without rewriting the original predictions.

Prepared independent tests, not yet executed against the moving draft:

- `native/`: separate Cargo package using the public core API; builds literal split requests and MMIO queues independently. Tests full-RAM/CPU/transport preservation across seven snapshot refusals with an outstanding queue kick, a valid legacy resume blob, and the missing-device desktop fallback path. Tests reply/backing SG aliases, an invalid final RAM segment, short legal recovery, and owned byte lifetime with three asymmetric seeds.
- `browser-attacks.mjs` and `run-browser.mjs`: separate literal Wasm queue driver and hardware browser launcher. Tests reply aliases against actual resource-store bytes, GL allocation size/lifetime, retained references through context destroy/unref/ID reuse, stale generations, response preflight, callback apply-then-throw recovery, and real second-owner/GPU allocation failures. Two served-source sabotage variants skip backing publication or retain reset highwater.

Node syntax checks pass. Rust source was formatted. Runtime execution, screenshots, coverage, exact-source audits and verdict await the frozen worker/cold-clone handoff. The native sink tests prove transport and are explicitly not GPU evidence.
