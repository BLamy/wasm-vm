VERDICT: verified

Fresh critic of E6-T11d48, scoped to submission
`b0bc023d80c06cf0a449eb7648632b3a9a0af137` against independently verified
predecessor `41c1aa490d19d8c307ea7bdbb5647acf346681f4`. Runtime/worker harness
freeze remains `f57db8c880684eb73cdc29c166568185fdde0a46`. The critic changed
no runtime implementation. Own checker/native recording freeze:
`edccae3f5f244c0a4f5c4b7e4d4b940fd1bd4685`; corrected physical checker freeze:
`44e3f1301b6253a1fdf066fd102ca68b81dce3ff`.

Predictions were written before opening worker evidence in `predictions.json`
(SHA256 `ff8f186ca671f728527bbe741f637aded72601913e348d4e3040a0e8227dad38`).
They predict concrete original coordinate, view/control, comparison and whole-word
states. Each outcome below is HELD; no product FAILED or NEEDS EVIDENCE remains.

Evidence paths below are archive member names. `fresh/` is the complete critic
recording; `hot/` and `cold/` are inside the actual full carried worker archive,
whose manifest/index and all32 parts are retained as `carried-worker-seal/`.
Ephemeral critic records are `target/evidence/virgl-shadow-critic-44e3f130`;
worker logical records reopen under its `unpacked/`. Every referenced body was
actually opened and checked, including hardlinked logical members.

- P01 custody — HELD. Reopened all52584 worker and213503 actual predecessor
  members, all32 archive parts,408 source closure bodies and generated compiler
  bodies. `fresh/authentication.json:1`, SHA256
  `a306395ee291e86d95f7b74e33ec7c8a9571be33e30731aa6acf13842e32801a`,
  lists every predecessor's published manifest/index/archive identity and count.
  Actual predecessor Wasm is `41afa61d8a42c547c7a8c4cc261ee4e689039d0edc62b98d3ecf448c3fca965d`;
  original module JS is `2fe4bfc079c0149817f8842e400e4567757da05b0e4e6d73689605a42aea0e05`.
  The worker archive still hashes to
  `49c9951e44f0aac20e4d709034e606803698ca7465d7f110078acccd29534c8a`.
- P02 original sources/dependency carry — HELD. Each source body equals its
  actual f57 Git body and the submitted body; primary pins match, including
  TGSI specification `6ec695d90ea0b3a5d471aab114352cc2431bcfc589f6b6e6ca88e4e1ca0caabe`
  and public token ABI `48d2cedf0e97e4a685c20acb59bc8dd1317e0b2ba9166e9c4ac81fedda2e61f9`.
  `fresh/authentication.json:1` records those full bodies and pins. Command,
  decoder/consumer/storage, Rust, web and guest sources equal verified41c1aa;
  D47's verified dependency and actual evidence identities are unchanged.
  Compiler sources also have no f57-to-44e3 diff. Carry only those unchanged
  HELD facts; no renewed guest, consumer, capset, demo or performance claim.
- P03 original tokens/full responses/history — HELD. Actual hot and cold Wasm
  modules re-execute7163 requests each, matching complete native/sanitized
  responses; all4313 historical raw response strings equal the actual carried
  predecessor. `fresh/original-response-audit.json:1`, SHA256
  `440f7815bbe9f6c46cb23bbc24a50fc23d5ad8536aba54435c7a2c9952fec7d4`,
  maps every case to its native/Wasm line and full response digest.
  `hot/native/native.jsonl:4314` begins the selected cases; whole native file
  SHA256 is `ea591400ee17477623f088b4118a934f1f6d95a05d5e1775b8eac30e573ef06f`.
  Independently decoded9050 accepted stages /249903 raw TGSI words /5641 texture
  instructions per temperature match original text masks, swizzles, absolute/
  negate, saturation/precision, targets, immediate words and declared view ranges.
  `fresh/original-token-audit.json:1`, SHA256
  `84be56c08d09329dffd05ee5575d0e6f6c2510eb8379889692e5f5d64d082f12`,
  also checks all retained native token fields against actual original raw words.
