---
id: E9-T22i
epic: 9
title: Commit long exact histories with bounded durable witness pages
priority: 524.9220215
status: verified
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

- [x] Persist, reopen and independently authenticate a complete ordered commitment with at least 130 actual native state witnesses using bounded resident pages, exact initial/final bindings and no global witness-byte array.
- [x] Preserve the existing manifest/extension/session/retention limits, native replay-plan limits and v1 semantics. Bind count/order/positions/digests/page references to the immutable initial state and final endpoint; no constants-only increase or omitted checkpoint witness.
- [x] Reject missing/reordered/duplicated/corrupt pages, conflicting content lengths, wrong endpoints, stale publication and partial quota failure before publication/restore. GC/export/import inventory must include the complete page closure; older recordings remain intact.
- [x] Complete the scoped high-risk local native/Wasm/browser gate, visible demo/main release and final pristine proof; obtain a NEW actual Daybreak critic covering every changed boundary, all attacks, one novel attack and meaningful sabotage.

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


### 2026-10-23 — worker — respond to actual Daybreak preflight P4/P5

Fresh actual Daybreak read-only preflight of frozen source
`ea33370c877ebe1c76e75e5b1c66db184351caa2` completed as the requested/returned
`gpt-daybreak-blue-latest`, `daybreakBlue`, no errors or fallback. Report
`target/evidence/e9-t22i-daybreak-preflight/final-message.md`, SHA-256
`42bcea37aa3d88d1c66c583216ee9fbbd867a96b91c08ecd3b2b29ea176ccc7f`;
routing SHA-256 `ef08de415df760aa714495103b5bb5eb638af56e616e00dce6bd944bb7cdb5b9`.
P2 canonical codec, P3 exact prefix/terminal state and P7 archive/UI separation
held at source. P4 needed an exercised out-of-line event payload in the shared
paged graph. P5 refuted the worker's partial-final-tail claim: the retained
tail had 16 rows, not a partial page. All runtime/cold/full-charter/main proof
was explicitly still outstanding; this was not a terminal task verdict.

Primary submission 1 was interrupted deliberately in its GPU regression,
before the remaining demo/wall, to address those findings. Parent report
`target/evidence/e9-t22i-final-submission-1/report.json`, SHA-256
`5bf157fc10ad5e685da9757f8c7acf4baabd1a6d59547df8616553a67912dff0`,
is FAILED with `KeyboardInterrupt()` and stays failed. The exact owned process
and rationale are in `target/evidence/e9-t22i-primary-1-interruption-request.json`.
It is not a passing submission. Its complete native/browser child DID pass
at the frozen source: 130 actual native states, 67 keyframes, 70 pages, real
v1 archive control, 36 bounded controls, physical store retention and independent
RAM/page decoding. Child report SHA-256
`d82925840c0cd70d9ce90301207864044d8154d61fb41c723d75f90fc900cb67`;
literal oracle SHA-256
`44ffc681e325a8094520617c14a850e5df33a90332af5274a433a0db7962c77a`.
That run still has a full final page and cannot support the partial-tail claim.

The proof fixture now takes the special final keyframe at input 125 instead of
129. Inputs, 128-transition execution slices, total 130 native witnesses, more
than 63 native checkpoints, original guest/assets and every production bound
are unchanged. The last four genuine native witnesses now require finalization
of a partial page after the last checkpoint; browser and literal-byte oracles
explicitly assert a final tail of 1–15 rows. This changes only the small storage
proof workload, not any original C/D qualification workload or budget.

A labelled storage-representation fixture moves the identical byte `a` of one
genuine recorded inline event into a content-addressed blob. It is not another
guest execution or a physical GPU-result claim. Missing body prevents publication;
corruption prevents open and the entire GC sweep; complete body participates in
the shared inventory and survives storage export/import and destination cleanup.
The literal oracle independently compares every event field and its original
inline byte, body hash/length, and the exact archive inventory.

`target/evidence/e9-t22i-development-blob-followup-2/report.json` passed 40
bounded storage controls by reusing the completed EA333 history; it did not
execute the changed 125/129 schedule. The earlier blob followup 1 failed only
because that ad-hoc server did not permit binary evidence uploads; it remains
failed. Permanent capture accepts the explicitly bounded binary mutant paths.
No runtime codec, store, archive, native VM or replay semantics changed in this
response. New clean-head submission, full fresh native/browser evidence, final
cold, full actual Daybreak charter and main release are still required.

