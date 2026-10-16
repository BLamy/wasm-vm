VERDICT: verified

Fresh critic for E6-T11d42. I did not implement this task. I read the task and the
runtime diff before opening evidence and saved falsifiable P1–P11 predictions in
`predictions-initial.md` (SHA256
`42bd4d1c7fcdfe1bd1e1137fcce73ffb09f5f957353edc97e0caaf41b640099d`).
The complete prediction/refinement journal is `predictions.md`. Citations below
use critic archive paths; `hot/`, `cold/`, `source/` and `*-generated/` name
members of the authenticated worker archive, not additional critic recordings.

The tested runtime is frozen worker source
`c9d745dca15c170d0dfc080d20d39e8696d436fc`, unchanged at submitted worker
`9c98ac25764b53756bd9a0878b8012848f9ed4eb` and final promoted harness head
`d3583d1f4574dfd9fc7a3b0bef0e3e544342cee1`. The only runtime changes from verified
D41 `c34b00e91f6e84501f0eff731a74857a10eb4250` are resources.mjs,
unorm-depth-images.mjs and floating-depth-gpu.mjs. I changed no implementation.

- **P1 custody/source — HELD.** Predicted exact full source and body custody.
  `audits/custody.json` reopens all37,947 D42 logical members and all41,650 D41
  worker/critic logical members in full, with every hardlink naming an earlier
  real body. D42 manifest SHA256
  `9ce4a68b38cc79e138dcda43b352e6cd6c579f3d92e9af03973d185199ceb9c9`,
  joined339,293,519-byte stream SHA256
  `e60573b012f80accdeb73f9e1a63d3408c080a8ad4746e68de72b7d373ad602f`,
  index SHA256
  `77ad969bd93459de71e673eacfa914f52d2d6d833ddb017f43059de30cbfac1d`.
  All915 full source members equal Git frozen blobs. `audits/fresh-source-audit.json`
  authenticates every fresh served/source/V8 body and actual compiler binary;
  all eight fresh captures use headed Chrome and real Apple Metal with no
  console/page/request errors. No custody correction is required.
- **P2 original identities/admissions — HELD.** Predicted original20 low S8/high
  UN24 and21 low UN24/high ignored X8, with no guest consumer admission.
  Whole `source/renderer/virgl-shader/vendor/src/virgl_hw.h:55` defines20 and:56
  defines21; Mesa `source/tools/virgl-floating-depth/primary/u_format.yaml:623`
  defines UP8/UN24 and:641 defines UN24/X8. Whole virglrenderer
  `source/tools/virgl-floating-depth-consumer/primary/vrend_formats.c:88` maps20
  to D24S8/U24_8 and:89 maps21 to D24/U32. `audits/independent-wire-regressions.json`
  inverts the original packet fields/opcodes/directions, all14 old owner and13
  old layout admissions, and all six original consumer refusals. D41 HELD
  consumer/old-factory results carry only across these unchanged sources and
  authenticated evidence. No expanded admission claim follows.
- **P3 full domains/exact public fields — HELD.** Predicted every original UN24
  n exactly once per format, actual sampled FLOAT at most1 ULP from independent
  binary32(n/16777215), and exact public/S8/X8/padding. Both
  `hot/hardware-domain/report.json` and `cold/hardware-domain/report.json` contain
  all128 bounded chunks and both16,777,216-value domains. Independent
  `audits/audit.py` regenerates all input/LE fields and21 native U32 encodings,
  opens all uploaded/native/public gzip bodies, and uses no runtime converter.
  `audits/independent-audit.json` records every body digest, native plane and
  public comparison; successful maximum ULP is1. The positive-domain public
  total alone is268,435,456 bytes per hot/cold. All canonical public fields and
  padding are exact;21 X8 is zero. No value correction is required.
- **P4 actual native diagnostics — HELD.** Predicted independent native depth
  and all256 S8 references, with no CPU image supplying the output. Whole
  `source/renderer/virgl-command/tests/standard-packed-depth-rig.mjs` supplies a
  direct native texelFetch depth-bit diagnostic, exact constant lanes and actual
  fixed-function EQUAL stencil extraction. `audits/independent-novel-sabotage.json`
  independently checks47,104 actual exhaustive stencil reference calls in each
  hot/cold32-case matrix. The large extra diagnostic is explicitly depth-only;
  the recorded native packing/readback S8 plane and all public S8 are still
  checked against every original field throughout both full domains. Matrix and
  fresh novel diagnostics exercise all256 S8 and ignored X8 values independently.
  That combined evidence is sufficient for this storage boundary.