- P04 grammar/type/order/bounds — HELD. Hot/cold each admit5865 and refuse1298
  with no partial output. Integer declared shadow refusal is at
  `hot/native/native.jsonl:7113`; independent float/integer/shadow slots at7157;
  ordinary-then-shadow conflict refusal at7158 (same file digest above).
  Fresh original seed matrix `fresh/independent/native.jsonl:1` covers545 cases
  (343 admitted/202 refused), both stages,0/7/15 slots,2D/SHADOW2D declarations,
  all original selected opcodes, both conflict orders, both target spellings and
  query orders, integer refusals and16/65535 slot bounds. Independent seeds:
  `0x4a913ec7`, `0x9621bd5f`, `0xd0574af3`. Native and ASan/UBSan bytes are exactly
  `6066f28c45d2611dbc70fa84ee232502984de971e169cb431a1a26d3dfacd61c`;
  actual current Wasm agrees completely (`fresh/independent/audit.json:1`,
  SHA256 `bcfd258ee69f7d52b3bb23f5820a28157b09c88ede38f4119ac7b7683504bd6c`).
- P05 owned metadata/reflection/unused — HELD. Every selected response owns only
  sampled stage/slot vec4 mask/add names. Query-only/declaration-only controls
  are absent. Fresh live native slot7 samplers reflect SAMPLER_2D_SHADOW and
  mask/add controls reflect size-one FLOAT_VEC4, with VS unit3 and FS unit9.
  Native absent slot15 names and absent metadata are independently checked for
  both stages. `fresh/independent/hardware/report.json:1`, SHA256
  `dd75e32ea952822b4805754f602484bc166cedfd6f3ecc7c762c4e28a4b852c5`,
  contains each actual reflection/location/value call. Complete C-emitted ESSL
  exactly equals actual shaderSource calls; compile/link logs are empty.
- P06 facade/custody/independent memories — HELD. Worker239 strict rejections,
  original completed result custody, getter count0 and pressure recovery are at
  `hot/native/facade.json:2634` (SHA256
  `3cb73def503087b3ae0f9c7adf6f7ecf419c64bb8ae7b5743728d7a51031e146`).
  Fresh getter/trap/inherited/extra-host-control and snapshot mutation attacks
  pass with getter count0 and retained complete results. Three independently
  created fixed16777216-byte Wasm memories are distinct; a raw memory write
  leaves peers and the facade result intact. `fresh/independent/audit.json:1`
  above and its complete `fresh/node-coverage/` bodies record those actual calls.
- P07 actual faults/fixed bounds — HELD. Fresh actual allocation harness reaches
  the same213 faults and exact213 recoveries, with five source custody probes,
  no partial success and final summary at `fresh/independent/allocations.jsonl:224`
  (SHA256 `1dae94668405000c376b8e18e57f08517e1a473a0b951e48d8f74222726dfa91`).
  Full native ASan/UBSan output has no diagnostic failure. Authenticated optimized
  Wasm `.su` bodies sum139616 stage /195344 pair bytes, below262144, and recorded
  pressure failures recover without heap growth. `fresh/environment-stack-audit.json:1`,
  SHA256 `e8d314cf04b6afbd1942abf011874ef0b9fed38c6a8ce3e9e49d5049e17935f1`.
- P08 original whole native planes — HELD. Independently re-opened original
  shaders/sampler/view packets and real native input/depth uploads produce
  896 planes /8114 pixels /32456 exact words per temperature, with0 mismatches.
  All eight comparison functions, below/equal/above references, nearest and
  comparison-linear constant neighborhoods, mips/LOD/gradient/projection/bias,
  write lanes/modifiers/alpha, packed-SNORM and raw-ID wrap compositions hold.
  `fresh/worker-original-physical-audit.json:1`, SHA256
  `cf697f92ba9d74c1065d03ca8721fffda35f8d3072be3004861743adcc12c6d0`,
  records every plane's original byte/source digest, complete output digest and
  actual native writer/read event. Final packed composition: hot hardware writer
  174996, native fence19617 created174998/consumed175001, whole read175004;
  output `6e707bb637b16610a31b3bc7c85b727a5a9f075e945ab5d17d2b0ec8274057f4`.
  Full hot/cold browser report digests respectively
  `3818c7f68bffcc3a08a60b124f8983fcfff08ee0e6bbaabb2b7207d876868f8f` /
  `34aabb117cbe1f51fc7ab0a017dee393eda53c964cebc516a0a181cba6415a08`.