Native draft PR #609 is pushed and attached, based on open draft PR #608; all
32 stacked PRs remain OPEN/draft, unmerged/unqueued. Fresh Actions permissions
are `enabled:false`. The historical tracked perf-regression workflow from
`cd0366a5a` is unchanged; no workflow was added or re-enabled.


### 2026-10-23 — worker — Daybreak refutes locale-dependent archive ordering

Fresh actual Daybreak supplemental audit independently reproduced a real current
source contradiction at `ce8debcf583dfaac4cbe617303d1d6f258382bda`. Chrome
`en-US` inspects/imports the immutable 130-state archive; the valid default
locale `en-US-u-kn-true` resolves `numeric:true`, changes SHA inventory order
and causes both real inspect/import APIs to reject the same byte-valid archive
at `session-witness-archives.js:64` with `BundleMissing`. No metadata or payload
is published. A bounded independent recheck reproduced it. The canonical
header requires lexical byte order, so the two locale-sensitive archive sorts
contradicted the existing canonical contract. This is inside task acceptance.

Audit `target/evidence/e9-t22i-daybreak-locale-audit/report.json`, SHA-256
`e01d3c0d9c818133f636bc04cfb57eb41566c3c0f443323948faebd242181201`;
recheck SHA `20b297f06ec83b563d2cb18f4abdeb5cc0543a243746f0b082eed00e4dd8fc88`.
Routing is completed actual requested/returned `gpt-daybreak-blue-latest`,
`daybreakBlue`, no fallback/errors. The archive remains 4074751 bytes, SHA
`51930e114a7992dcbc4d07be1e604e9c801a9426b4bec3cbcf27762b6e56a281`.
This finding is refuted and must be repaired; the task stays in-progress.
The earlier full charter's unchanged HELD predictions are preserved, but its
source-level archive claim cannot overrule this concrete browser contradiction.

Replace only the two archive SHA sorts with strict lexical comparison. The new
permanent `e9-witness-archive-locales.mjs` calls production inspect/import/export
in fresh ordinary and genuinely numeric-collation Chrome contexts, proves the
real SHA orders differ, and demands identical original/re-exported archive
bytes, complete 130-state bindings and one exact manifest publication in each.
It is part of the normal recorded browser acceptance, with both context traces.
The new regression is a storage API run over authenticated recorded native
evidence; it does not fabricate another guest execution or broaden C/D scope.

The new regression first failed on unchanged ce8 with the numeric-locale
BundleMissing (`target/evidence/e9-t22i-locale-fix-baseline-1/report.json`);
that intentional negative stays failed. The in-memory proposed-source overlay
then passed that direct check before repository edits (`target/evidence/e9-t22i-locale-fix-overlay-1/report.json`); this is only
development self-validation. Native Rust/Wasm, storage/page/graph/identity and
replay code are unchanged by the fix. The frozen ce8 primary/cold were allowed
to seal before source edits. Preserve them as ce8 results, never relabel them
as post-fix exact-head acceptance. New frozen source, affected archive proof
and final exact-head pristine evidence must close this portability finding
before deployment, along with a fresh actual Daybreak incremental review.


### 2026-10-23 — worker — frozen final incremental submission

Frozen repaired source: `3e8ebe0712343640efe68216948460cfbca5abbb`.
The ce8 complete native/page/store/legacy/GPU/demo submission and its prescribed
local wall are now SEALED PASSED, as is its source-complete pristine clone.
Raw `make ci` still exits 2 only on the five documented historical alternate
`zicsr-stub` dead-code diagnostics; its exact narrow Clippy waiver passes, and
the remaining native/Wasm/features/RISC-V/determinism/perf-smoke wall passes.
Production Clippy remains strict. Never call unqualified raw make-ci a pass.

The runtime repair changes only the two browser archive SHA comparators.
The new independent locale counterexample is repaired by strict lexical sort;
no Rust/native VM, Wasm metadata, page/graph/store, replay or renderer behavior
changes. New permanent real-API regression is integrated into normal recording
acceptance and has a standalone archive-only command. The worker development
negative remains failed as intended; the real repaired source and in-memory
proposal both pass. These are not relabelled as pristine evidence.

