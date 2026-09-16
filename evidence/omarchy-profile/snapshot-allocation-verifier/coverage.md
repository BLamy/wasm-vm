# E5.5-T03al independent coverage audit

Source head: `512ba6acc9b0293d04d96115372ddef2b1cccfab`.
Final artifact head: `bb3c13dd6014ca15f29fe897b3ba207d65bc67b8`.
Only the four generated artifact manifests changed between these heads;
`cold-deploy-audit.json` independently checks their unchanged artifact hashes,
unchanged runtime closure, and both deployment origins' recorded bytes.

| Changed hunk | Evidence and classification |
|---|---|
| `crates/core/src/resume.rs:477-484` exact section reservation | **Executed.** Actual release WASM serializes the 16 R3 sections in each direct save and in `persistSnapshot`. The full outputs match an oracle derived from the pinned original independently of this writer. The RAM payload is 899,036,883 bytes, followed by 14 smaller sections, directly exercising the formerly failing suffix allocation. The four-seed native attack covers 4,704 section appends across 192 independently checked prefixes, including empty sections. |
| `checked_add` overflow panic text | **Waived as unreachable defensive failure for this boundary.** The input's largest payload is below 900 MiB, and every accepted slice is already resident under the wasm32 address-space limit. No valid R3 section approaches `usize::MAX - 8`; success-path checked addition executes. The pre-existing u32 length conversion remains unchanged. |
| Comment explaining geometric spare capacity | **Waived: documentation.** Independently demonstrated by baseline and reservation-removed tests (131,171-byte result with 262,326-byte capacity), versus exact 131,171-byte candidate capacity. |
| `tools/verify/omarchy-snapshot-allocation.mjs` | **Executed accepted boundary.** The recording runs real persistent construction, pinned fetches, original restore, byte/hash comparisons, matching/stale/foreign decision checks, second restore, persistent save/read, stored restore, real 127-test UI, screenshot and cleanup. The oracle's first/restored queue paths both execute. Defensive server/error branches are recording infrastructure, not an expanded runtime claim; the preserved original release-WASM trap and isolated source sabotage establish the regression discriminates the allocator. No guest-run or keyboard API occurs in the script. |
| Gate and cold-clone recorder scripts | **Executed.** Their actual commands and failures are retained. The pristine clone rebuilds the runtime from source and reproduces all direct/persistent snapshot hashes and 127/0. Scrubbing code removes RUSTFLAGS/RUSTDOCFLAGS/RUST_LOG/CARGO_*/OMARCHY_* before commands; only RUST_LOG was present in the parent environment. |
| `web/roadmap.js` and generated copy | **Executed display assertion.** R1 and cold reports read the named capability, require T03al wording, and require its `in-progress` pip. Text explicitly says desktop responsiveness remains unresolved. |
| Generated WASM | **Executed.** R1 and cold use SHA-256 `8230800b2ed4fe92ed0647d871d6c548fe824f3a550b09ca4a9b4941bc220ca4`; the fresh source build is byte-identical. |
| Generated service worker cache version | **Waived generated cache metadata.** Its version changes with built assets; deployed bytes equal final head. Browser acceptance disables service workers to ensure the asserted runtime was fetched. No service-worker logic changed. |
| Generated artifact URLs / whitespace | **Waived deployment metadata, identities checked.** Final manifests preserve artifact hashes and sizes while restoring the existing remote large-artifact URLs. The Omarchy public manifest is byte-identical on deployment and production origins. |

No header, tag ordering, payload codec, restore guard, device quiescence, guest
architecture, or console restore lifecycle changed. The two allowed console
field transitions are an existing restore contract, derived before final
evidence and independently hashed. A plain persistent save/read permits no
transition at all.

The observed repeated-restore linear-memory high-water mark is 4,183,490,560
bytes. This proves the pinned R3 workload and does not promise a general bound
for every possible 1 GiB guest state, additional live guests, or indefinite
snapshot retention.

## Permanent artifacts

Retain `tools/verify/omarchy-snapshot-allocation.mjs` as the actual built-WASM
regression and retain the verifier's four-seed source-module oracle, source
sabotage recipe, and independently derived R3 hashes as reproducible bounded
evidence. No generated native executable needs to be committed; its frozen
source, compiler command, exit status, and exact failure output are retained.