- P09 physical completion/custody — HELD. Every actual worker and novel writer
  has its own new physical fence, successful native wait and deletion before
  full RGBA32UI readback. Bodies and native handles are checked rather than
  synthetic completion metadata. Fresh baseline: writer173, created174,
  consumed179/deleted180, handle24, read182. Corruption: writer188, created189,
  consumed194/deleted195, handle26, read197. The complete237 actual calls and34
  typed bodies are in the fresh hardware report pinned under P05.
- P10 worker physical control — HELD. Worker control retains the baseline
  original expectation; the completed wrong mask changes only three red words
  from1065353216 to0. Hot fault writer134, created136/consumed141 (handle19),
  read144; cold writer135, created137/consumed142 (handle19), read145. Full output
  `e6bad6b2d03ca8bb682e862091b1797a5088ae2516f95b4b451c1546bbcfc5a5`.
  Hot/cold control reports hash
  `0659920ed6705eb618b78c32abf73e9c28d68aa67425baf53c6be312f41b7295` /
  `e7e71166dc819b5dd5678ce3dedc7fb87ffb9be4b0e88c6c5e806de0ac84b44a`;
  the original-word audit above physically rejects both controls. Browser
  console/page/request errors are0 in each temperature and the fresh recording.
- P11 finest coverage — HELD. Independently intersected every added source span
  with complete V8/LLVM region endpoints, then chose its smallest governing
  interval per script/function. All18 non-whitespace JS and308 native partitions
  have a positive count. Worker23 JS includes whitespace; the five excluded
  whitespace spans cannot hide an executable operand.17 explicit native
  non-executable fragments are listed below; no executable gap or dead path.
  `fresh/coverage-fine.json:1`, SHA256
  `b1bfaa14b51e4aa6ef45a1e0d304fc0a0387657c7ca0493bc488213692336f29`,
  contains every exact source/line/offset, governing raw region, counter, raw
  record filename/digest and waiver. `coverage-hunks.json` classifies all40
  runtime/ABI/build/Make hunks, with no NEEDS EVIDENCE or dead hunk.
- P12 pristine environment — HELD. Actual cold checkout is exactf57, pristine
  before/after, prescribed `make verify-E6-T11d48` exits0 with overrides scrubbed.
  `cold/report.json:1`, SHA256
  `853b0de055682cd6e7f275e798a96283130cdca1808f426161d96771b00f69a2`,
  names `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-virgl-shadow-texture-cold-ftmaedge/wasm-vm`.
  Full cold log `5d9f2fa7eb6644291b92eb17774e5d26f8deb5f8e5f5cddcef3413f595aad020`
  and receipt `5549d250033551617820708d11246071d2bca85861aeb217a6200d1139054e4c`
  were opened; all actual cold source/generated/toolchain/native bodies carry
  unchanged. Critic-only additions and assertion repairs do not restart this
  unchanged runtime proof, unrelated Rust/workspace gates or a second cold clone.
- P13 novel original native case — HELD. Original same-slot7 VS TXP absolute
  reversed coordinates produce LESS comparisons[1,0,0] against depth.5;
  FS TXL absolute zxyw coordinates produce GEQUAL comparisons[1,1,1] /
  [0,0,1] at LOD0/1. Distinct original stage views mask/add the scalar result;
  fragment query after sampling preserves original2x1/levels3 words. Each
  destination mask and untouched alpha survives; VirglBlock remains656/offset640.
  All24 predicted raw words agree after baseline's fence. Retained literal
  expected and observed whole-plane digest is
  `a75b3305f770a1d6f6e74262363a962d27d810be6afd95eae24e0fb797b3417c`;
  original native token masks9/6/11, SAT/PRECISE and swizzles3210/2013 are
  independently checked. `fresh/novel-physical-audit.json:1`, SHA256
  `ef5e3dfa0b807b21c9b9defdf45ffa198b9e5fa263908f8daa2c54d0f6115245`.
- P14 novel physical sabotage — HELD. Only `fsshadmask7.y` is set to0 after
  baseline; its new writer188/fence26/read197 changes y word indices1/5/9/21
  from1065353218 to2 at pixels(0,0),(1,0),(2,0),(2,1). All x/z/alpha words stay
  exact and the expectation digest above stays unchanged. Complete corrupted
  output is `3463d1b134f0e5cbcac91a09e955e7b7409152e422d728992aa98b636ae622af`.
  The independent Python original-word interpreter ignores emitted ESSL and
  JavaScript expected values when deriving output; it then compares the written
  forecast and rejects exactly those four actual native words after completion.
  This intended physical failure is a successful control, not a product failure.

