## Scope

E5-T26l refreshes only resident compile-job scores immediately before selection,
after unchanged bounded FIFO staging, stale cancellation and recount. Guest
semantics, byte/generation checks, admission algorithm, queue/cache/module caps,
eight-attempt/64-staging budgets, guest clock, image and F browser driver remain
unchanged. This is a bounded candidate, not a claim of F latency improvement.

## Local evidence

Frozen candidate: 42bb34d854aca091a3940191a8da3b7aff765cad.

- 373 native tests, including real Machine cross-pump late-hot selection with
  zero new nominations, stale resident/incoming refusal, and interpreter digest
  parity; the127-ELF instruction-trace differential also passes.
- 43 actual WASM tests and63 JavaScript tests pass. The existing long
  externref/eviction churn test remains ignored; it is not counted as passed.
- Built Chromium demo126/0, no non-favicon errors, L visible IN PROGRESS.
- Fresh Daybreak preflight caught and closed the recorder's success-head shape
  mismatch before browser launch. Its single scrubbed clone, sensitive sabotage
  and bounded zero-work final-pump attack pass; the promoted test subsequently
  passes the12-test pipeline gate. Final Daybreak browser review closesP1–P7
  HELD and marks **L verified**, explicitly not F acceptance.
- The new authenticated cold/restore/play screen restores matching CRC4b00f145,
  actual physical input and1440 fresh non-silent PCM frames from the same player.
  It **fails F's unchanged2000-ms cap at4727.945 ms**. Full raw failure is retained;
  this is not F acceptance, a speedup claim, or a deadline waiver.

Full index: evidence/e5-t26l/README.md. Runtime log:
evidence/e5-t26l/gates/runtime-42bb34d8.log.

F remains blocked/unverified with its original2000-ms requirement. No old seal
is rebound, no timing is subtracted, and no deadline/FPS/default change is made.
No merge or production deployment is included; Omarchy remains the final shipping
milestone after Epic5 and the user-authorized merge boundary.
