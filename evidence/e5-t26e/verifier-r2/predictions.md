# E5-T26e fresh-verifier predictions — 2026-09-07

Exact submitted head: `8c9314817321420fb94bfdaf23ae6491723f2e80`; implementation:
`58a1f46364a46985bf7750a1b3e2c8b4f4f9b139`.

These predictions were frozen after reading AGENTS.md, the full task, both implementation diffs,
and the submitted evidence, but before executing verifier tests.

1. **P1 pre-commit repair invariant.** Every successful coordinator run will call GPU, input,
   sound, agent, viewport, and full-repair preparation in that order before the first live commit.
   A repair refusal will call no commit and will finish with transient cleanup then cold fallback.
2. **P2 opaque transaction states.** An external backend will be unable to manufacture either
   `DesktopRestorePreparation` or `DesktopRestoreCommit`; the production backend will return
   success only after all prepared values still match the commit token.
3. **P3 production composition.** `Machine::restore_desktop_snapshot` will execute the concrete
   backend, round-trip nontrivial T26b GPU, T26c input, and T26d sound state, re-handshake the real
   machine agent transport, and retain the committed viewport/repair state after the temporary
   call frame is gone. A returned `Ok` with the console generation/readiness unchanged or with no
   retained host viewport/repair state will fail this prediction.
4. **P4 payload semantics.** A nontrivial input snapshot will restore pending state and produce the
   T26c release reconciliation count; a configured sound snapshot will restore guest configuration
   and produce the T26d XRUN repair count. Default/empty payloads alone are insufficient evidence.
5. **P5 atomic rollback.** If commit fails immediately after GPU publication, GPU, input, sound,
   agent, and viewport state will all equal a clean cold-boot baseline, even when the live devices
   were dirty before restore started. Merely restoring that dirty pre-call state will fail the
   task's clean-cold-fallback claim.
6. **P6 hostile inputs.** Malformed envelope/component bytes, forward versions, oversized/invalid
   dimensions, missing sections, dropped agent, viewport refusal, and repair refusal will return a
   bounded typed error, publish no partial host state, and finish at cold fallback.
7. **P7 coverage.** The exact-head proof will execute every runtime hunk from `74eb1eec` and
   `58a1f463`, including the `Machine::restore_desktop_snapshot` composition and all concrete
   backend rollback branches, or classify a hunk narrowly as declarative/diagnostic.
8. **P8 environment independence.** The scrubbed exact-head gate and a pristine archive of the
   submitted head will pass without repository-local target artifacts or inherited Cargo/Rust log
   variables.

WebKit, independent-machine, browser pixel/CRC, and host rr predictions are waived as directed.