Finest per-hunk disposition follows. The table counts source-span partitions;
full raw region/operand citations are retained in the sealed coverage audit.

| Submitted hunk | Finest positive partitions | Lowest positive governing count | Non-executable fragments |
| --- | ---: | ---: | ---: |
| `Makefile:2461-2464` | 0 | ABI/config | 0 |
| `renderer/virgl-shader/bridge.c:2413` | 6 | 4081 | 0 |
| `renderer/virgl-shader/bridge.c:2493` | 22 | 2 | 0 |
| `renderer/virgl-shader/bridge.c:2521-2531` | 33 | 2 | 0 |
| `renderer/virgl-shader/bridge.c:2580` | 0 | ABI/config | 1 |
| `renderer/virgl-shader/bridge.c:2585` | 1 | 3915 | 0 |
| `renderer/virgl-shader/bridge.c:2601` | 1 | 15 | 0 |
| `renderer/virgl-shader/bridge.c:2605` | 1 | 10 | 0 |
| `renderer/virgl-shader/bridge.c:2612` | 0 | ABI/config | 1 |
| `renderer/virgl-shader/bridge.c:2620-2621` | 2 | 3233 | 0 |
| `renderer/virgl-shader/bridge.c:2667` | 1 | 2 | 0 |
| `renderer/virgl-shader/bridge.c:2674` | 1 | 2 | 0 |
| `renderer/virgl-shader/bridge.c:2682` | 1 | 2 | 0 |
| `renderer/virgl-shader/bridge.c:2692` | 1 | 1 | 0 |
| `renderer/virgl-shader/bridge.c:2697` | 1 | 644 | 0 |
| `renderer/virgl-shader/bridge.c:2707` | 1 | 281 | 0 |
| `renderer/virgl-shader/bridge.c:2713` | 1 | 1000 | 0 |
| `renderer/virgl-shader/bridge.c:2723` | 1 | 629 | 0 |
| `renderer/virgl-shader/bridge.c:2729` | 1 | 1016 | 0 |
| `renderer/virgl-shader/bridge.c:2740-2756` | 9 | 711 | 7 |
| `renderer/virgl-shader/bridge.h:138-146` | 0 | ABI/config | 0 |
| `renderer/virgl-shader/build.sh:20-45` | 0 | ABI/config | 0 |
| `renderer/virgl-shader/build.sh:759` | 0 | ABI/config | 0 |
| `renderer/virgl-shader/standard.mjs:49-53` | 6 | 1 | 0 |
| `renderer/virgl-shader/standard.mjs:56-57` | 12 | 1 | 0 |
| `renderer/virgl-shader/standard_emit.c:105-107` | 25 | 466 | 0 |
| `renderer/virgl-shader/standard_emit.c:153-171` | 39 | 222 | 2 |
| `renderer/virgl-shader/standard_emit.c:207-209` | 13 | 1344 | 0 |
| `renderer/virgl-shader/standard_emit.c:282-283` | 9 | 1 | 0 |
| `renderer/virgl-shader/standard_guard.c:193-195` | 22 | 2 | 0 |
| `renderer/virgl-shader/standard_guard.c:202` | 7 | 2 | 0 |
| `renderer/virgl-shader/standard_guard.c:209-216` | 16 | 76 | 0 |
| `renderer/virgl-shader/standard_guard.c:303` | 4 | 7679 | 0 |
| `renderer/virgl-shader/standard_guard.c:308` | 0 | ABI/config | 1 |
| `renderer/virgl-shader/standard_guard.c:325-326` | 5 | 13760 | 0 |
| `renderer/virgl-shader/standard_guard.c:347` | 7 | 30696 | 0 |
| `renderer/virgl-shader/standard_guard.c:385-401` | 70 | 4 | 0 |
| `renderer/virgl-shader/standard_guard.h:32-35` | 0 | ABI/config | 4 |
| `renderer/virgl-shader/standard_guard.h:46` | 0 | ABI/config | 1 |
| `renderer/virgl-shader/standard_guard.h:72` | 7 | 1066 | 0 |

