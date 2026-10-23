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


### 2026-10-23 — worker — design and development evidence, not acceptance

A fresh actual Daybreak design critic returned the requested/returned
`gpt-daybreak-blue-latest`, `daybreakBlue`, completed with no errors or fallback.
Report `target/evidence/e9-t22i-daybreak-design/final-message.md`, SHA-256
`3b360f57604d23ca3f7be5f0da7f4b9b4e7ef7eed99dc72c04fecdc193f88fdb`;
routing SHA-256 `e9fedb4e41b98bfe89a52217149b20587b9c1bb032e0f20cfc7e24b65242e577`.
It required a storage-aware old-tail prefix proof, one shared complete graph
inventory, a terminal append state, disjoint archive schemas, explicit legacy
replay refusal and one cross-language canonical codec. This was a design review
of an unfinished implementation, not the final adversarial charter.

The implementation keeps v1 behavior and every old bound. Explicit paged GPU
mode creates a required v2 commitment in its first publication; an old v1
recording cannot acquire it later. Typed canonical <=8192-byte pages hold <=16
rows. The new page index is bounded by the existing 4096 index capacity; full
closure, retention, manifest, extension and native replay-plan caps are unchanged.
Publication/open/GC/storage archives share the same authenticated asset/event/
checkpoint/RAM/disk/page graph. Scalar native append checks are supplemented by
an exact old-tail ancestor/count check. Finished histories cannot append. New
storage archives use `wasm-vm-witness-storage-v2` plus `scope: storage-only`,
without installed-runtime portability or native playback admission. Old playback
archive schema/admission and default v1 recording remain separate. The timeline
and library explicitly gate paged playback.

Unfrozen development run
`target/evidence/e9-t22i-browser-development-1/report.json` remains FAILED: the
product completed 130 actual native witnesses, 67 genuine keyframes, 70 pages,
GC and storage-only import, but the evidence helper was registered twice while
capturing the second database. The complete primary physical store, raw native
states, raw receipts and archive were retained; that failed harness is not a
passing acceptance. Its first helper repair also used an unsupported Playwright
cleanup method; that failure is retained in development followup 1. Capture now
uses a fresh same-origin page for each database.

Development followup 2 restores that retained genuine history in a fresh browser
for bounded storage attacks; it is NOT another native execution or frozen proof.
It passed 32 attacks/controls and the actual old v1 archive export/inspection/
import control. Missing/corrupt pages, middle checkpoint deletion/digest changes,
reordering/duplication, rewritten old prefixes, stale CAS, final authorizer abort,
old-client required-feature refusal, archive-mode confusion and incomplete/extra
archive objects all refused. An actual 1 MiB-retention import staged 107 objects/
165921 bytes then failed before any session publication. A labelled nonempty
T14-root metadata fixture exercised complete disk-child inventory; it is not a
claim of native guest disk execution. Original final and older prefix manifest
hashes remained identical after attacks and GC. Report SHA-256
`371a00bfba077e22be59d9be7defa1344b99f06acf71e2d26fa645b6df9cbacc`.

The development-only literal decoder combines retained run-1 native bytes with
followup-2 physical stores. Its report is explicitly `development-partial`,
`target/evidence/e9-t22i-development-followup-2/independent-witness-oracle/report.json`.
It independently decoded all 130 native logical states/digest bindings and
reconstructed full/delta RAM at all 67 real keyframes. The old global witness
serialization is 27374 bytes, versus a 582-byte commitment and largest page
3537 bytes. It is not final acceptance.

Self-validation also passed storage tests, strict affected Clippy, 12 legacy
format/witness/timeline tests and documentation checks. After development, the
worker removed duplicate observer hashing without changing the workload, made
the page candidate share owned row payloads, added a u32-overflow refusal,
made finished journal construction reject staging, and surfaced complete paged
inventory/gating in the library. These final changes still require the new
clean exact-head submission, fresh complete native/browser evidence, final cold
proof, full actual Daybreak charter and main publication. No checkbox or task
status is advanced on these development claims. F/G/H/C/D and T23/T24 remain open.
