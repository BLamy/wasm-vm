---
id: E6-T11d44
epic: 6
title: Execute original native S8 stencil state and clears
status: implemented
estimate: S
risk: high
priority: 525.027039000382
depends_on: [E6-T11d43]
capstone: false
---

## Boundary

One opt-in command/native execution boundary for original DSA stencil fields, SET_STENCIL_REF and full CLEAR stencil bit on qualified original20/126 combined depth-stencil images. Native two-sided draws qualify different compares/operations with common effective references/value masks/write masks; asymmetric active-S8 draws must fail before native draw in this layer and remain a separate ordered translation task. Original front-only state may have arbitrary inactive back fields because the pinned renderer installs front state on both faces. Preserve prior factories, compiler, storage, caps and production control bridge. No stencil-only storage, shadow sampler, additional target/layer or API authority. The full original asymmetrical stencil floor is not claimed. The frozen predecessor probe physically confirms all three WebGL2 active-S8 asymmetry restrictions and legal disabled/absent-S8 draws on M4 Metal.

## Acceptance

`make verify-E6-T11d44` must reconstruct original front/back DSA fields and references from the pinned full protocol/header/renderer sources. Preserve the original native rule: front-only enabled state applies to both faces; enabled back state installs both literal face records; both disabled states disable testing. Admit legal inactive fields without invented reset constraints; reject reserved bits, active alpha and invalid resource bindings before native draw. Admit finite inactive alpha references/functions without enabling alpha testing. Execute all eight compares and operations across fail/depth-fail/depth-pass, front/back geometry, saturated/wrapping boundary values, varied mask/reference values across runs, distinct face compares/operations and 20/126 packing. Full clear admits the original unsigned 32-bit field, masks it to S8 as GLES3.0.6 section4.2.3 (PDF201 / printed188) specifies, overrides masks and scissor, changes only requested planes/mips, then restores per-face state. The held full GLES3.0.6 section4.1.4 (PDF189 / printed177) requires absent stencil storage to act as always-pass with no modification, and section4.2.3 requires absent-S8 stencil clears to have no effect. Prove those original cases on a complete color/depth-only framebuffer; do not invent an active-stencil attachment requirement. Reconstruct outputs solely from original fields, input bytes and independently predicted native pixel coverage; preserve native depth, S8 and exact public padding. Uploaded depth normalization retains predecessor tolerance; GPU-written depth follows its held conversion interval.

Three varied lifetime schedules prove context/restoration, private mip ranges, captured old generations after reuse, native refresh, clear-only completion, cancellation and disposal. Native error paths preserve ownership/budget closure. Preserve the authenticated D43 packed and floating depth storage/compiler/consumer boundaries; exercise their affected native regression paths, carrying their unchanged broader proofs only at exact identities. Distinguish physical consumed completion from disposal-only events. Actual completed native S8 sabotage behind a distinct consumed second fence must be detected. All finest new V8 partitions execute; only exactly pinned unchanged predecessor operands may be waived. Scoped gates, affected retained consumers and one frozen pristine clone establish full custody and complete reopened evidence. A fresh adversarial critic verifies original stencil semantics and one novel attack before status verified.

## Adversarial verification

Predict masked reference comparison direction, operation selection, wrap/saturation and merged write-mask result before opening evidence. Independently determine face/winding from original raster state and the held lower-left framebuffer convention. Attack front-only unified semantics and back-enabled literal separate semantics, all three active-S8 asymmetry preflight refusals, inactive unequal masks/references, disabled tests, unchanged depth fields, combined clear, no stale stencil attachment after switching depth-only formats and prior factory refusal. Authenticate every source/compiler/event/native/public body and actual writer-to-consumed-fence ordering; run three fresh schedules, one bounded novel original stencil attack and actual native second-fence sabotage. Promote a useful deterministic case. No second cold absent portability and no production completion claim.

## Verification log

### 2026-10-11 — worker — independently verified dependency and original stencil gap

D43 is independently verified at `5a0d9fc9655f1e0956154763bda420aec721865a` and published on existing PR521. Its fresh verifier explicitly released all Git/source and Node/compiler/browser/GPU leases. The full D43 worker and critic seals, original packed/floating storage and unchanged compiler authority carry only at exact authenticated identities. All 121 prior PRs preserve identity/order/heads/bases; native stack 500 is continued without recreating or merging a PR.