The17 explicit non-executable fragments are: bridge.c2580/2612 signature
continuations,2743-2744/2748-2752 new function signatures; standard_emit.c153-154
signature; standard_guard.c308 signature; standard_guard.h32-33 comments,
34-35/46 profile fields. Typed exports are exercised across native/sanitized/
Wasm; fields' actual readers/writers are in the positive partitions. bridge.h138-146
is ABI/comment only. build.sh20-45/759 is configuration exercised by recorded
native, ASan/UBSan, actual allocation interception, optimized Wasm stack and
Wasm export modes. Makefile2461-2464 is a declarative gate actually invoked.

Worker harness hunks are recorded evidence/suite mechanisms, not new production
semantics: both native_inputs and allocation C harness bodies run under actual
selected binaries; browser fixture/capture and `fixtures.mjs` run every physical
plane/control; cases/ABI/compiler/token helpers run the full original matrix;
coverage/receipt/predecessor helpers operate on their complete raw bodies;
cold.py records the pristine command; seal.py/seal-test.py reopen complete
archives. New primary.json/TGSI/NIR bodies are pinned source data. Their full
source and invocations are retained. Fail-fast/logging and archive-report-only
scaffolding is waived from production runtime coverage; no production hunk
is waived as fixture or logging code.

The critic's first outer unused-sampler assertion failed because correct
compiler metadata omits declared-unused samplers. Both original native frames
had already held/refuted as predicted with0 browser errors. The prior checker
source, full failed outer report and all original physical bodies are retained
in `fresh/carried-checker-source/`, `fresh/carried-checker-failure/` and
`fresh/carried-acceptance.log`. Only this checker assertion and token/carry
harness changed; `fresh/carry.json` pins every retained passed result and proves
no compiler/worker harness changes. Repeated the affected native physical
checker, original raw-word audit, independent oracle and syntax checks at44e3.
No runtime fix or repeated unchanged runtime/cold gauntlet was introduced.

SUITE: promote `verify-E6-T11d48-critic`, the three-seed original matrix,
independent raw TGSI decoder, strict custody probes, bounded native cross-stage
view/query fixture, original-word interpreter and its physical mask corruption.
Keep complete authentic worker/predecessor seals and every original/readback
body. No guest trace is invented for a no-guest compiler facet; native/sanitized/
actual Wasm/headed hardware is this task's authority. Host rr/ssh dev is retired
and explicitly waived. No PR stack/identity or merge operations occurred; the
unknown ChromePID23192/profile60rjcU was preserved, and each own browser closed.

Exact recorded commands:

```
VIRGL_SHADOW_CRITIC_EVIDENCE_DIR=target/evidence/virgl-shadow-critic-edccae3f caffeinate -disu make verify-E6-T11d48-critic
VIRGL_SHADOW_CRITIC_EVIDENCE_DIR=target/evidence/virgl-shadow-critic-44e3f130 VIRGL_SHADOW_CRITIC_CARRY_DIR=target/evidence/virgl-shadow-critic-edccae3f caffeinate -disu make verify-E6-T11d48-critic
caffeinate -disu python3 tools/virgl-shadow-shaders-critic/seal.py target/evidence/virgl-shadow-critic-44e3f130 evidence/virgl-shadow-shaders/verifier
```

Default `make verify-E6-T11d48-critic` reproduces the full independent gate;
recorded checker-only repair uses the explicit validated carry option.
Final task-policy check precedes queue regeneration and deliberate verifier commit.

Complete critic seal: sourceHead `44e3f1301b6253a1fdf066fd102ca68b81dce3ff`;626 logical
members physically reopened (561 distinct bodies),690978972 logical bytes;
533579212 archive bytes in32 parts. Manifest SHA256
`9079ba5b7457d02cdf180075f049e26c542484db1c794a56c7bba676461fb7c6`; record-index SHA256
`67c1175debe54024f70c35eadbe08733ae08930008a1928dc78af4232ce0349e`; archive SHA256
`642815d0c63aee4e79645203f0cb3437582c46a899eb36dcf159150899d7a05c`. A second independent reopen checked every
archived logical body against the actual current source/generated/record body;
`reopen.json` contains its result and all three digests. The seal includes the
complete full worker seal, whose actual carried predecessor bodies were reopened.

This verdict completes the isolated compiler boundary and releases the dependency
gate for its separate sampler consumer. Production guest graphics remains
unfinished; no new production/capset/demo/deployment/throughput authority follows.