Final exact-head pristine command:
`python3 -B target/evidence/e9-t22i-locale-cold-proof.py --output target/evidence/e9-t22i-locale-cold-submission-1 --clone /Users/blamy/Documents/Codex/.e9-t22i-locale-cold-3e8ebe071`.
It uses no-hardlink source-complete sparse clone, scrubbed Rust/CARGO environment,
fresh npm dependencies and no prebuilt target. It rebuilds actual browser/Wasm
artifacts, requires every served/runtime byte to equal committed dist and every
unchanged native dependency to match the genuine ce8 recording, and runs the
real production inspect/import/export/reinspect APIs in fresh ordinary and
numeric-collation Chrome contexts. Both contexts inspect all 130 states and
335 objects, publish one exact manifest and export identical original bytes.
The actual SHA order differs under numeric collation, so this is an exercised
regression. The original native archive remains immutable.

The pristine check intentionally reuses the authenticated genuine ce8 native
recording for archive transfer. It does not claim a new guest execution or
installed-runtime admission. Native/page/graph/Rust wall evidence is carried
only through exact unchanged code/dependency/runtime/evidence identities, per
incremental re-verification; all changed archive behavior executes anew.
The unchanged full ce8 cold browser proof remains 127/0, 130 actual native
states, 67 native keyframes, 71 pages, final four-row page, max resident 16,
zero unexpected errors and mobile width/scroll 388/388. Full original Alpine/
Omarchy/workload/performance and replay continuation are not claimed here.

Sealed reports (paths beneath `target/evidence/`):

- `e9-t22i-final-submission-2/report.json`, SHA-256 `f26a3facd6985618d077ac8f8104e000944ed6ca6574eb0e91421425320e0611`.

- `e9-t22i-final-submission-2/gauntlet/report.json`, SHA-256 `c0672b3be7b863f6af64b2674f011dce42a21d9da27e014a2f30427f2be9502d`.

- `e9-t22i-cold-submission-1/report.json`, SHA-256 `3e78fca08b2d7f0c0ad3f61bf5bd74867846e21e8a87f2909fd6b0c9c66e9a1b`.

- `e9-t22i-locale-cold-submission-1/report.json`, SHA-256 `2219c40625f25d339acd4e6ea27b9f7ce6748bb4757a905aa3a33c108f13e779`.

- `e9-t22i-locale-cold-submission-1/locales/report.json`, SHA-256 `d18df573a65756a44da09dfd1a9b8244a61cf03b046432d0520e69f6189a27b6`.

All current local worker gates pass; NEW actual Daybreak must independently
authenticate the incremental carry, attack the fixed locale boundary, inspect
the permanent regression and adjudicate sufficiency. Prior full-charter HELD
novel/semantic-sabotage/coverage results can be carried only where their source
and evidence identities stay exact. Main still serves the older E release;
publication and final independent public-path review remain required.
Only the worker status becomes implemented here; the worker cannot verify it.


### 2026-10-23 — actual Daybreak verifier — VERDICT: needs-evidence

- P1 sealed inputs — HELD. All fourteen supplied report digests matched exactly.
  The ce8 implementation diff rehashed to `9678ff88eb72cf086de1e5d72760a29c0ef35d9569b4c27afac3ac3f58f319c1`;
  the repaired locale delta rehashed to
  `0009df7d8bdb34fadf6e5e1beaedc7c9e076d22fb4e426d094406b8fbbf4a594`.

- P2 incremental carry — HELD. The prior full-charter strict-schema novel attack,
  meaningful `finished:false` semantic sabotage, authentication/old-reader
  refusal and 55-file ledger remain held only for their unchanged source and
  evidence identities. Forty-seven untouched files carry directly; the eight
  touched ce8 files and two new helper files were reclassified in the new
  coverage ledger. The sealed primary wall and pristine cold reports are now
  passed. Raw `make ci` remains exit 2, not a pass, on exactly the five historical
  quarantined `zicsr-stub` dead-code diagnostics; the exact narrow waiver and
  remaining wall passed.

