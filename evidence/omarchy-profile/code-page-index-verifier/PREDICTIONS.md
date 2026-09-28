# Independent BA predictions (before executing tests or inspecting trial evidence)

1. A page absent from the index returns false without walking slots; source inspection
   should show only map removal before this return and no fallback full scan.
2. Target-page invalidation removes all its live indexed slots, increments discarded
   by that live count, and retains unrelated-page slots. Same-page replacement does
   not duplicate its index; invalidate/reinsert invalidates the new live block once.
3. Whole-generation flush clears page membership. Reusing the same physical page
   afterward must preserve the task's promised existing public counters. Compare
   exact old/new code on: insert A, flush generation, insert B on the same page at
   a different hash slot, then flush that page. Any `blocks_discarded` difference
   contradicts the explicit unchanged-counters claim even if guest execution agrees.
4. Inject a forged valid index pointing to another page: it must not discard that
   other page. Remove membership deliberately: no full-capacity fallback is allowed.
   These private-state attacks test index trust boundaries; arbitrary memory
   corruption is not an expected public input contract.
5. Capacity-one alternating-page replacement and independent seeded insert/flush
   sequences preserve exact membership and live discard counts. Sabotaging the
   target-page predicate must make the forged-other-page attack fail.
6. The recorded browser trial uses cap1024, recycling, decoded16384, jalr off,
   region chaining on, icount64, original geometry/quantum/budgets; source and
   actual served WASM identities bind to its frozen head. Independent nonce success
   does not prove responsiveness. The actual PNG must be viewed and Q stays gated
   when the returned prompt is absent.

Scope: AGENTS high-risk verification and the complete BA task. Diff read from
`b5308fc4` through `e92f702d` before predictions. No BA runtime evidence inspected.
