# E5.5-T05c1 independent critic predictions

Written before inspecting any new implementation, worker run or result. Only the repository AGENTS.md and the complete task file were consulted. Root assigned orientation at activation 0105509c, with taskC independently verified at dddae3bc2c15b1332dedcb208f3b7e6c6f852127. These predictions are immutable; verdicts and later observations belong in separate files.

## P1 — Small runtime boundary, ceilings preserved

The frozen runtime diff will select the store's already configured scratch limit in the native 2D color transfer layout. The production selected value will still be 64 MiB; historical default will still be 8 MiB. Dimensional ceilings, depth conversion/layout ceilings, ownership rules, quota accounting and unrelated paths will retain their prior semantics. A diff that increases a constant or changes depth semantics falsifies this prediction. I will enumerate every changed hunk, tie executable hunks to evidence, and explicitly waive declarative/build hunks only where justified.

## P2 — Exact source and real hardware path

At acceptance start the served original source bodies and built Wasm identity will match the frozen commit (or a documented deterministic build of that commit). The recorded resource operations will originate from qualified Wasm virtqueues, reach the production resource store and physical GPU upload/readback, and reach journal checkpoint and restore into a fresh physical context. Hardware read calls, observed native byte counts, source bodies, command/device observations and evidence digests will be retained. Host-only layout arithmetic, a mock store, computed expected output reused as actual output, or an old-runtime checkpoint cannot satisfy this prediction.

## P3 — Captured R8 glyph resource 304 survives checkpoint

For actual format/dimensions corresponding to resource 304 (R8, 2048 by 2048), creation/upload will retain ownership and contain exactly 4,194,304 logical bytes. Its native color read will observe exactly 16,777,216 bytes, despite exceeding 8,388,608. Before checkpoint I expect every logical byte to match independently known nonzero, nonconstant input. Following guest-backing poisoning, checkpoint, a fresh physical-context restore and reread, all 4,194,304 logical bytes will still match the original byte-for-byte. Full retained buffers and digests will support the comparison; length-only, first-pixel-only, all-zero or truncated buffers fail. The existing proof machine RAM stays at 4 MiB through bounded bands.

## P4 — Selected 64 MiB boundary accepts; next valid resource rejects atomically

With the existing production scratch profile selected, a dimensionally valid 2D color resource with native read size exactly 67,108,864 bytes will complete the actual GPU checkpoint/readback path and retain correct nontrivial logical data. An immediately larger dimensionally valid resource will fail specifically at the selected native scratch boundary. From the instant before that rejected operation through its error, physical native read-call count, ownership/resource identity and quota totals will remain unchanged; no truncated result, partial checkpoint, new owned object or leaked quota is allowed. Dimensions and arithmetic will be inspected independently to exclude rejection by a different ceiling.

## P5 — Historical 8 MiB profile still bounded

With historical/default 8,388,608 selected, a bounded read at or below that ceiling will pass the actual hardware path with correct nontrivial bytes. The smallest selected valid larger resource used by the harness will be refused before physical read and before ownership/quota mutation. If production selection leaks into the historical profile, a >8 MiB read succeeds, or bounded historical reads fail, this prediction is falsified.

## P6 — Independent literal-pattern attack

I will add or supply a bounded independent input whose expected pixels are literal values chosen without the implementation's conversion helpers: asymmetric channel bytes, distinct row/column positions, a nonzero row tail, and positions on both sides of a bounded-band boundary. At checkpoint and fresh-context restore all logical bytes must match those independent literals, including the tail and band boundary, after different guest-backing poison. This attacks all-zero output, row-stride errors, stale guest backing, channel loss, band truncation and data reuse. The attack stays within the changed 2D color boundary and does not repeat original application/OS boots.

## P7 — Sabotage sensitivity

In an isolated scratch copy only, replacing the selected-limit use with the historical 8 MiB use at the changed runtime boundary must cause the direct acceptance proof to fail (at least resource 304's 16 MiB native read). Failure must be a useful assertion/error at that boundary, not a harness syntax or build failure. The unsabotaged frozen source must pass the same proof. No implementation change is made in the shared checkout.

## P8 — Frozen gates and isolated reproduction

Affected layout/resource tests, affected target build and deployable web asset build will pass with retained commands/results at the frozen source identity. The final acceptance command, make verify-E5.5-T05c1, will pass in one pristine isolated checkout of the final frozen head with RUSTFLAGS, CARGO_* and RUST_LOG scrubbed; inherited ignored local app state or old checkpoints will not be required. It will run on local Apple M4 Max GPU hardware. I will check evidence integrity before consuming outcomes and run the pristine proof only after freeze. rr/ssh dev/Actions are waived or prohibited and are not evidence.

## P9 — Incremental original taskC holds

The independently verified original application/shader/storage/snapshot/copy/build holds remain HELD only where code, dependency boundary and evidence digest remain unchanged. I will carry the durable taskC verdict forward rather than reopen those app/OS proofs. This slice will not change factory RAM/disk pairs, release pins or deployment state. Evidence must identify the new runtime checkpoint honestly and must not relabel an earlier checkpoint.

## Decision rule

Each prediction will receive HELD, FAILED or NEEDS EVIDENCE with concrete file/line/digest citations. A semantic contradiction yields refuted; an unexecuted relevant runtime hunk or missing actual hardware run yields needs-evidence. I will not edit source, app/browser/guest state, Git state or task status without the explicit final verifier lease. During this first phase I write only this prediction record and its digests, then wait for the frozen submission.
