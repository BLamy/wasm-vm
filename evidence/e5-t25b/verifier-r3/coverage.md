# E5-T25b verifier r3 changed-hunk coverage

| Changed area after artifact head `a14bf545` | Disposition |
|---|---|
| `assertWindowMoved` in source and dist | **Executed.** Focused test plus 13 verifier boundary/hostile probes covered stationary, both directions, below/exact threshold, non-finite inputs, invalid direction, and invalid minimum. Dist is byte-identical to source. |
| Stationary/wrong-way repository regression test | **Executed.** Included in the 6/6 focused Node pass. The verifier additionally covered the exact 100px boundary and both direction signs. |
| Browser-loop pre/post titlebar acquisition, call to `assertWindowMoved`, failure-before-summary/aggregation, and retained geometry | **Needs evidence.** Static unique-order/dataflow audit held, but the current-head browser attempt stopped at `desktopReady`; no post-fix run executed this integration hunk. The old artifact predates it. |
| Release audit additions | **Executed.** Direct release audit passed. Its regexes prove token presence, so the verifier's separate source audit supplies ordering/dataflow proof. |
| Foot readiness change from `60_000` to `timeoutMs` | **Needs evidence with the same headed rerun.** Static diff audit proves this is the only delta after `b179d9cc`, but the current attempt timed out earlier at desktop readiness and never reached the changed Foot wait. |
| Old raw artifact producer/analyzer behavior | **Executed/audited at artifact head.** All raw invariants and indirect damage movement held. It is not current-head geometry-integration coverage. |
| r2 evidence plus task/queue metadata | **Waived metadata/evidence.** No runtime semantics. |

Required closing evidence: one successful exact-head headed baseline that reaches Foot, completes
five real drags, and retains per-run `windowBefore`, `windowAfter`, signed displacement with the
expected alternating direction, and absolute displacement >=100px before accepted aggregation.
