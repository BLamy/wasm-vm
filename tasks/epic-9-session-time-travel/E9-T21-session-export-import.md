---
id: E9-T21
epic: 9
title: Export and import complete bounded local session bundles
priority: 524.921
status: verified
depends_on: [E9-T07, E9-T16, E9-T18c]
estimate: S
risk: high
capstone: false
---

## Goal

Let users back up and move a recorded session with its required content and compatibility identity.

## Boundary

An explicit user-invoked local bundle format; include manifest, log, reachable keyframes, historical disk references and pinned runtime/assets needed by the declared portability policy. Cloud sync is not included.

## Acceptance criteria

- [x] Export/import into a fresh browser profile and replay using declared bundled or retained assets, without relying on the exporter's caches.
- [x] Verify digests, section limits, duplicate entries, required versions and total decompressed size before publishing imported state; reject incompatible sessions non-destructively.
- [x] Document that recordings contain guest data and input/network payloads; provide explicit export/delete controls and no automatic upload.

## Deterministic acceptance

`make verify-E9-T21` runs the clean-head local build, strict affected-crate checks,
format/witness tests, built demo, real Linux file and physical-GPU recordings,
fresh-profile file export/import, independent archive/native byte readers, and
the prescribed local wall. Evidence is written beneath
`E9_BUNDLE_EVIDENCE_DIR` (or the target's default directory).

The final portability command is
`python3 -B tools/verify/e9-bundles.py --output OUTPUT --cold-clone CLONE_DIRECTORY`.
It checks the same frozen revision with fresh native/wasm/npm build directories;
the broad wall runs once in the primary submission. These commands are proof
requirements, not a verification claim until their final reports pass.

## Portability policy

Archive v1 admits finished exact software (256 MiB ICount/10) and exact GPU
(1 GiB pure ICount/64) recordings matching the installed app/VM/renderer build.
It retains the complete selected manifest closure, including recorded I/O,
kernel, Wasm, renderer identity, base metadata, native owned device/COW state,
full keyframes and RAM-delta ancestors/pages. The current exact profiles require
an empty separate historical base-binding root; foreign legacy overlays are
rejected. Matching installed host JavaScript remains required; this file is not
a standalone website or a migration between runtime builds. Replay does not
re-fetch the original guest asset URLs. GPU import separately qualifies the
actual host against the saved profile.

## Adversarial verification

Import truncated, foreign-build, path-traversal, duplicate and decompression-bomb bundles. An import failure must not alter another local session or write outside its store.

## Verification log

### 2026-10-21 — worker — begin complete local bundles

Selected the next eligible task after Daybreak verified E9-T20 and its actual
main-site publication (runtime verdict `ea24a76b6`, release `292d7488f`,
publication verdict `c72ebf38a`, deployment `6f9b8388`). Native PR602 remains
open and unmerged; its source was pushed before this new stack layer.

Risk is high because import accepts untrusted persisted data. This S slice owns
one boundary: an explicit bounded local archive, complete transitive referenced
content, strict version/digest/size/duplicate/compatibility validation before
publication, and visible local export/import/delete/privacy controls. The
portability policy must specify the matching app/runtime requirements, and a
fresh profile must not depend on the exporter's caches. Compression and path
extraction are not needed for a complete bounded archive. Existing machine,
network and replay semantics remain the accepted boundaries; no claim of new
desktop qualification follows from an archive transfer.

Implementation and final deterministic acceptance, exact-head high-risk and
pristine-clone proofs, adversarial import attacks and a fresh Daybreak verdict
remain required. No implementation or verification result is claimed at
activation.

### 2026-10-21 — worker — implementation and development repair ledger

Added the bounded uncompressed `WVBUND01` format and visible local export,
file import, cancellation and delete controls. Every object is authenticated,
the exact transitive closure is checked, and every full/reconstructed native
keyframe is decoded in a private non-running candidate before obtaining a
destination writer. One authorized final manifest transaction publishes a
playable row. Duplicate IDs are conflicts; storage/cancellation failures cannot
replace another row. Conservative GC now understands only the two existing
reference-free exact witness extensions and refuses unknown/malformed metadata.

Fresh actual Daybreak preaudit
`target/evidence/e9-t21-daybreak-preaudit/final-message.md` identified two gaps:
later native/RAM states needed real decoder admission, and the transfer token
had to survive its asynchronous post-commit refresh. Both were repaired. Its
bounded static follow-up
`target/evidence/e9-t21-daybreak-repair-review/final-message.md` found those
repairs sound, retaining unchanged boundary results; it explicitly did not
issue the final task verdict or inspect development recordings.

Development recordings and failed harness attempts remain beneath
`target/evidence/e9-t21-development/`. The four-case `bundles-6` run passed
fresh-profile software parent/child, incremental Linux and hardware-GPU imports,
raw native-byte equality, fresh-ID malformed input refusals with zero writer
calls, no guest run/step/resume during transfer, real quota failure after a
unique object became durable, orphan GC, final-publication cancellation and
post-commit list/close barriers. A genuine mixed full/incremental Linux fixture
and the proposed deeper GPU preview-close barrier strengthen the frozen proof.
No desktop performance or full desktop integration claim follows from the
bounded physical-GPU fixture. Final exact-head high-risk, pristine-clone,
adversarial Daybreak and production-publication evidence remain outstanding.

The strengthened `bundles-7` development run passed all four cases, 57 malformed
imports with fresh IDs/zero destination-writer calls, genuine full/incremental
Linux state, staged-data quota cleanup, the deeper GPU `openSession` close
barrier, and a 390px layout screenshot with no horizontal overflow. Its browser
report SHA-256 is `9018d30b425c31450c8b2d1475c6ff80a01b74738a3edca87906c0022e8dae26`;
independent closure/native reader SHA-256 is
`50f96b055458dbba7082ef51fa452728b90ffb8c225bb27d7c8794c5880062d5`.
All imported native snapshots equal the independently retained originals. These
are development results; the following frozen submission remains authoritative.

### 2026-10-21 — worker — repair Daybreak's ambiguous-witness finding

The first exact-head submission at `9921bc071b51d564e393cea53cf67d3ab89a402c`
is superseded. Fresh actual Daybreak's novel browser attack admitted a known
witness containing a duplicate JSON member that shadowed a CAS-shaped value.
The import returned `done`, opened one destination writer and published its
row. Cleanup subsequently removed an unreachable byte despite the malformed
surviving witness. Source: `web/session-witnesses.js` parsed JSON before
checking the resulting keys, so duplicate members were silently collapsed.

Evidence: `target/evidence/e9-t21-daybreak-adversarial/novel-attack/report.json`,
SHA-256 `8bdd72a29262978c834446f1ffc32f3224a030a67098032bde35835ff4848ced`;
mutant archive SHA-256
`3fda47360a5c3205f91b3c124b7dbbbeb8675e87223b1f2939ace5610bb086ad`.
The trace, screenshot, independent byte-level attack script and prediction
ledger are retained beside that report. The whole primary/cold submissions
were deliberately stopped with `KeyboardInterrupt` and an explicit stop note
when this semantic gap became concrete; neither is a passing final proof.

Known witness v1 metadata now must round-trip exactly as canonical JSON before
its shape is trusted for import or GC. The new focused regression fails on the
original module and passes on the corrected module; all 12 focused tests pass.
Browser proof now includes coherently rehashed duplicate-witness archives
with unused IDs and zero writer calls, plus a persisted malformed survivor
and a real staged object: cleanup must refuse without deleting either, then
resume and reclaim the orphan after that survivor is explicitly removed.
The healthy recording remains byte-for-byte unchanged.

Daybreak's evidence stage ended at `2026-10-21T23:50:13.654Z` with
`cyberPolicy`, requiring Advanced Account Security enrollment and a compatible
physical FIDO2 key. Its completed novel finding is valid evidence, but the
stage did not complete the full charter or issue a final verdict. User input
has been requested for that account requirement. No alternative model is
authorized for independent verification; a fresh actual Daybreak verdict and
test-kill remain required after the corrected frozen high/cold submissions.


### 2026-10-21 — worker — completed local submission, final independent verdict pending

Product semantics are frozen at `efc7fe6d3f9edb1783a910249001450f867865f6`;
final direct proof head is `89277243c313117865969bae1000f4f554a9e954`. Their sole difference is the
one-line bounded GC fixture ID in `tools/verify/e9-bundle-browser.mjs`. No
runtime/dependency changed. Wasm remains
`d2bb362758e060f40351e57c7e52fa42b917a64017cdc2615d7f20d60a06bc2d`;
GPU graph is `5e50271a8fc4df404aa5ca2a31ed8ffbdf591fd27aac195f4005d03e9a080e17`
(74 files). All 14 rebuilt runtime hashes still match source, committed dist
and the independently cold-built app.

The frozen parent reports `target/evidence/e9-t21-frozen-2/report.json`
(SHA-256 `9ab5aa520853d10c862ed375e422bd7c959069aa49da055cd4592d2a241543f4`)
and `target/evidence/e9-t21-cold-final-2/report.json`
(`463cacf45fb8cb7c9d4d596033728f34a947f9e35807632ae84709f962b6d3da`)
remain **failed** whole commands at the obsolete overlong test fixture ID.
Their preceding 14 gates passed, plus cold clone/checkout: policy/fmt, strict
affected storage/Wasm Clippy, storage manifest/publication/disk tests, builds,
12 focused tests/docs, built 127/0 demo, real Linux/GPU source recordings and
independent file/counter readers, and permanent owned-input race. The cold
run began without target/node_modules and rebuilt with scrubbed environment.
The one-line harness correction triggered the missing browser proof directly;
AGENTS incremental policy carries unchanged build/runtime portions. No failed
report was rewritten and no result-reuse flag was added.

Commands run at clean `89277243c313117865969bae1000f4f554a9e954`:

- `node tools/verify/e9-bundle-browser.mjs --software target/evidence/e9-t21-frozen-2/software --gpu target/evidence/e9-t21-frozen-2/gpu --output target/evidence/e9-t21-browser-final-3`
- `node tools/verify/e9-bundle-browser.mjs --software target/evidence/e9-t21-cold-final-2/software --gpu target/evidence/e9-t21-cold-final-2/gpu --web-root /Users/blamy/Documents/Codex/.e9-t21-final-cold-efc7fe6d/web/dist --output target/evidence/e9-t21-cold-browser-final-3`
- `python3 -B tools/verify/e9-bundle-files.py --directory target/evidence/e9-t21-browser-final-3`
- `python3 -B tools/verify/e9-bundle-files.py --directory target/evidence/e9-t21-cold-browser-final-3`
- `python3 -B tools/verify/e9-local-gauntlet.py --task E9-T21 --output target/evidence/e9-t21-local-wall-final`

Both supplemental browser reports pass all four fresh-profile imports and
60 malformed-input refusals with zero destination writers. Imported native
bytes equal the independently retained originals, including mixed Linux
full/delta state and physical GPU results. Actual malformed-survivor GC
preserves all data until explicit deletion; real quota failure/orphan cleanup,
publication cancellation and UI close/refresh races pass. There is no
transfer-time guest execution, browser error, importer fixture access or
egress, and the 390px layout does not overflow.

Primary browser/reader report SHA-256:
`5c4ab92241afcb24f4a35b29a1fefd7c66af1a177acb2a8fcaf174a8cbbb91ce` /
`926943fae98bd1176d51266e3a6613d0d18edc64dd7c86f815b4ff260978d542`.
Cold-built browser/reader:
`1320659fc7f93c3f61a8f630da9b275befc0197c83aabc543699fa88b3a0eb56` /
`04cdd3a263a5bf92b9fcc3f5105bb0599d6a76df35e512ed69582a435378f349`.

The direct local wall is terminal **passed**, SHA-256 `efb01514ac65618e93970d2857e255326f5b2c093a8d0ad47859ccf817c9a0b8`.
`make ci` exited 2 only at the exact five historical quarantined zicsr-stub
`dead_code` diagnostics; production Clippy remained strict. The explicit
alternative-only waiver exited 0, then
`make test wasm features test-riscv riscv-tests-suite determinism perf-smoke`
exited 0. Native/wasm fingerprints match and perf-smoke measured 49.2 MIPS
against its existing floor 15; this is not the T22 recording/seek budget proof.
The finalized three-file wall catalogue rehashes correctly.

Actual fresh Daybreak evidence stage completed on the same code head through
`gpt-daybreak-blue-latest` / `daybreakBlue`, thread
`01a16137-a383-7270-b1ba-910926da4f6a`, with no service error. Report:
`target/evidence/e9-t21-daybreak-validation-retry-proof/report.json`, SHA-256
`1e397f05e79690f547bbbde3ee831a85288844d3e8164a5c6bd0b57c8b909e0d`.
It independently HELD P1-P13, including changed-hunk coverage, source/raw
artifact rehash, a novel exponent-spelling witness refusal and actual
scratch-only guard sabotage (baseline 3/3; mutant 2/3, targeted failure).
It explicitly withheld the final verdict pending P14, the then-running wall.

A single copied unit-test digest in that stage's JSON summary differs from
its own authenticated raw source audit: correct unchanged Git/file digest is
`9077a5b7628b3185fc43e53c7e023ca8e6d139ef968e6881a61ea2f0c2e2750e`.
`target/evidence/e9-t21-daybreak-summary-erratum.json` preserves the exact
mismatch without altering the independent report. The fresh final verifier
must reconcile it in its own verdict and rehash the completed wall catalogue.
No runtime repair or unrelated proof repetition follows from this reporting
issue.

Transparent worker index: `target/evidence/e9-t21-submission-index.json`,
SHA-256 `d513aa0af42e9afb48c18b79b518597510fdea3657e7dd6665bdf0543753262b`. This entry is the worker claim only.
Final fresh Daybreak verdict/status, release metadata, native open PR and
actual main-site deployment/publication proof remain outstanding. E9-T22,
E9-T23 and E9-T24 remain outside this task and are not claimed complete.

### 2026-10-22 — final Daybreak adversarial verifier

VERDICT: verified

- P1 frozen boundary — **HELD**. Worker HEAD
  `c332ea575b552e035466ef58b7c6dc9bca0b8a01` is a metadata-only child of proof
  head `89277243c313117865969bae1000f4f554a9e954`; the latter differs from runtime
  head `efc7fe6d3f9edb1783a910249001450f867865f6` by exactly the one-line bounded
  fixture-ID repair in `tools/verify/e9-bundle-browser.mjs`. Current semantic
  source hashes equal Git at the proof head; source/dist mirrors are byte-exact.
- P2 honest incremental parents — **HELD**. Primary/cold parent reports rehash to
  `9ab5aa520853d10c862ed375e422bd7c959069aa49da055cd4592d2a241543f4` /
  `463cacf45fb8cb7c9d4d596033728f34a947f9e35807632ae84709f962b6d3da`
  and remain terminal **failed** at the obsolete overlong SessionId. Their prior
  successful gates are carried; neither whole command is relabeled as passed.
- P3–P10 archive/runtime acceptance — **HELD (carried after digest and boundary
  reauthentication)**. Primary browser/reader reports rehash to
  `5c4ab92241afcb24f4a35b29a1fefd7c66af1a177acb2a8fcaf174a8cbbb91ce` /
  `926943fae98bd1176d51266e3a6613d0d18edc64dd7c86f815b4ff260978d542`;
  cold-built reports rehash to
  `1320659fc7f93c3f61a8f630da9b275befc0197c83aabc543699fa88b3a0eb56` /
  `04cdd3a263a5bf92b9fcc3f5105bb0599d6a76df35e512ed69582a435378f349`.
  Each has four actual fresh-profile transfers, 60 malformed fresh-ID refusals
  with zero writers, complete closure, source/imported native-byte equality,
  real Linux full/deltas and physical GPU state, no transfer execution/egress,
  exact 35-byte corrupt-survivor cleanup, quota/cancellation/race barriers,
  duplicate conflict, delete, and mobile-390 proof.
- P11 actual Daybreak route — **HELD**. Routing receipt SHA-256
  `97a77c06efff09cd164d93e265db6ab3c7682d6eb28517ff0144154db66c691e`
  is terminal completed without errors through `gpt-daybreak-blue-latest` /
  `daybreakBlue`, thread `01a16137-a383-7270-b1ba-910926da4f6a`.
  Independent evidence report SHA-256 is
  `1e397f05e79690f547bbbde3ee831a85288844d3e8164a5c6bd0b57c8b909e0d`.
- P12 novel attack and test kill — **HELD (carried)**. Exponent-form witness
  mutation at archive manifest offset 1097 / decoded offset 44 refuses before
  writer, blocks GC without deletion, and reclaims its 32-byte orphan only after
  explicit survivor deletion; report SHA-256
  `a7983716a7ab72345c7903d945e4ed99c065a90e0df2b1d54bf18145e726c8bc`.
  Scratch guard removal changes the focused test from 3/3 to 2/3 with the
  targeted missing-exception failure; sabotage report SHA-256
  `a1857a2d89ab2135597a0826acb18e56f56e681b9c2fde47b7178d602bab5ff6`.
- P13 coverage — **HELD**. Runtime/format/authentication, closure, every-keyframe
  decode, full/delta reconstruction, GPU qualification, manifest-last publish,
  quota/cancellation/UI ownership, canonical witness/GC and explicit controls
  are executed. Generated mirrors are digest-bound; docs/declarative metadata,
  Make/reporting glue are waived. No semantic hunk is unexecuted or dead.
- P14 final local wall — **HELD**. Terminal passed report at exact proof head
  rehashes to
  `efb01514ac65618e93970d2857e255326f5b2c093a8d0ad47859ccf817c9a0b8`.
  Strict production Clippy passes; strict zicsr-stub emits exactly the five
  quarantined dead-code diagnostics and no other diagnostic header. Its exact
  alternative-only waiver exits 0 and the remaining wall exits 0. All three log
  catalogue entries rehash exactly; determinism and 49.2 MIPS smoke floor hold.
- ERRATUM — **RECONCILED**. The preserved Daybreak summary's copied `...7628f...`
  witness-test digest is wrong. Raw audit, current bytes and Git at the proof head
  independently agree on
  `9077a5b7628b3185fc43e53c7e023ca8e6d139ef968e6881a61ea2f0c2e2750e`.
  No source changed; the original report remains untouched.
- COVERAGE — **SUFFICIENT**. Full executed/waived classification and citations are
  in `target/evidence/e9-t21-daybreak-final/report.md`, SHA-256
  `c1d9d960c3571e102edfe168accbb3e9ae93b236c08b4f64bb461ccacdc6f7ec`;
  prediction ledger SHA-256 is
  `d2deb87961c67875eb0ca0272a07f94be0b732d4ecaa3d654a995abb88ff7c30`.
- SUITE — **RETAIN EXISTING; NO NEW PROMOTION**. The committed canonical-witness
  test was independently killed, and format/browser/raw-reader/`verify-E9-T21`
  artifacts already retain the stable boundary. The numeric spelling corpus is
  retained as evidence because it exercises the same canonical-roundtrip
  invariant; promoting it would duplicate the existing assertion.

Commands: read-only Git/diff/source/report/raw-artifact inspection; source,
runtime, evidence and wall-catalogue SHA-256 rehashes; structured primary/cold
report interrogation; source/dist/Git/cold-Wasm comparisons; exact diagnostic
count; policy precheck. Incremental policy preserved unchanged cold/runtime and
Daybreak P1–P13 evidence; no broad wall, cold clone, browser boot, novel attack
or sabotage was repeated. Host rr/ssh remained waived.


### 2026-10-22 — worker — actual main-site release, publication verdict pending

Normal pre-commit build `5a7387d10` plus generated task-source alignment
produced clean release `62936461529446c8c2f3f17f8a0c2185ee9b45fd`.
Its only changes from the Daybreak verification commit are roadmap
source/dist status/evidence, generated task JSON source/dist and SW stamp.
Wasm and the 74-file GPU runtime identity remain unchanged.

`gh stack submit --auto` pushed the 26-branch native stack and opened
<https://github.com/BLamy/wasm-vm/pull/603>, based on the E9-T20 branch.
The PR is draft/open, auto-merge is null, and no PR was merged. Direct
GitHub Actions permission read remains `enabled: false`.
`bash tools/deploy-cloudflare.sh` validated the local artifacts and exact
public R2 objects, then deployed project `wasm-vm`, production branch
`main`, deployment `58cada9e`. The actual publication URL is
<https://wasm-vm.pages.dev/>. Five deployed manifest sidecars and the exact
log are retained; only the script's five tracked URL rewrites were restored.
The source checkout remains clean.

Direct release evidence:

- Built demo: `target/evidence/e9-t21-release-demo/report.json`, SHA-256 `67053948218588e1a4985e96adfb40d7b55d49213a714be11c02609ff1fa074a`.
- Actual main bytes: `target/evidence/e9-t21-release-public-assets/report.json`, SHA-256 `de8628ee288e16128ca69757caaaa99463b010cc14ae183b5d4c64e84dd2504a` — 109 exact assets, including all 74 runtime files, every changed deployable file and all three marketing cases.
- Actual main browser: `target/evidence/e9-t21-release-public-browser/report.json`, SHA-256 `70d0b3f75c46a1f1cf8d48c52cb60f21b46751b340a64af4463487198e90b9c5` — 127 passed, 0 failed, verified branch/bundle pips, zero non-favicon console/page/HTTP errors, screenshot and trace.
- Actual main transfers: `target/evidence/e9-t21-release-public-bundles-2/report.json`, SHA-256 `ab5b2b32be0bfc90fe5cab1913550dd99b53583dab954b2541fc4c2acdf19485` — four fresh-profile cases, 60 malformed refusals, source/imported native-byte equality, physical GPU results, GC/quota/cancellation and close/refresh races, no guest execution during transfer or replay egress.
- Independent archive/native reader: `target/evidence/e9-t21-release-public-bundles-2/independent-files.json`, SHA-256 `9c41b3672e0b176ba8b22321d84f56bf20ed04c9241586fb89fd8b478513eb9c`.

The first production transfer report remains **failed** at its final console
assertion. All semantic cases had completed, but each of eight profiles
logged the same main-origin `/favicon.ico` 404. The trace audit
`target/evidence/e9-t21-public-favicon-audit.json` cites all exact entries,
lines and digests. AGENTS explicitly permits a favicon 404. Harness-only
commit `b75a85058665edd249c0f6ed141ddedbbbfc72ab` now separately records only that exact URL plus 404
resource-message combination; every other console/page error remains fatal.
The independent reader rechecks each exception's URL and message. The new
production report passes with exactly eight allowed favicon records and
zero other errors. App/runtime/deployed bytes remain release `629364615`;
no product repair, redeployment, broad wall or cold-clone repeat was needed.

Deployment/worker proof receipt:
`target/evidence/e9-t21-production-release/receipt.json`, SHA-256
`a10327e4f1de279c76141dab5e865adcad8283e472f4bdffe9d9c3fa633cef3a`. These are worker publication claims; the fresh actual
Daybreak publication verdict is still required. E9-T22 through E9-T24 remain
outstanding and Epic 9 is not claimed complete.

### 2026-10-22 — fresh actual Daybreak publication verifier

VERDICT: verified

- P1 publication boundary — **HELD**. Clean launch head
  `7ef1f7eb25d0699f3f5aeb67d08b1703a5e669ed` is a task-log-only child of
  harness head `b75a85058665edd249c0f6ed141ddedbbbfc72ab`. Release
  `66d655d437fcb644a67f01dc5e9c23fe889edbeb..62936461529446c8c2f3f17f8a0c2185ee9b45fd`
  is exactly roadmap source/dist, generated tasks source/dist and the built SW
  stamp. The harness diff is exactly two evidence/reporting files. No VM,
  renderer, parser, importer, store or timeline runtime semantics changed.
- P2 deployment and public bytes — **HELD**. Receipt SHA-256
  `a10327e4f1de279c76141dab5e865adcad8283e472f4bdffe9d9c3fa633cef3a`
  and deploy log SHA-256
  `274d11d27f3e82ee69bb09b823b1a781237fb07bf192e76589f50e67f7e88f75`
  identify production deployment `58cada9e`, project `wasm-vm`, branch `main`,
  source `62936461529446c8c2f3f17f8a0c2185ee9b45fd` and actual
  <https://wasm-vm.pages.dev/>. Fresh main-host GETs matched Git/sidecars for
  the GPU graph stamp, Wasm, both bundle modules, witness/store/timeline,
  roadmap/tasks/app/SW, all five deployed manifests and all three marketing
  cases. Seven exact declared R2 URLs returned HEAD 200 with declared sizes.
- P3 direct results — **HELD**. Bound report SHA-256 values rehash exactly:
  local `67053948218588e1a4985e96adfb40d7b55d49213a714be11c02609ff1fa074a`,
  public assets `de8628ee288e16128ca69757caaaa99463b010cc14ae183b5d4c64e84dd2504a`,
  public browser `70d0b3f75c46a1f1cf8d48c52cb60f21b46751b340a64af4463487198e90b9c5`,
  corrected transfers `ab5b2b32be0bfc90fe5cab1913550dd99b53583dab954b2541fc4c2acdf19485`
  and independent reader
  `9c41b3672e0b176ba8b22321d84f56bf20ed04c9241586fb89fd8b478513eb9c`.
  Actual public demo is 127 passed / 0 failed with verified branch/bundle pips;
  transfer proof has four cases and 60 malformed refusals with zero other
  console/page/egress/blocked errors.
- P4 explicit favicon exception — **HELD**. Original report remains terminal
  **failed** at SHA-256
  `bb2f1335f214964fb0755762289d6e901e204d19a84ef8421c49ebb54a8ada05`.
  Audit SHA-256
  `2d1f69649d4516f7b151a5d109e68e9035f4c70720623f7c17edc39161fb7036`
  reopens eight traces; each contains exactly one console error at
  `https://wasm-vm.pages.dev/favicon.ico`, status 404, and no other console
  error. Direct GET independently returned 404. The corrected executed harness
  is byte-identical to Git at `b75a8505`; only the exact same-origin URL plus
  404 resource-message class is retained, every other console/page error stays
  fatal, and the independent reader rechecks each retained row. No failed result
  was relabeled.
- P5 carried high-risk boundary — **HELD**. Prior actual Daybreak report JSON /
  Markdown rehash to
  `ad67b9c6a3359a858bb3f63235aa809ec69ddd05a91231004a199b24c498c48e` /
  `c1d9d960c3571e102edfe168accbb3e9ae93b236c08b4f64bb461ccacdc6f7ec`.
  Wasm remains
  `d2bb362758e060f40351e57c7e52fa42b917a64017cdc2615d7f20d60a06bc2d`
  and the unchanged 74-file GPU graph remains
  `5e50271a8fc4df404aa5ca2a31ed8ffbdf591fd27aac195f4005d03e9a080e17`.
  The high-risk verdict at `66d655d437fcb644a67f01dc5e9c23fe889edbeb`
  is carried; no broad/cold/native/guest-boot/performance/novel/sabotage gate
  was repeated.
- P6 claim/governance discipline — **HELD**. Retained receipts say Actions are
  disabled and PR 603 was draft/open at release head with null auto-merge.
  Public/source content leaves T22/T23/T24 pending, RV-Phone in progress, and
  hosted Firecracker/deterministic-simulation integration explicitly proposed.
  No full-desktop, performance or Epic-9-complete claim is made.
- COVERAGE — **SUFFICIENT**. Five release files are exercised by exact local/public
  bytes and the browser proof; both harness files are exercised by the corrected
  transfer and reader reports; the launch child is declarative task metadata.
  No product/runtime hunk exists in this publication slice.
- SUITE — **RETAIN EXISTING; NO NEW PROMOTION**. Publication evidence report:
  `target/evidence/e9-t21-daybreak-publication/report.json`, SHA-256
  `d06d11b69dd97d9b8b0a712f81f0175052465c6dfa05f979618f7c497a6d6578`;
  Markdown SHA-256
  `a6313cd20a85f4f15e6fc3a0a13d8a23875056e25650fa945208cea34c1d1232`;
  frozen predictions SHA-256
  `409e6c9ba06f2df36264d07557307ca2e70f9513f8f78025e2c11235de843c77`.

Remaining Epic 9 work is unchanged: E9-T22 performance, E9-T23 recovery and
E9-T24 capstone.