- P3 numeric-locale repair — HELD. Independent current-head Chrome 155 resolved
  `en-US-u-kn-true` with `numeric:true` and a real inventory divergence at index
  zero. Production inspect/import/export/reinspect passed in ordinary and numeric
  contexts with 130 witnesses, 335 archive objects, one exact published session,
  zero console/external errors and identical 4,074,751-byte archive SHA-256
  `51930e114a7992dcbc4d07be1e604e9c801a9426b4bec3cbcf27762b6e56a281`.
  Citation: `target/evidence/e9-t22i-daybreak-gate-closure/independent-locale/report.json`,
  SHA-256 `03c12af1ce8cec332b4522e95fd2172b2c89042e16cda50dd840c933ae56162e`.

- P4 meaningful counterfactual — HELD. Fixed baseline passed; an evidence-local
  served overlay replacing both strict lexical comparators with the exact ce8
  `localeCompare` source failed at `session-witness-archives.js:64` with
  `BundleMissing: missing or unreferenced archive object`, before any publication
  and not at envelope checksum/digest validation; exact fixed restoration passed.
  Original archive bytes stayed immutable. Citation:
  `target/evidence/e9-t22i-daybreak-gate-closure/counterfactual-2/report.json`,
  SHA-256 `19cab2dbfe5cd7f65ea2ad6e106024991bc6d30f7f80d93a62aab17ac4cbe579`.
  The retained first harness attempt failed only its evidence-local database
  namespace before the archive API and is not counted.

- P5 repaired pristine boundary — HELD. The `3e8ebe071...` clone used
  `--no-hardlinks`, the source-complete sparse projection, scrubbed Rust/CARGO
  environment, no initial target/node_modules and a fresh browser/Wasm build.
  All 18 runtime source/dist pairs rehashed; only the corrected archive module
  differs from ce8. The immutable ce8 archive is explicitly reused as old native
  recording input, not relabelled as new guest execution or installed-runtime
  admission. Locale-cold parent SHA-256
  `2219c40625f25d339acd4e6ea27b9f7ce6748bb4757a905aa3a33c108f13e779`;
  locale child SHA-256
  `d18df573a65756a44da09dfd1a9b8244a61cf03b046432d0520e69f6189a27b6`.

- COVERAGE — HELD locally. Both comparator hunks and both new helper files
  executed. The main acceptance route/copy/invoke and runner syntax-list deltas
  are narrow harness glue/config covered by the direct real-API proof; generated
  service-worker/task mirrors are waived by byte identity/build provenance.
  No behavioral product hunk is unexecuted. Coverage SHA-256
  `0397913d79109ae58b753cf7d7a4b6be3b1753b9d00e76219a9282507676d94f`.

- PUBLICATION — NEEDS EVIDENCE. Main remains older release
  `13ba6e20e79dce8c1d4fa800c7950629f0c28ceb` / deployment `9eb734fc`.
  PR #609 and all 32 stacked PRs remain open, draft, unmerged and unqueued;
  Actions remains disabled. Publish only through a separately authorized main
  workflow, then obtain the final fresh Daybreak public-path proof. This task is
  not verified before that evidence exists.

Local criteria 1–3 are accepted; criterion 4 remains unchecked solely for main
publication and final public proof. Report
`target/evidence/e9-t22i-daybreak-gate-closure/report.json`, SHA-256
`15cf6d5144db2f39d3f4fdd15ddf7782126693b267838e2db45634a57a00e16a`;
routing SHA-256
`50482dc2555d54fbf4865f6abbf045e35d6f320727eaa8e611fbdf7aa9cc9def`.

Commands: sealed `shasum -a 256` authentication; bounded source/diff/hash
inspection; `node tools/verify/e9-witness-archive-locales-browser.mjs --archive
target/evidence/e9-t22i-final-submission-2/witnesses/witness-storage.wvsession
--source-report target/evidence/e9-t22i-final-submission-2/witnesses/report.json
--output target/evidence/e9-t22i-daybreak-gate-closure/independent-locale`;
`node target/evidence/e9-t22i-daybreak-gate-closure/counterfactual.mjs`.
SUITE: retain the existing permanent Rust/browser/oracle tests; no code fix or
new promotion was required.


### 2026-10-23 — actual Daybreak final-publication verifier — VERDICT: verified

