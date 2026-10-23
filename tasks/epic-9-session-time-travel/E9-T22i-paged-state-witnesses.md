---
id: E9-T22i
epic: 9
title: Commit long exact histories with bounded durable witness pages
priority: 524.9220215
status: in-progress
depends_on: [E9-T22e]
estimate: S
risk: high
capstone: false
---

## Goal

Preserve every required exact state witness in authenticated durable pages
without expanding the manifest extension or resident witness window.

## Boundary

One versioned durable witness-commitment/reference boundary. Preserve v1
read/append compatibility and the unchanged 8192-byte per-extension limit.
A compact commitment names bounded content-addressed witness pages; publication,
closure authentication, GC and local archive inventory must all retain and
validate every referenced page. Reader/executor integration remains F/G/H.

## Acceptance criteria

- [ ] Persist, reopen and independently authenticate a complete ordered commitment with at least 130 actual native state witnesses using bounded resident pages, exact initial/final bindings and no global witness-byte array.
- [ ] Preserve the existing manifest/extension/session/retention limits, native replay-plan limits and v1 semantics. Bind count/order/positions/digests/page references to the immutable initial state and final endpoint; no constants-only increase or omitted checkpoint witness.
- [ ] Reject missing/reordered/duplicated/corrupt pages, conflicting content lengths, wrong endpoints, stale publication and partial quota failure before publication/restore. GC/export/import inventory must include the complete page closure; older recordings remain intact.
- [ ] Complete the scoped high-risk local native/Wasm/browser gate, visible demo/main release and final pristine proof; obtain a NEW actual Daybreak critic covering every changed boundary, all attacks, one novel attack and meaningful sabotage.

## Deterministic acceptance

`make verify-E9-T22i`. Planned single acceptance target including
`node tools/verify/e9-witness-pages-browser.mjs --witnesses 130 --mutate-middle`.
It is not an existing passing command. The projection below is a discovery
proof, not implementation acceptance or a completed original recording.

## Adversarial verification

Mutate a middle page and its order, delete one required witness, swap final and
initial positions, duplicate a reference with another length, interrupt the
publication, and reclaim/export/import the history. Independently decode raw
page bytes and count every state, not just endpoints. Keep the fixed 50M
checkpoint gap and original full workload/budgets. Reject a valid root whose
referenced pages are incomplete or semantically inconsistent before admission.

## Verification log

### 2026-10-22 — worker — concrete v1 witness-byte blocker

Fresh actual Daybreak independently recovered all 45 authentic checkpoint
witnesses from corrected Omarchy attempt 3: five full frames, forty delta
frames/descriptors and their RAM/renderer/clock seals. It made a labelled
FORMAT PROJECTION ending at the last captured keyframe, transition
`2200000000`, sequence `700`, removing exactly the later sequence-701 event
chunk from an isolated manifest copy. The original retained run is unchanged
and remains incomplete; no workload, replay or desktop qualification is claimed.

Exact production witness serialization is 9888 bytes. Witness 37 is 8121 bytes;
witness 38 is 8344 bytes. The real built session Wasm validator rejects the
45-row candidate with `session metadata: TooLarge("extension bytes")`. The
identical projected manifest with a 426-byte two-endpoint format control passes
manifest and append validation; that control intentionally does not satisfy
GPU completeExact's every-checkpoint coverage and is not an implementation.

All five sealed predictions held in
`target/evidence/e9-t22c-daybreak-witness-capacity/report.md`, SHA-256
`ac298bc3f0691b1093fc728ea9cd5c41cd37bcce29dfac52856322170f7f9975`.
Requested/returned `gpt-daybreak-blue-latest`, `daybreakBlue`, completed with
no errors or fallback. The actual reproducer is the audit.mjs in that named
witness-capacity directory (the report's command examples accidentally use
the prior capacity directory in several places; routing records the correct
executed commands). This is a concrete format-boundary prerequisite after E
and before F, outside medium-risk C. All PRs remain open/unmerged/unqueued.


### 2026-10-23 — worker — activate the witness commitment boundary

E9-T22e is independently verified at
`e52219ad5bbf70531f7237a0e72d187573e726a5`, pushed to open draft PR #608.
Actual main release `13ba6e20e79dce8c1d4fa800c7950629f0c28ceb`, deployment
`9eb734fc`, is live at <https://wasm-vm.pages.dev/app>. The NEW actual
Daybreak final-publication report is
`target/evidence/e9-t22e-daybreak-final-publication/report.json`, SHA-256
`add71ca57c9da025140e849f744e084472cf75d009399624d1983e49d5956415`;
requested/returned `gpt-daybreak-blue-latest`, `daybreakBlue`, completed,
no errors or fallback. It independently authenticated 22 main GETs and
seven exact R2 HEADs and carried the source-bound local/cold charter.
All 31 existing native stacked PRs stay open, draft, unmerged and unqueued;
Actions is disabled. This task alone now occupies the active lane.

Continue on native branch `codex/e9-paged-state-witnesses`. Risk is high for
versioned persistence/identity/reference closure. Implement one atomic
commitment boundary across native/Wasm metadata validation, durable
publication, closure/GC and archive inventory. Keep existing v1 semantics,
8192-byte extensions, manifest/session/retention caps, original assets, 50M
checkpoint gap and all downstream workload/performance budgets. A new
reference-bearing feature must make unsupported old clients fail before
cleanup rather than omit its references. Reader/executor integration remains
F/G/H; do not imply completed whole-history replay or desktop qualification.

The current native publication codec allows immutable extensions or one v1
completion list only; reference discovery does not yet inspect extensions.
The new format must authenticate all bounded pages and exact previous
prefixes, retain every required state/checkpoint witness and preserve old
roots under failed publication, GC and transfer inventory. At least 130
actual native witnesses must be recorded and independently decoded; generated
coordinates or an endpoints-only list cannot substitute. The planned
acceptance command is still not implemented or passing.
