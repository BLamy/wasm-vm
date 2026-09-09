# Frozen-head independent attacks — predictions before execution

Target: `42bb34d854aca091a3940191a8da3b7aff765cad`. R1 and all three core-file bytes match the source-closed preflight. No shared implementation changes. Attacks follow the one pristine-clone runtime proof, using only that isolated clone and its initially fresh Cargo target.

## Sabotage

Remove only the production pump's call to `refresh_hotness` in the scratch clone. Predict the existing `later_hot_resident_wins_cross_pump_with_zero_new_nominations_and_digest_parity` regression fails specifically because the next first submitted PC is the older resident, not the later hot loop. Predict `cross_pump_stale_resident_and_fifo_cancel_preserving_fresh_same_pc_bytes` still passes under the same mutation: removal of selection refresh must not bypass unchanged stale cancellation/byte checks. Restore the exact frozen lib bytes before any novel attack. Keep the patch, logs and command/status/source digests.

## One bounded novel integration attack

The worker exercises separate ordinary `Machine::run` calls. Exercise the refresh boundary through a **single externally owned cooperative scope with multiple internal guest runs and a zero-work internal run** after its eight-attempt budget is exhausted. Predict all inner calls and outer finalization preserve exactly eight submissions while a queued later block grows hotter. Then open a fresh external scope and run **zero guest instructions**: the sole outer final pump must select the already-hot resident first, stage zero new nominations, submit only eight jobs, and leave the architectural snapshot/retirement unchanged. An independent interpreter executes the same instruction counts throughout.

This targets the composition of budget ownership and final-pump selection: no internal sub-run may reset budgets, but final selection in the next scope must not require a newly executed block/staged nomination. It uses the existing stalled executor and guest fixture; it does not claim actual WASM compilation, browser timing, fairness or fresh priority at admission. One finite case, not a new general scheduling requirement. If useful, deliver a test-only patch for coordinator review rather than editing shared tests.

No browser launches, old F/K experiment reruns, status edits or commits are part of these checks.
