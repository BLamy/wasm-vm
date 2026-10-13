VERDICT: verified

# Incremental independent review — build metadata isolation

Scope: `git diff b38123de a6670ee8 -- tools/build-docs.mjs`. This is a build-harness review; all unchanged round-3 UI/design HELD results carry forward. No browser, renderer, emulator, stack, deployment or task-status work is performed.

The inspected diff changes only the esbuild metafile destination, creates its parent directory recursively, and writes to `target/docs-build/bundle-metafile.json`. `git check-ignore` confirms that destination is ignored. The reviewed `design/docs-bundle-metafile.json` remains tracked but is no longer a build output.

## Predictions before execution

1. A documentation rebuild from an independently located temporary checkout of exact commit `a6670ee88ed60a342471fc84628bfc74f250fc5e`, with no preexisting target report directory, succeeds and creates valid esbuild input/output metadata only at the ignored destination.
2. All tracked files under `design/reviews/` and the historical tracked `design/docs-bundle-metafile.json` keep identical SHA-256 before/after the rebuild and documentation check.
3. The checkout path does not change the published documentation/reader asset identity. Generated paths/digests continue to match the reviewed cold-build receipt; any path-dependent esbuild report stays outside that evidence set.
4. No tracked implementation/review record changes appear in the alternate checkout after the narrow gates. Temporary checkout setup and cleanup do not alter the original branch or worktree.

## Observed results

- **P1 — HELD.** Fresh detached checkout `/tmp/wasm-vm-critic-metadata-yurwp2_f/alternate-checkout` was at exact `a6670ee88ed60a342471fc84628bfc74f250fc5e`, initially clean, with no `target/docs-build` directory. Fresh `npm ci --no-audit --no-fund`, `npm run build:docs`, and `npm run check:docs` all exited 0. The changed `mkdir`/write at `tools/build-docs.mjs:19` executed and produced valid metadata with 5,497 inputs and 174 outputs. `git check-ignore` returned the new report path, covered by `.gitignore:2`. See the witness's `commands` and `results.report`.
- **P2 — HELD.** All 44 tracked `design/reviews/` files and historical `design/docs-bundle-metafile.json` retained their SHA-256 values in both checkouts. Mismatch arrays are empty; the full 45-file before/after comparison manifest is retained in the witness. Historical metadata SHA-256 remains `8c65331ce1cc0b15d37495bac534bbef326f6770d9aab93b6a58b77dccf2ae89`.
- **P3 — HELD.** The complete generated path set and all 330 generated asset digests match `design/cold-docs-validation.json` (receipt SHA-256 `30d25f5f7c2ed4ed39592cedd623f9f3e68723c4e809d6bfd1201be14c47810e`). The receipt covers 174 reader bundle files and 156 corpus files. The documentation validation also matches the cold receipt: 154 pages, 225 local links, 181 unchanged code blocks, original shader digest retained. The new ignored report contains an actual path-dependent key, `source-text:/private/tmp/wasm-vm-critic-metadata-yurwp2_f/alternate-checkout/web/docs-src/architecture-demo.jsx`; this did not alter any published asset or tracked review evidence.
- **P4 — HELD.** Alternate checkout `git status --porcelain=v1` is empty after the gates and `git diff --exit-code` is 0. The owned scratch directory was removed after assertions. Source HEAD remains `a6670ee88ed60a342471fc84628bfc74f250fc5e` and source tracked diff remains empty. Only this review and its witness were added to the original worktree.

## Carry-forward and coverage

The only changed hunk is the metadata directory creation/write, directly exercised above. The unchanged UI, corpus, dependency boundary, rendered asset identities and recorded evidence carry the HELD findings from `critic-03.md` forward, including its **4/25** design score. This is not a new full browser/design round or an emulator verification. No remaining finding requires implementation changes within this diff; no stack, deploy or task-status action is authorized by this verdict.

Evidence: [independent run, assertions and preserved-file manifest](critic-build-metadata-witness.md), SHA-256 `51aa644ae306a87118b9d8d947c8872dfbdb1c77e58645a5fdf53825c1524dfa`.