Exact predecessor reproduction:

```sh
node evidence/virgl-production-readiness/standard-stencil-consumer-gap.mjs
```

Complete adjacent negative JSON SHA256 `c97ec6894299fe104b6b6bb06bb206ebd490c5846b1ff2aca1692db98b1dcbd9` records ten original refusals: front-only, back-enabled/front-disabled, separate common-mask stencil, both-disabled nonzero fields, legal inactive alpha function/reference, and CLEAR buffers2/3/6/7. Seven unchanged original SET_STENCIL_REF /20/126 private-view and mip-surface packets admit. Whole runtime/primary/compiler identities are bound to the verified predecessor; no native guest draw executes in that negative recorder.

The complete `standard-stencil-native-precheck-report.json` at that same verified head is SHA256 `b81f657245df44451d4b09aaf661043e2b066dc0905f637fef9b8c1e5a97230f`. It preserves the complete actual source, native shader bodies, six full RGBA pixel arrays, consumed fences, headed Chrome GPU identity and screenshot. On M4 Metal, common references/value/write masks draw with NO_ERROR; each unequal active-S8 field fails with INVALID_OPERATION 1282; disabled/asymmetric and enabled/absent-S8 draw with NO_ERROR. Three expected WebGL warning messages and zero page errors are retained. This is an original host precheck only, not a guest or production claim.

The whole WebGL1 text is pinned at revision `eb040a77b1e1cde6b2ed11b120b83f4575c1f3e9`, SHA256 `0735f489eba0499ee55b860fe3cdad0a64cdc777679ab2ccf00db5b3c7c4c9d1`, alongside held whole WebGL2/GLES3.0.6 and original vrend sources. The WebGL restriction means arbitrary original asymmetric active-S8 draws require later ordered native translation; this task preflights that unsupported case. It does not forbid inactive unequal fields or missing-S8 semantics. The user's instruction continues this one S/high graphics boundary ahead of unrelated queue work. The selected factory is isolated from the demo; no production API/caps/guest/scanout/deployment or 300 MIPS authority follows.


### 2026-10-11 — worker — inner validation and scope before freezing

The selected renderer installs original comparisons, fail/zfail/zpass operations, masks and references on qualified native S8. A full clear sets the complete front/back write mask for the clear, restores literal original per-face masks afterwards and reinstalls front-only unified state before drawing. Original both-disabled unequal fields and finite inactive alpha fields execute. Original absent-S8 draws/clears execute without an invented attachment requirement. All prior factory admission remains closed. The unchanged compiler, storage, caps and production bridge remain outside this diff.

The additional exact predecessor wide-CLEAR recorder reconstructs only complete Git bodies at verified5a in an isolated temporary module tree. Its adjacent JSON holds all18 complete source bodies and four original COLOR0 CLEAR refusals for256,0x123456a5,0x80000001,0xffffffff. These original fields must mask to S8; the previous255 predicate was a qualification gap. Original 10-case gap and six-case native restriction probe remain unchanged. The native clear matrix exercises these wide values, complete scissor/mask override and a subsequent front-only draw with arbitrary inactive back masks.

Ephemeral inner runs exercised96 operation cases,32 comparisons,16 write masks,20 clears,4 inactive states,4 absent-S8 cases,18 native/guard failures and8 lifetime cases. A recording-registry defect in the first operation runs was corrected before the final recorded submission; those earlier runs only support the inner-loop native pixel observations. The independent original-field inverse passes the subsequent complete clear/comparison/mask/inactive/absence/failure/lifetime bodies. It rejects four real native controls (operation, value-mask, completed output and completed S8). Completed S8 corruption is an actual stencil clear behind a distinct physically consumed second fence. The first refusal harness accidentally counted drawBuffers as a draw; actual original trace inspection showed no draw/copy and the predicate now names only native draw calls and blits. The retained historical wire enumeration treated the newly introduced future factory as historical; the wrapper now runs the current complete wire admission matrix separately and preserves the unchanged retained native actors. Both failed inner recordings remain in target/evidence.

Retained packed surfaces and floating samples/surfaces pass their unchanged independent inverses. Complete predecessor reopening authenticates74113 logical D43 worker/critic bodies. Preview finest V8 coverage has245 executed partitions and four exact unchanged lower factory operands, zero new gaps; final exact-head coverage remains required. These observations are preparation, not the frozen submission or a verifier verdict. All GPU jobs are closed before this freeze.