- **P5 physical completion/ownership — HELD.** Predicted consumed native
  completion after the latest writer before every PBO CPU collection, separately
  counting synchronous driver returns. `audits/independent-audit.json` records
  per-collection sequence, latest writer and consumed sync IDs. Per positive
  hot/cold298 rows:1584 owned,1575 consumed,9 disposal-only fences;1128 fenced
  CPU collections and384 synchronous driver readPixels returns. Actual native
  status, not ownership or a delivered mock value, supports each successful
  completion. Full native registries delete every object once; terminal budgets
  are zero. Fresh novel and sabotage records obey the same audit. No completion
  correction is required.
- **P6 mip ranges/generations/lifetimes — HELD.** Predicted private NPOT remap,
  matching native copies after GPU-only clear, old-generation survival and no
  stale delivery. Fresh schedules at seeds0x73c19be5,0xd0846f21 and0x5e9a7c33
  each pass46 cases (`runs/d42-critic-schedule-*/report.json`). The novel capture
  `runs/d42-critic-novel-sealed/report.json` covers33×17 four-level original
  chains, private levels1..3 remapped to16×8/lastLevel2, segmented cuts5/71,
  nonzero mip crop(2,1,5,3), offset+3 and stride29, GPU-only source clears,
  opposite-format ID reuse, stale queued cancellation and a surviving held old
  native range. `audits/independent-novel-sabotage.json` verifies every exact
  native/public/backing body and generation. Original20 scratch is D24S8;
  original21 uses D24. No lifetime correction is required.
- **P7 guards/budgets/rollback — HELD.** Predicted all malformed/overflow and
  one-byte-short budgets refuse before affected native allocation/collection,
  while injected post-allocation failures immediately unwind. Independent wire,
  body and source audits cover invalid descriptors/chains/boxes/strides,
  resource/view/conversion/PBO staging bounds and both disposal orders.
  `audits/fresh-source-audit.json` checks immediate pre-disposal charge rollback
  in all fresh schedules and only the three original source objects after
  one-byte-short native read/private-range refusal. `audits/independent-audit.json`
  supplies the full native/event and final-budget points, including allocated
  texture/storage/conversion/PBO faults. No budget correction is required.
- **P8 completed native sabotage — HELD.** Predicted unchanged original-input
  inverses reject a genuinely changed native plane behind a distinct second
  consumed fence. Both worker hot/cold completed controls are reopened. Hot
  completed-S8: original169→actual243, native clear sequence106 between consumed
  first sync4/sequence96 and second sync6/sequence118, both actual37148;
  `hot/fault-completed-stencil/blob-0004.bin.gz` raw700-byte SHA256
  `8f0d79898ead31af35fa611c42606f82304405e71fc41928f38300824b65b5f0`.
  Completed-depth reports actual0.875 at pixel0 with unchanged S8; raw native
  SHA256 `649680eb5e452c6c9b7c5a86a2045e83fe7ebf6e826c5aca06000ec1aef2c11a`.
  Depth-precision and stencil-selection controls likewise fail exact independent
  inverses. Fresh existing inverse rejects98→56. Fresh **promoted** inverse
  rejects199→97 in `runs/d42-critic-promoted-sabotage/report.json`: actual
  clearBufferiv(GL_STENCIL,0,[97]) sequence131, first sync4 consumed122 and
  distinct second sync6 consumed144, both actual/delivered37146. Native
  `blob-0005.bin.gz` raw11,220-byte SHA256
  `cf2ddc1876d99a1c0619d9368f7bdbbd1b45c5e506d07a6aab21735a6270c2f7`
  has97 at stencil pixel0/raw offset8976. Original depth and diagnostic constants
  are unchanged. These deliberately corrupted controls fail as predicted;
  they are not product refutations.
- **P9 retained paths/cold isolation — HELD.** Predicted retained UN16,
  floating18/126 and original Z16 gates, default floating D32F_S8 scratch and
  unchanged actual compiler pins. `audits/independent-wire-regressions.json`
  authenticates all retained reports and211 actual D32F_S8 allocations per
  retained floating-storage run. `floating-depth-gpu.mjs:56` retains the
  D32F_S8 default. Full generated MJS SHA256
  `6bb07a0b2a056d21ae52b22d7700ce10577854c1cdcf0877dd80be938e30e0fa`
  and Wasm SHA256
  `acbe036afcdc4f1d8aa8cfb0fb107f48ba27759a6af4a7b9d6c83e3aa679d6cc`
  are unchanged. `cold/report.json`, `cold/cold.log`, receipt and whole scrubber
  source prove one pristine detached acceptance at frozen c9d745dc, clean before
  and after, with RUSTFLAGS/CARGO_*/RUST_LOG isolation. No portability failure
  survives; the unchanged cold clone was not repeated.
