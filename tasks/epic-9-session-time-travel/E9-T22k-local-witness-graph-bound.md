---
id: E9-T22k
epic: 9
title: Admit bounded large local histories without widening portable archives
priority: 524.922027
status: implemented
depends_on: [E9-T22j]
estimate: S
risk: high
capstone: false
---

## Goal

Let a genuinely retained local exact-GPU history grow past the portable
archive's 4 GiB logical graph cap while keeping every local reference
authenticated and bounded.

## Boundary

One policy split in complete witness-graph inventory and its local consumers.
Local publication, reopen, cleanup, library preview and bounded history reader
must admit an authenticated graph whose logical object lengths exceed 4 GiB
but whose physical chunks obey configured retention. Keep a separate explicit
local logical/object-count guard. Portable bundle and storage-only witness
archive export/import remain capped at 4 GiB and 65,536 objects. Do not change
checkpoint cadence, guest assets, workload amounts, archive format, per-object
authentication, retention setting or replay semantics. E9-T22c owns the next
complete cold-workload run.

## Acceptance criteria

- [x] Reproduce the exact E9-T22c rejected publication boundary and independently
      account for its committed/candidate logical graph, physical chunks and
      authenticated witness closure. A local policy must accept that candidate
      without dropping a reference or changing its bytes.
- [x] Admit and reopen a bounded, deduplicated local witness graph above 4 GiB
      through every local consumer, including GC and the GPU reader. The graph
      inventory must still reject missing/corrupt/conflicting objects, excessive
      local logical bytes/object count and cancellation before publication or
      playback.
- [x] Continue to reject the same over-4-GiB graph as a portable bundle or
      storage-only archive with typed `BundleBound`; retain the existing 4 GiB,
      65,536-object and per-object archive limits and previous small archives.
- [ ] Pass scoped high-risk native/Wasm/browser gates, exact-head evidence,
      final cold-clone proof, a fresh actual Daybreak adversarial verdict and
      production demo verification. No C workload or timing claim belongs here.

## Deterministic acceptance

`E9_T22K_DESKTOP=target/evidence/e9-t22c-submission-b40712603/desktop make
verify-E9-T22k`: reconstruct the failed candidate from the retained original
browser state, resume its exact publication in a copy of that Chrome profile,
then run bounded browser attacks, independent byte oracles and the demo. Set
`E9_T22K_DESKTOP` to the same retained evidence bundle's absolute path in a
pristine clone. The failed C prefix is diagnostic evidence; a shortened boot
must not be called C acceptance.

## Adversarial verification

Try to smuggle the above-limit local graph into either archive path, corrupt
one unrequested physical chunk, remove a required witness page, collide a
digest with a different length, exceed the local object/byte cap, cancel an
inventory walk and induce GC. Inspect every changed caller so an archive or
immutable-source reader cannot accidentally choose the local policy. Sabotage
one rejection assertion and prove the test fails. Keep the 4 GiB archive
decoder/index bounds intact.

## Verification log

### 2026-10-24 — worker — implemented at frozen runtime head `141af383eb96969f6c729c315bbc9229109348a3`

`E9_T22K_DESKTOP=<absolute original E9-T22c failed desktop evidence> E9_OUT=target/evidence/e9-t22k-submission-141af383e make verify-E9-T22k` passed on a clean head. The prefix report SHA-256 `3b00800627ab349731f3a41d9ccab883c086056746a8a520726ee47ff7b655a6` independently reconstructed and authenticated all 1,172 references and 3,652 reachable physical chunks: the unchanged candidate totals 4,311,983,484 logical bytes but 2,981,235,217 reachable physical bytes against 8 GiB retention. The original portable archive inventory rejects it with typed `BundleBound`; local bounds, missing witness, conflicting length and cancellation attacks reject before publication. The exact saved-profile Chrome run continued the failed `cold-127` publication from revision 262 to 263, reopened byte-identical candidate, traversed the whole local graph, and kept it after garbage collection removed one corrupted unrequested orphan. Local GPU-reader inventory reached the expected unfinished-commitment refusal after admission; the immutable reader and both storage and playback exports rejected the same graph with typed `BundleBound`, including attempted caller `scope: 'local'`. Library preview reported the complete 4,311,983,484-byte history and 129 witnesses. Exact-browser report SHA-256 `6910d1ac31b0daba633c01cc92b1d1211d034b545c73d048d86153b25d8388fc`; browser trace SHA-256 `d2d9315341fa53c3149d55ab80808c427cf26fe1b4f111e32dc557ba940bc795`; acceptance log SHA-256 `49cbf3c4b8c9492574e86611b321f4614e799d59e01c49c50a0fb1a6f405c007`. The bundled demo report SHA-256 `8ecebe8a4ef7a1bd06b616b12a6ad6f1be5ec188ea0b967dbfaca275335a22e3` passed 127/0 with no console/HTTP errors.

Final pristine detached clone `/private/tmp/e9-t22k-cold-proof-20261024` at the same frozen head, with `RUSTFLAGS` and `RUST_LOG` scrubbed and no inherited `CARGO_*`, passed the same acceptance with a clean checkout. Cold prefix SHA-256 `3b00800627ab349731f3a41d9ccab883c086056746a8a520726ee47ff7b655a6`, browser report `ba8b54ad5f90d2f7333650d3641a4c2d68860596bc4540cfc816ac6caec4e02d`, trace `4366ba12c4c4564d96ecd8d13ac53acf87cee2945429efdc3175d99b53b6c033`, demo `af874f74d130ac1aed6b631ac7726fa703d007734513788c318c6e67a3833012`, and full cold acceptance log `12b653ebfd3de838769f90a0569af246f3be36f5e3f97092724f8d6ee2110738`. The first cold attempt wrote its log in the checkout root and was rejected by the browser's clean-worktree assertion; the successful retry put that log under ignored `target/evidence` without changing source.

`make test`, `make wasm`, and `make features test-riscv riscv-tests-suite determinism perf-smoke` passed locally, as did formatting, task policy, web-dist parity, the scoped unit tests, and the selected browser gate. `make ci` reached but stopped at pre-existing quarantined `zicsr-stub` `dead_code` warnings outside this diff; a strict stub Clippy rerun with only that warning class waived passed. The canonical `https://wasm-vm.pages.dev/` deployment log SHA-256 `067e5b04110f9b12cea5ad6904fc0ab2476922b995360ee44419c3048da661e4` and public-path demo report SHA-256 `ef0a44404677115e3ae1df9619b495c6321fde289b7b1f25580249bbb9badcaa` bind served assets to the committed bundle, show 127/0, no unexpected errors or horizontal mobile overflow. This task proves the local policy split, not complete E9-T22c workload qualification or a performance budget. Fresh Daybreak verdict is pending.

### 2026-10-24 — worker — activate from exact C failure

The complete Omarchy attempt at `b4071260307146339230ec0986daafcd9661dbeb`
and fresh Daybreak candidate reconstruction are recorded in E9-T22c. The
first rejected candidate is 4,311,983,484 logical bytes with only
2,981,235,217 physical saved chunk bytes. Production local publication calls
the shared witness inventory's 4 GiB archive guard before committing the
checkpoint. This high-risk S task isolates that runtime policy boundary; it
does not qualify the full workload, change the original reference, or authorize
a PR merge.
