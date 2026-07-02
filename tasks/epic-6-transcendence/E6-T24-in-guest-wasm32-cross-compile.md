---
id: E6-T24
epic: 6
title: In-guest cross-compile to wasm32 and wasm-bindgen artifact production
priority: 624
status: pending
depends_on: [E6-T23]
estimate: L
capstone: false
---

## Goal
The guest cross-compiles the web crate to `wasm32-unknown-unknown` and runs
wasm-bindgen-cli to produce the complete deployable artifact set (`.wasm` + JS glue +
types) — functionally validated by loading that exact artifact in the host browser —
with every toolchain gap documented honestly rather than papered over.

## Context
Cross-compiling *from* riscv64 *to* wasm32 in-guest exercises paths T23 didn't:
proc-macros and build scripts execute as riscv64-native binaries (our CPU runs them —
wasm-bindgen's derive macros are a heavy proc-macro workload), the wasm32 std from
E6-T22 links for real, and `wasm-bindgen-cli` (riscv64 build, version-pinned) rewrites
the wasm binary and emits JS glue. Known gaps to confront and document: no `wasm-opt`
(binaryen on riscv64 is out of scope — measure and record the size/speed delta vs the
CI artifact, which does run it); `getrandom`'s `js` feature and any other
target-conditional deps must already be in the vendor tree (E6-T22 acceptance covered
this — verify under the real workspace); reproducibility vs the CI artifact is *not*
promised (different rustc build, no wasm-opt) — equivalence is established functionally,
not byte-wise. Egress: `pkg/` leaves the guest via the 9p/OPFS share (E6-T15) for
host-side validation; the capstone will serve it from the guest instead (E6-T25).

## Deliverables
- `docs/self-hosting.md` (part 2): cross-compile runbook — exact cargo/wasm-bindgen
  invocations, wall times, artifact size table (in-guest vs CI, with/without wasm-opt),
  and the toolchain-gap register (each gap: impact, workaround, upstream issue link if
  filed).
- Build fixes so the web crate + bindgen wrapper build unmodified in-guest at the pinned
  commit (e.g. feature-gating anything that assumes wasm-opt or host tooling).
- `tools/validate-artifact.sh` (host side): loads a given `pkg/` into the standard
  runner page, boots the Epic 0 bare-metal trace test and a minimal Linux boot, and
  compares trace output against the reference — the functional-equivalence gate.
- The first in-guest-built artifact checked into release storage (not git) with its
  build log and environment manifest.

## Acceptance criteria
- [ ] `cargo build --target wasm32-unknown-unknown --release -p wasm-vm-web` completes
      in-guest, offline, unmodified; wall time recorded (< 30 min at smp=4/JIT on the
      reference host).
- [ ] `wasm-bindgen --target web` in-guest emits `pkg/` (wasm + JS + .d.ts); the
      version-pin gate passes.
- [ ] `validate-artifact.sh` on the guest-built `pkg/`: the Epic 0 trace test matches
      Spike byte-for-byte and Alpine boots to login in the host browser using the
      guest-built artifact exclusively.
- [ ] Size table committed: guest-built wasm within 1.6x of the CI wasm-opt'd artifact,
      with the delta attributed (no-wasm-opt share vs other).
- [ ] The gap register documents every deviation from the CI pipeline — zero silent
      differences (CI pipeline steps enumerated and each marked replicated/skipped).

## Adversarial verification
Break the equivalence claim: run the *full* riscv-tests compliance suite through the
guest-built artifact (not just the validator's smoke tests) — any failure the CI
artifact of the same commit passes is a miscompilation caught red-handed and refutes.
Attack the proc-macro path: build a scratch crate with a pathological derive expansion
(deeply nested types) in-guest — a wasm-bindgen macro crash or expansion differing from
the host build refutes. Cold-cache attack: wipe `target/` and `~/.cargo` in-guest and
rebuild offline — any network attempt or missing vendored piece refutes E6-T22's
completeness as inherited here. Cross-check honesty: independently diff the CI
workflow's steps against the gap register — an unlisted step (a strip, a feature flag)
refutes "zero silent differences". Load the artifact in Firefox and Safari, not just
Chrome — engine-specific failure refutes, since the CI artifact works on all three.

## Verification log
(empty)