- **P10 finest governing coverage — HELD.** Predicted no executed parent masks
  a zero child and no changed packed semantics are waived. Independent
  `audits/coverage.py` re-derives every changed runtime line/UTF16 region from
  Git and every raw V8 body, then picks each smallest governing nested range.
  `audits/independent-coverage.json` contains the complete hot/cold partitions
  with observer counts and source/text pins:516 executed,10 precisely pinned
  unchanged D41 color operands,0 unproven per run. Every waiver text equals the
  authenticated predecessor source; no new packed-depth or scratch-format
  operand is waived. No additional coverage run or dead-code deletion is needed.
- **P11 novel packed-field/range attack — HELD, with a recorded harness
  refinement.** The correlated edge/tie/high-bit pair and all256 S8/X8 attack
  passes with exact fields, private remap, backing/padding, generation, state and
  native completion. It is promoted as
  `renderer/virgl-command/tests/standard-packed-depth-critic.mjs`, driver
  `tools/verify-virgl-standard-packed-depth-critic.mjs` and
  `make verify-E6-T11d42-critic`. Final run at d3583d1f passes two formats and
 34,170 deterministic predictions. The eight GPU clear values include clamp
  endpoints, a low half step and high-half values; their validated canonical
  UN24 values are0,0,18,5592405,8388608,16777213,16777215,16777215.

The initial **failed** promoted-harness capture is preserved in full at
`runs/d42-critic-novel/`, source head8d1a2f55, report SHA256
`c324d34b4e02a52e49e6b5e611f878be1300b0b6b29b1b2d80e92e53db2970a6`.
It incorrectly extended the original-upload≤1 ULP criterion to a discrete
canonical-inverse promise for GPU FLOAT clears. Submitted low clear
f32(17.5/16777215) is1.0430813972561737e-6; actual native depth bits0x358c0001
choose canonical18 within allowed[17,18]. Original mistaken expected inverse
f32(18/16777215) bits0x35900001 differs262144 ULP. The actual native body is
`blob-0015.bin.gz`, raw2560-byte SHA256
`b64d688f0a32cb7709ddbbe9326b69fa89828fb04a81ba37e8929bd36593f0c9`,
after clear sync104 consumed9138 and refresh sync105 consumed9220.
`audits/initial-clear-audit.json` reopens the full failed prefix, all raw blobs,
exact original-upload/private/native constants/S8, and completion/retirement.

The **whole pinned primary OpenGL ES3.0.6 specification**, SHA256
`7e831831595d3e44c267cc0a0d754f8c244cf3c8f5056f49a674f25fb9d5adeb`,
provides the correction: §2.1.6.1/2 (PDF pages23–24, printed10–11) defines
normalization and the two adjacent unsigned integer conversion choices;
§2.13.1 (PDF pages95–96, printed82–83) permits floating window-depth
representation with fixed depth attachments; §4.2.3 (PDF pages201–202,
printed188–189) applies clamp/window-depth conversion to clears;
§3.8.15.1 (PDF page176, printed163) returns native Dt when compare mode is NONE.
The prediction journal refinement preceded the completing run. The page numbers
in its original informal note were imprecise; these physical PDF/printed-page
coordinates are authoritative. The corrected harness checks the full allowed
clear interval and exact public serialization of the validated native choice.
It leaves the independent original-upload≤1 ULP predicate unchanged. The
intermediate corrected pass at3a08a913 is also retained in full.

SUITE: retain the novel deterministic attack, its physical sabotage mode and
the critic verify target; retain all full fresh recordings, independent audit
sources/results, prediction journal, exact source bodies and native points in
the critic seal. No runtime fix or missing worker run is demanded. Carry D41
HELD evidence only at the authenticated unchanged boundaries described above.

The verdict covers opt-in original20/21 native storage/ranges/transfers on the
recorded real Metal backend. Production/API/caps, actual guest Mesa/compositor,
worker/scanout, live deployment and300MIPS remain unproven successor boundaries.