### 2026-10-11 — worker — frozen recorded submission

Runtime/source freeze `de736cd109a092b59c82a83dd9520ee5928b8c2a` contains the two changed runtime modules, full recurring harness/inverse/custody scripts and explicit host-selected factory. Exact commands:

```sh
EMCC=/Users/blamy/.cache/wasm-vm/emsdk/4.0.22/wasm-vm-emcc VIRGL_STENCIL_EVIDENCE_DIR=target/evidence/virgl-standard-stencil-frozen-de make verify-E6-T11d44
python3 tools/virgl-stencil/cold.py --output target/evidence/virgl-standard-stencil-cold-de
python3 tools/virgl-stencil/seal.py target/evidence/virgl-standard-stencil-frozen-de target/evidence/virgl-standard-stencil-cold-de evidence/virgl-stencil/worker
```

Both complete commands pass at the same exact frozen head. The pristine clone `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-stencil-cold-cgm5x3i_/wasm-vm` has empty before/after Git status and scrubbed runtime/compiler environment. Hot receipt SHA256 `f91bfe2d9b9216a287bd7e5c393e046a1419cfbe974fc8aeae1b7b6f22d4bd8a`; cold receipt `ae6cfce6fecc7c902a8a75c635d21ee27fa3f7f9efc229cef1c595255056c033`; complete cold report `07431ec30af71c0bc20b5b43da6d6e822c667fdac4dc1aa9dc341a4f9b149d80`. Each receipt authenticates20,775 full recorded files and985 complete source identities. Each run rebuilds/qualifies the unchanged actual compiler, reopens all74,113 exact D43 worker/critic logical bodies and exercises affected retained packed/floating native consumers. No unchanged full-domain regression wall is needlessly repeated.

Each hot/cold acceptance covers214 original stencil cases and202 observed native/public frames:96 operation cases across8 operations/3 failure paths/2 faces/2 formats,32 comparison cases,16 mask cases,20 full clear cases (17 wide32-bit fields),4 legal inactive-field cases,4 absent-S8 cases,18 native/guard failures and three varied8-case lifetime schedules. The original-field inverse validates1,066,896 color words,716,924 depth pixels,694,644 S8 pixels and42,114,404 public/padding bytes per acceptance. It recognizes3,146 consumed physical syncs and12 disposal-only syncs and additionally checks626 blit writers against CPU collection fences. All256 original S8 inputs occur. Complete original TGSI, actual compiler responses, preceding delivered shaderSource calls and actual queried draw programs are held together. Full clears override scissor/masks, restore literal per-face masks, and then a front-only post-clear draw reinstalls unified state. Private nonzero mip copies, old GPU generations after name reuse, opposite-format replacement bytes, queued S8 clears and all four lifetime terminals are recorded.

Four real native controls fail as intended and are refuted by the independent original-field inverse: wrong operation, zero value mask, completed output corruption and completed S8 corruption. The last two occur after original completion behind a distinct second physically consumed WebGLSync; completed S8 uses an actual stencil clear, not patched expected data. All positive browser console/page/request error lists are empty. Finest governing nested V8 coverage is245 executed partitions plus four exact5a unchanged lower-profile operands, zero new runtime gaps, in both hot and cold. Full regions/counters/source bodies remain authority.

Complete seal `evidence/virgl-stencil/worker/recording.tar.gz` is42,370,970 bytes / SHA256 `46beab4bf23c06c2b8f826e41db8b0969cfd380b2a9bdcf750a4cc12322a848c`. Full index `records.json` SHA256 `e590aee23a07f06a68542a118dea90eb9823d31a3669dbfad17294566c8f9271`; manifest SHA256 `386cdb8880bcf72d20a9bf5d6c2bb1eef58023da64974448b42ef7edab445055`. Sealing reopens every42,535 complete logical member, checks each length and digest and requires every hardlink to name an earlier complete physical body. Logical byte count is 1817189091. These records demonstrate the opt-in original native stencil boundary only. Active asymmetric S8 translation, complete production API/caps, guest Mesa/compositor, worker/scanout/demo/deployment and300 MIPS remain unproven. A fresh critic must attack the claim and changed code before verified status. Existing upper native stack500 is continued; its72 earlier published PRs preserve all IDs/order/heads/bases and are open/unmerged.
