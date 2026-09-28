# E5.5-T03y independent verifier evidence

Read `final-verdict.md`, `final-audit.json` and `coverage.md` for the final result.
`predictions.md` was written before worker evidence was inspected. The worker's
frozen submission is in the sibling `fp-to-word-r1/` directory; every file in
its 54-entry seal was independently rehashed.

The promoted fixtures are native/shared support, native instrumented module
tests, and private/shared WASM chain/growth tests. Their frozen source hashes
are in `frozen-fixtures.json`; final worker and cold logs repeat their results.

Historical diagnostics are retained rather than relabeled:

- `wasm-preseal.log` used a test-generator cast before a modulo operation. That
  selected different valid seeded literals on 32-bit WASM and 64-bit native.
  The verifier fixed the fixture before freezing it; `wasm-preseal-fixed.log`
  and both final acceptance logs have identical native/private/shared digests.
- `sabotage-mutant.log` is the deliberately wrong isolated assertion; its failure
  is expected. `sabotage-restored.log` proves the exact original fixture passes.
- `public-fetch-sandbox-dns.log` records the sandbox's DNS restriction. The
  approved read-only network retry in `public-fetch.log` passes all ten public
  byte comparisons against the frozen Git artifacts.
- `provisional-review.md` records the earlier checkpoint. `final-verdict.md`
  supersedes its then-pending cold/public/seal items.

The physical test still fails. The broad gauntlet also retains its five
unchanged failures. Neither is represented as passing by this verification.