- P1 source/publication identity — HELD. Accepted behavioral source
  `3e8ebe0712343640efe68216948460cfbca5abbb`, release
  `278e0bcb65481ccbccb85617b33514a7371da04e` and deployment `c19a6ac8`
  authenticate exactly. The release delta SHA-256 is
  `07b7cdcf5b89f446ca3df7f184a57203810a919caa36acdad0311125990fa586`
  and changes only task/queue metadata, declarative roadmap status, generated
  task mirrors and the generated service-worker cache revision; the scoped
  critical runtime diff is empty.

- P2 sealed publication/reference closure — HELD. All 12 sealed inputs and all
  27 receipt-referenced worker reports, sources and manifest sidecars matched.
  Independent main-origin GETs authenticated 24 selected bodies covering the
  corrected archive, page, graph, store, UI, main, roadmap, task JSON, service
  worker, VM, metadata, GPU stamp and AI/RV-Phone/DST marketing paths. Five
  canonical `.html` requests returned 308 to the expected extensionless routes;
  every destination body matched. Seven exact R2 `HEAD`s returned 200 with the
  declared lengths; no body SHA is inferred from `HEAD`.

- P3 public native/storage bindings — HELD. Recorded main trace SHA-256
  `c387a48d40b8404f4f9d25479b7c09b6cd9571c0515a2d17be6a412d265b24bd`
  contains one completed public probe and 127/0 suite result. Its exact initial,
  final and complete page commitment structures equal the authenticated primary
  and cold evidence: 130 actual native states, 129 inputs, 67 checkpoints, 71
  pages, a four-row tail and maximum resident 16. Commitment-structure SHA-256
  is `ee00faaa92e30c98563a49a65dab7ecd4ffa0aa03bc391c44199df63a980c7c9`.
  The 334-object referenced inventory, 335-object storage-only archive, all-page
  import and complete GC held; playback remains explicitly unavailable.

- P4 visible behavior — HELD. The trace has no failed calls or page errors and
  exactly the waived favicon 404 as its sole error console entry. Library and
  timeline open controls are disabled/storage-only, both witness pips are live,
  and the independently inspected desktop/mobile captures are readable and
  truthful with mobile width/scroll 388/388.

- P5 incremental local carry — HELD. Local closure report SHA-256
  `15cf6d5144db2f39d3f4fdd15ddf7782126693b267838e2db45634a57a00e16a`
  remains source/dependency/evidence-identical: full strict-schema novel attack,
  coherent terminal `finished:false` sabotage, old-reader refusal, 55-hunk
  coverage, native/oracle/page/graph/archive/GPU/store and pristine locale
  results carry unchanged. Raw `make ci` remains exit 2 solely on the five
  historical quarantined diagnostics; only the exact waiver and remaining wall
  are passes.

- ROUTING PATH ERRATUM — HELD. The earlier cited
  `50482dc2555d54fbf4865f6abbf045e35d6f320727eaa8e611fbdf7aa9cc9def`
  authenticates `critic-route-summary.json`; actual completed model receipt
  `routing.json` is
  `6a903541b7224e858fb306362edd45bf7d11736ff7e4e378591c1af6c133e8ae`,
  requested/returned `gpt-daybreak-blue-latest` / `daybreakBlue`, errors `[]`,
  `turnError: null`. This is only a path-label correction.

- COVERAGE/SCOPE — HELD. Release-only roadmap/task/cache hunks were directly
  checked or waived as generated/declarative; no behavioral product hunk is
  unexecuted. This verifies bounded durable storage only. F/G/H/C/D, T23/T24,
  installed-runtime admission, whole-history replay, full Linux/Omarchy and
  performance remain unclaimed. PR #609 is OPEN/draft without auto-merge; all
  32 recorded stack PRs are OPEN, unmerged and unqueued; Actions is disabled.

All four acceptance criteria hold. Final report
`target/evidence/e9-t22i-daybreak-final-publication/report.json`, SHA-256
`7c9d17325054ffb5ec34975f3e3f0d791a3e690fae16b0d982ed154c425fa8d6`;
Markdown report SHA-256
`30fcaa8da637acfe9bcd6b5c94da9816d522ed9ce392cad52739f18a954586d8`.
SUITE: retain the existing permanent Rust/browser/oracle tests and labelled
failed/development evidence; no new promotion was required.
