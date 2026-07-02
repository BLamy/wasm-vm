---
id: E6-T26
epic: 6
title: Opt-in telemetry and crash reporting
priority: 626
status: pending
depends_on: [E6-T19]
estimate: S
capstone: false
---

## Goal
Strictly opt-in, schema-allowlisted telemetry (boot outcomes, timings, device error
counters) and crash reporting (symbolicated wasm panics) that a platform needs to be
operable at scale — engineered so the privacy promise is verifiable from the outside,
and so a crash is diagnosable even when the user opted out (via a local, user-initiated
diagnostic bundle).

## Context
Once the VM is an embeddable component (E6-T19) and a shared-link destination (E6-T18),
"it broke for someone" becomes the common failure mode. Telemetry: default OFF, consent
UI with persisted choice, respect DNT/GPC signals even when consented; events pass
through a compile-time schema allowlist (event name → typed numeric/enum fields only —
no free-form strings, which is what makes "no guest data" enforceable rather than
aspirational); dispatch batched to a self-hostable endpoint. Crash reporting: a Rust
panic hook captures panic message + wasm stack; builds keep the wasm `name` section (or
ship a separate symbol file keyed by build id) so frames symbolicate to Rust paths;
guest state *never* attaches automatically — the local diagnostic bundle (downloadable
JSON: panic, config, capability matrix, recent device error counters, explicitly *not*
RAM or serial contents) is generated on demand and shared by the user if they choose.
The SDK surface: embedders can force-disable telemetry for their users
(`telemetry: 'disabled'`), and can never force-enable it.

## Deliverables
- `telemetry/` module: consent store, allowlist schema (checked in as code + doc),
  batcher, endpoint client; panic hook + symbolication tooling (`tools/symbolicate.py`
  taking a report + build symbols).
- Consent UI in the runner page; SDK `telemetry` option with the disable-only override.
- Local diagnostic bundle: generator + a docs page telling users exactly what's inside.
- `docs/privacy.md` update: full event inventory (name, fields, trigger), retention
  stance, endpoint self-hosting instructions.

## Acceptance criteria
- [ ] Fresh profile, full boot + 10 min use with no consent given: zero requests to the
      telemetry endpoint (network-log capture in CI asserts this).
- [ ] After consent: boot events arrive with only allowlisted fields — the endpoint-side
      test rejects (and the test fails on) any unexpected field or string payload.
- [ ] A seeded `panic!()` in a debug command produces a crash report whose top 3 frames
      symbolicate to the correct Rust file:line via the symbol artifact.
- [ ] Embedder sets `telemetry:'disabled'`: consent UI never shows, no requests, even if
      a stale consent flag exists in storage.
- [ ] DNT=1 with prior consent: no requests, and the UI reflects why.

## Adversarial verification
Try to make it leak: with consent granted, run a guest session containing planted
markers (a distinctive hostname, filename, serial output string), trigger events and a
panic, then grep every byte the client sent (mitmproxy capture) for any marker — one hit
refutes the "no guest data" claim. Attack the allowlist at the source: attempt to add a
telemetry call with a string field in a scratch branch — the build or test must fail
(the enforcement must be mechanical, not review-based; if it compiles and sends, that
refutes). Attack consent persistence: grant, then clear site data, reload — sending
before re-consent refutes. Corrupt the symbol artifact and verify symbolication fails
loudly rather than mis-attributing frames. Finally audit the diagnostic bundle from a
session with secrets in RAM and in serial scrollback — presence of either refutes the
bundle's documented contents.

## Verification log
(empty)
