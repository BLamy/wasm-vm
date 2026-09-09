# E5-T26e fresh adversarial audit — VERDICT: refuted

Reviewed exact submitted head `8c9314817321420fb94bfdaf23ae6491723f2e80`, implementation
`58a1f46364a46985bf7750a1b3e2c8b4f4f9b139`, task implementation range
`8237f698..58a1f463`, submitted evidence digest
`81401c4d4037fa2c463b69a1c7c4e26d7ddc00deba20e7da925101c1ee77c253`, and the prior refutation.

## Prediction results

- **P1 pre-commit repair invariant — HELD.** The coordinator calls repair preparation at
  `desktop_restore.rs:411-419` and commit only at `:420-428`. The mock refusal test and fresh gate
  verify that a repair refusal skips commit and calls clear/cold. This carries forward the repaired
  portion of the prior refutation.
- **P2 opaque preparation/commit token — HELD.** The external safe-code probe receives E0451 for
  all preparation fields and for the commit field. The preparation is matched against the staged
  viewport values at `desktop_restore.rs:731-739`.
- **P3 concrete production composition — FAILED.** The production method checks only GPU, keyboard,
  and sound (`lib.rs:1771-1785`), creates a backend whose synthetic `agent_available` defaults true
  (`desktop_restore.rs:555-558`), and drops that backend after returning the coordinator report
  (`lib.rs:1786-1795`). The public-API harness assembled a Machine with no virtio-console and still
  observed `Ok`, `agent_rehandshake=true`, and letterbox success. No T23e Channel HELLO/reconnect
  occurred, and the backend's agent/viewport/repair host value is not retained by Machine.
- **P4 real payload semantics — PARTIALLY HELD.** The external production-composition run used a
  real GPU resource/scanout, a non-empty keyboard pending frame, and a Running sound stream. It
  retained two input events, Running sound state, and reported one XRUN. The existing T26c gate
  separately exercises held-key release. This does not cure P3: the real agent/viewport boundary
  remains absent.
- **P5 post-publication rollback/cold fallback — FAILED.** The injected failure occurs after
  `GpuState::restore_snapshot` has called the live frame sink (`desktop_restore.rs:757-760`). Device
  snapshots roll back, but the external sink recorded one restored 4x2 frame and no later clearing
  frame. The `rollback` helper restores only serialized device bytes (`:600-603`). Separately,
  `new` labels snapshots of whatever current devices it receives as cold (`:520-544`); when given a
  dirty 640x480 scanout 99, failure restored that dirty state, not a power-on baseline.
- **P6 malformed/forward/size/refusal attacks — HELD.** The exact gate covers malformed envelope,
  forward outer section, missing section, zero host dimension, dropped agent, viewport refusal,
  repair refusal, and malformed component payloads. The external attack additionally rebuilt valid
  envelopes around forward-version and trailing-byte GPU/input/sound payloads; all six returned
  `component_refused` with device bytes unchanged.
- **P7 coverage — INSUFFICIENT FOR THE CLAIM.** The Makefile hunk ran in-place and cold; the module,
  coordinator, token, concrete adapter success/refusal, post-GPU rollback, and all four production
  composition outcomes ran. Defensive impossible-through-coordinator branches (unknown tag,
  missing staged fields after a valid token, `usize`→`u32` overflow) are waived as guards. However,
  there is no changed hunk implementing a real T23e agent handshake or retaining/applying T22
  viewport state, so those acceptance claims cannot be covered. `git grep` finds no production
  call site outside the newly added method itself.
- **P8 scrubbed/pristine gate — HELD.** Both in-place and `git archive` cold runs passed 10/9/6/12/6
  relevant tests, format, both clippy modes, and the wasm32 no-default-features build.

## Mock and environment audit

The worker's concrete success fixture uses default empty input and sound payloads and inspects
`backend.host_state()` before the local backend is dropped. The fresh harness replaced those with
nontrivial payloads and invoked the public Machine composition. The agent refusal toggles and
viewport refusal toggles are test seams, not connections to the verified T23e JavaScript Channel or
T22 browser viewport. No inherited Cargo/Rust-log variable or repository-local target artifact was
needed by the cold gate.

## Coverage and suite decision

- `Makefile`: declarative recipe, executed twice.
- `desktop_restore.rs`: coordinator and concrete backend exercised by worker tests plus the external
  five-test harness; stale frame and dirty fallback are semantic refutations.
- `desktop_restore_tests.rs`: all ten tests executed; their host-state assertion ends before the
  production backend is dropped and therefore does not prove production retention.
- `lib.rs`: module compiled; success plus all three missing-device branches executed externally.
- **SUITE:** retain the evidence-only five-test harness as the reproducer. Do not promote it into the
  implementation suite until the production agent/viewport composition and host-frame rollback are
  corrected.
