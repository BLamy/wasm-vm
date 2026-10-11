---
id: E6-T11d40
epic: 6
title: Consume original floating depth views and surfaces
status: verified
estimate: S
risk: high
priority: 525.027039000380
depends_on: [E6-T11d39]
capstone: false
---

## Boundary

One false-by-default original floating depth command consumer in decoder and
state only. Admit original Z32_FLOAT=18 and Z32_FLOAT_S8X24_UINT=126 view/surface
packets through the independently qualified D39 owner, retaining original mip
ranges, resource generations and field values. Use the unchanged actual C/Wasm
FLOAT sampler contracts and original client swizzle over native (D,0,0,1).
Depth surface selection must use its original mip and dimensions, attach each
correct native format, execute original depth comparison/write/clear state and
preserve the combined format's stencil. Historical profiles remain closed.

## Deterministic acceptance

`make verify-E6-T11d40`

Record the six literal original view/surface refusals at the final independently
verified D39 head before starting. Authenticate both D39 seals and the unchanged
storage/compiler source closure incrementally, including original whole Mesa
26.2.2 and pinned virglrenderer1.3.0 depth-view/swizzle sources. Rebuild actual
C/Wasm with held generated digests; no compiler, owner or transfer edits.

Execute FLOAT samplers in both stages at slots0/15, native nearest and original
TXF/TXL/TEX/TXD/TXB/TXQ where that stage supports them. Cover arbitrary original
swizzles/constants, full and private truncated NPOT ranges, nonzero source and
output levels and GPU-only source refresh. Independently invert original shader,
packet, descriptor and segmented input bytes into full native float output words,
retained depth/stencil fields, public output rows and all untouched padding/mips.
Use exact binary fraction inputs. Reject original linear minification,
magnification and mip filters before any private copy or guest draw. GLES3.0.6
section3.8.13 makes non-comparison depth textures incomplete under those filters;
native linear support cannot be granted by this decoder/state boundary. A later
qualified shader/storage path must implement desktop depth linear semantics.

Execute original floating depth surfaces at base/nonzero levels with all eight
comparison functions, enabled/disabled tests and write masks, full depth clears
and matching FLOAT/SINT/UINT color neighbors. Prove stencil preserved across each
operation and correct attachment texture, level and dimensions. Reject wrong
sampler returns, roles, format aliases, layers, levels, dimensions and overlapping
depth feedback before any guest native draw or private image copy. Preserve the
held Z16 depth surface path and old command profile refusals.

Run three varied original range/object/generation/fence/lifetime schedules,
including old generation plus opposite-format ID reuse, cancellation and both
owner/renderer disposal orders. Record actual native bindings, compiler requests,
warm cache reuse, physical consumed fences, once-only retirement and zero terminal
charges. Refute actual wrong sampler/attachment and completed native depth/float
output corruption after a distinct second physical fence with unchanged full
inverses. Account for every changed governing nested V8 partition, allowing only
exact source-pinned unchanged predecessor operands or non-executable whitespace.

Run scoped syntax, diff and policy checks plus affected predecessor consumers.
Record one final frozen hot run and one pristine scrubbed cold clone, then reopen
the full source/input/native/public/browser/coverage/screenshot worker archive.
This selected isolated factory is not demo-reachable. Parent E6-T11d retains
production API/capset, real guest/compositor, browser demo/deployment and measured
throughput acceptance. Shadow compare, stencil testing and Z16 sampler storage
remain separate gaps; this task grants no production draw authority.

## Adversarial verification

A fresh critic reads the task and diff and records falsifiable predictions before
opening evidence. Authenticate complete source/member/receipt/cold pins and
carry only unchanged predecessor HELD results. Independently derive native/public
words and stencil preservation from original packets/TGSI/input bodies, examine
correct native depth attachments and levels, every changed governing partition,
physical fence custody and exact resource generation/terminal retirement.

Run three new schedules and one bounded novel depth-view/surface/generation
attack. Sabotage actual completed native storage after a new consumed physical
fence and require unchanged inverses to reject it. Promote one useful deterministic
attack, seal complete recordings and set verified only when no contradiction or
proof gap survives. Do not repeat the unchanged final cold clone absent a
portability finding. Full API and production offload are outside this boundary.

## Verification log

### 2026-10-11 — worker — original floating depth consumer refusal

D39 is independently verified at
`50b98a3ab6652e9d23f3eaac5eb1095023f9898d`. Exact reproduction:

```sh
node evidence/virgl-production-readiness/standard-floating-depth-consumer-gap.mjs
```

The complete source-pinned original record
`evidence/virgl-production-readiness/standard-floating-depth-consumer-gap.json`
contains six `unsupported-feature` refusals from the unchanged D38 command
profile: both formats at base and swizzled restricted mip views, plus nonzero
mip depth surfaces. No native or guest operation executes in this probe.
This orders one selected command consumer above the verified D39 storage.

Whole original Mesa26.2.2 and pinned virglrenderer1.3.0 sources establish the
native depth component, original client swizzle and preservation of S8. GLES3.0.6
section3.8.15.1 assigns depth to Rt, with RED expansion (Rt,0,0,1) in table3.24;
its non-shadow lookup ignores stencil. These primary facts grant no production
API or capset authority.

### 2026-10-11 — worker — depth filtering scope corrected from primary evidence

The ephemeral hardware matrix
`target/evidence/d40-full-samples/report.json` caught original Z32_FLOAT vertex
TXF with a linear sampler returning zero depth, instead of the input depth word
`1051721728`. Whole pinned GLES3.0.6 PDF page174 / printed161, section3.8.13,
requires native nearest-compatible filtering when depth compare mode is NONE.
This is a native API restriction even for TXF. The initial plan's native linear
acceptance was therefore incorrect. This selected decoder/state task now proves
explicit pre-copy/pre-draw linear refusal; qualified desktop linear depth
semantics remain parent production work. No compiler or owner behavior changes.

### 2026-10-11 — worker — frozen original floating depth consumer submission

Runtime and harness freeze: `1f8cb8c7ccdf8d58e78944a51156453a22fc5b5a`.
The runtime diff from independently verified D39
`50b98a3ab6652e9d23f3eaac5eb1095023f9898d` changes only decoder/state; all
resource, transfer, constant-domain and actual C/Wasm compiler boundaries retain
their held identities. Final commands, run once at this frozen head:

```sh
EMCC=/Users/blamy/.cache/wasm-vm/emsdk/4.0.22/wasm-vm-emcc \
  VIRGL_FLOATING_DEPTH_CONSUMER_EVIDENCE_DIR=target/evidence/virgl-standard-floating-depth-consumer-final-hot \
  make verify-E6-T11d40
python3 tools/virgl-floating-depth-consumer/cold.py \
  --output target/evidence/virgl-standard-floating-depth-consumer-final-cold
python3 tools/virgl-floating-depth-consumer/seal.py \
  target/evidence/virgl-standard-floating-depth-consumer-final-hot \
  target/evidence/virgl-standard-floating-depth-consumer-final-cold \
  evidence/virgl-floating-depth-consumer/worker
```

Both acceptance receipts passed, with the cold clone pristine before and after
the run and its relevant inherited environment scrubbed. Each independently
inverted 74 positive original runs, 206 native output frames, 23,664 float/integer
output words, 28,188 retained native depth/stencil pixels and 10,560,000 public
bytes, with 2,485 consumed physical syncs and 144 actual compiler responses.
The full nearest-compatible 22-pair sampler matrix covers both stages, slots0/15,
original operations, swizzles/constants, full/private NPOT ranges and output
mips. Forty surface cases cover all eight comparisons, test/write state, FLOAT,
SINT and UINT neighbors, plus attachment switching through original Z16 and the
opposite floating format without losing original S8. Three boundary schedules
cover linear and role/return/range/feedback refusal, GPU-only old-range refresh,
opposite-format ID reuse and completing/cancelling/disposing queued generations.
Retired queued output planes were read after physical completion and before
native deletion. Every terminal account is zero; native objects retire once.

Each hot/cold recording also refuted actual wrong native sampler and depth
attachment controls, and completed native color/depth corruption after distinct
second consumed physical fences, through the unchanged JS/Python inverses.
Historical MRT, FLOAT/SINT/UINT, packed-normalized, packed-unsigned and Z16
consumer checks passed on the real Metal GPU with zero browser errors and no
software-rendering flags. Syntax, Python compilation, shell syntax, diff/policy,
actual C/Wasm rebuild and all affected gates passed. Both coverage audits have
305 positive governing nested V8 partitions, 24 exact source-pinned unchanged
predecessor operands, and zero unexplained partitions. The predecessor audit
reopened all 28,339 D39 worker/critic members; no held boundary was requalified.

Complete committed evidence is `evidence/virgl-floating-depth-consumer/worker/`:
33,662 members, 1,521,428,916 raw bytes, 90,599,444 archive bytes. Every member was
reopened and authenticated, including original wire/TGSI/input/native/public
bodies, browser command lines, full source bodies/closures, nested counters,
screenshots, original primary sources, hot/cold logs and generated compiler
bytes. SHA256 identities:

- archive: `44697cfa945b3ea306d44eb9fefef1e8505a56ac7aec37f538471c374f5ecba6`
- index: `4e1bf3fc407ec86d2897ccc1279a82d401d9061d1873d55125575a036fefd22a`
- manifest: `0bd79d028035888c9f7c6d3876c0c03de3b44b5fb108d035b4f7b802377bbeb5`
- hot receipt: `aee53aa3ed5147d0454432d39a16eaae152e327dbd54c9ab358e0d8d7c8682ee`
- cold report: `d3d0e38a1d34807acb41764120bec075cc3c10a43b7b6b47412d2a6590961c97`
- cold receipt: `f2d539b85783e0630a5fb49b95642c5f08ecea704b3be7492a3f5ce903220c9d`

This evidence demonstrates the selected original non-shadow floating-depth
command boundary with nearest-compatible filtering and preserved depth/stencil
storage and lifetimes. It deliberately grants no linear-depth, shadow-compare,
stencil-test, Z16-sampler, full-API, production-capset, guest-execution, offload or
throughput authority. Fresh adversarial verification is still required.


### 2026-10-11 — fresh verifier

VERDICT: verified

This fresh session read the complete task and scoped diff before evidence and
wrote 17 falsifiable predictions at `2026-10-11T11:10:18.031188+00:00`.
Their original text and HELD results are in `audit/predictions.json` in the
verifier seal. Runtime/harness worker freeze remains
`1f8cb8c7ccdf8d58e78944a51156453a22fc5b5a`; submission was
`4e71167f13b53a3e8591b4a2aff91549a8049390`. Only new critic tests/recording tools
and their Makefile gate were promoted, frozen at
`05a2511cc58ba1f3bac7c649f0fc4c17728ed7c6`. No implementation was edited.
Paths beginning `hot/` or `cold/` below are full members of the worker archive;
`fresh/` and `audit/` are full members of the verifier archive. Both citation
indexes contain exact JSON pointers, one-based lines and full report digests.

- P01 custody — HELD. Independently reopened all 33,662 worker members and
  1,521,428,916 raw bytes. Every source, receipt, input/native/public blob,
  browser source body and actual generated compiler identity matches its pin;
  `audit/authentication.json` records the complete audit. Hot/cold receipts
  authenticate the exact frozen worker head and held MJS/Wasm digests.
- P02 predecessor — HELD. Reopened all 28,339 members of both unchanged D39
  seals, authenticated 292 unchanged storage/helper/compiler/constant boundaries
  and the six literal original predecessor refusals. Their independently
  verified results carry forward; no predecessor gate was restarted.
- P03 admission — HELD. Original format18/126 fields are preserved only in the
  explicit selected profile, with all historical profiles still closed.
  `hot/wire/report.json:2495` and `:3081` contain original decoded fields;
  `:2520` retains `unsupported-feature` in the historical profile. Source,
  malformed-role/range packet bodies and executions remain complete.
- P04 shader/sample inverse — HELD. Unchanged independent JS/Python inverses
  derive every native/public word from original TGSI, packets and segmented
  input bytes. All 22 sampler cases cover both stages, slots0/15 and supported
  original operations, with exact original swizzle over native (D,0,0,1).
  `hot/hardware-samples/report.json:36331` preserves an original pair request;
  frame4 native/public bodies at `:1590985` / `:1591185` are independently
  inverted, including padding and all unselected output mips.
- P05 native bindings/compiler/cache — HELD. Each draw's actual SAMPLER_2D,
  stage unit, native format/generation and base/last parameters match the
  original view. Actual shaderSource bodies match successful original compiler
  pairs. `hot/hardware-samples/report.json:51140` records the native binding;
  `:30137` / `:31222` show unchanged warm program link counts. The complete
  response-accounting audit is `audit/compiler-custody.json`.
- P06 ranges/refresh — HELD. Full/private truncated NPOT planes, nonzero source
  and output mips and all untouched native/public fields invert exactly.
  The fresh retained generation receives only the original GPU depth clear at
  `fresh/promoted/report.json:3157` and refreshes its private view; the reused
  opposite-format backing remains byte-exact. The full source/public and native
  per-mip bodies are retained, without deriving expected values from product code.
- P07 surface inverse — HELD. All 40 surface cases independently reproduce
  all eight comparisons, enabled/disabled tests, both write masks and FLOAT,
  SINT and UINT neighbors from original DSA/input state. Original texture/level
  identity is recorded at `hot/hardware-surfaces/report.json:378501`; integer
  target component types at `:1194324` / `:1210335` remain native UINT/SINT.
- P08 stencil/clear/switch — HELD. Every combined-format native/public S8 is
  preserved by draws and full depth clears, with reserved public bits zero and
  unselected mips untouched. Native original/Z16/opposite/original attachment
  transitions at `hot/hardware-surfaces/report.json:270729`, `:270869` and
  `:271009` detach stale stencil; clear plane body is at `:270675`.
  Whole original primary sources and pinned GLES3.0.6 sections3.8.13/3.8.15.1
  and table3.24 remain in the full source closure, with independent PDF extracts.
- P09 refusal ordering — HELD. Wrong returns/roles/aliases/layers/ranges,
  dimensions, overlap and linear min/mag/mip all refuse before any private
  copy or guest native draw. Example exact results are
  `hot/hardware-boundaries-0x13579bdf/report.json:14327`, `:15115`, `:15699`,
  `:15896`, `:16093` and `:17845`; the physical event sweep proves no forbidden
  operation under each refusal label. Disjoint ranges still execute.
- P10 retained lifetimes — HELD. Old source/output generations remain held in
  queued finishing state while opposite-format public IDs refer to newer
  generations; completion, cancellation and both disposal orders retire once
  with zero charges. `hot/hardware-boundaries-0x13579bdf/report.json:10744`
  / `:10956` retain distinct old/new generations, `:9186` is finishing and
  `:11052` records image holds. Old native target7 completion sync62 occurs at
  physical sequence2362; retained output blob at `:56570` is read after that
  consumed completion (`:56564`) and before native deletion.
- P11 physical custody — HELD. Independent full event audit covers 25 recordings,
  6,044 CPU reads, 6,080 owned syncs, 6,062 consumed syncs and 18 disposal-only
  syncs, including both earlier critic qualification recordings and deliberate
  controls. Every CPU read follows its writer and an actual consumed physical
  completion. All 26,195 native objects and all syncs retire once; every terminal
  budget, hold and active job count is zero (`audit/state-audit.json`).
- P12 worker controls — HELD. Actual wrong sampler/attachment substitutions and
  completed native color/depth corruption are rejected by unchanged full
  inverses in both hot/cold records. Physical substitution points are
  `hot/fault-sample-plane/report.json:10139` and
  `hot/fault-depth-attachment/report.json:9558`; distinct second consumed
  completion records are `hot/fault-completed-output/report.json:2985` and
  `hot/fault-completed-depth/report.json:2942`. These are native controls with
  full bodies and events, not metadata-only changes.
- P13 innermost governing coverage — HELD. Independently rebuilt every UTF16
  changed partition at every V8 child boundary and checked the narrowest
  governing counters, rather than parent hit counts. Hot and cold each have
  305 positive partitions, 24 exact byte-identical predecessor operand waivers
  and zero unproven partitions. Every waiver's source/offset/text/digest matches
  D39; no changed floating-depth semantics are waived
  (`audit/coverage-audit.json`, full source bodies/counters included).
- P14 cold/environment/scoped gates — HELD. Exact frozen pristine cold clone,
  scrubbed environment, affected consumers and scoped syntax/policy/diff checks
  authenticate. Real headed Chrome 155 on Apple M4 Max Metal has zero browser
  errors and no software flags. Held C/Wasm bytes are unchanged. No portability
  finding arose, so the final cold clone was carried forward once under the
  incremental rule; Rust/workspace/demo/production gates were not expanded.
- P15 fresh schedules — HELD. New seeds `0x510e527f`, `0x9b05688c` and
  `0x1f83d9ab` each pass full independent input/native/public/lifetime inversion.
  Together with the final novel positive, 13 new positive runs cover 58 frames,
  6,620 output words, 9,678 native depth/stencil pixels and 2,000,000 public bytes
  (`fresh/boundaries-*/`, `fresh/promoted/`, `audit/fresh-results.json`).
- P16 novel retained endpoint — HELD. Original combined-depth vertex TXL slot15
  view levels1..2 with client swizzle (D,1,0,D) executes with retained disjoint
  depth mip3 after public ID6 is replaced by format18. Retained inclusive endpoint
  mip2 refuses framebuffer-feedback before every copy/draw at
  `fresh/promoted/report.json:2965`. GPU-only original mip2 clear to 0.90625
  refreshes the old view while preserving S8 and replacement backing. Final
  native output at `:147823` has SHA256
  `79f783a5565dddb045b5153281b0dd84e253401ee5b5ad785710d4f90fa8a29f`.
- P17 fresh physical sabotage/promotion — HELD. After physical completion sync55
  at sequence12772, an actual native GL stencil clear changes retained native
  texture9/original mip2 to 0x5a. Distinct physical sync56 is created at 12810
  and actually consumed at 12815. Both unchanged JS and Python inverses reject
  native S8 90 versus original 161/234/51/124/197/14/87/160. Exact corruption,
  second fence, native blob and JS failure points are
  `fresh/fault-completed-stencil/report.json:3230`, `:160553`, `:166471` and
  `:375681`. Native blob0062 byte 128 is expected 161/observed 90; its full raw
  SHA256 is `5f3aad30bd5e72d6c81ff8599c7c5184de501e59bc31d3a9817355db4998e571`.

Accounting corrections preserve the original worker statement above for audit.
Each worker positive receipt has **2,485 owned physical sync identities**, of
which **2,479 are consumed completions** and **six are disposal-only** with no
polls and no authorized CPU collection. The six are the terminal fences71/87 in
the three boundary recordings. Exact hot lines are 244860/433928 for 13579bdf,
244932/433232 for 9e3779b9 and 244860/433736 for a5471e03; cold lines are
244884/433928,244860/433160 and 244860/433760 respectively, all in each full
`hardware-boundaries-<seed>/report.json`. `audit/citations.json` records their
full report digests and JSON pointers. The worker's **144 compiler responses**
is a per-draw matched-response count; each hot/cold positive recording actually
contains **86 pair responses and 172 stage responses (258 total)**. Full requests
arrays, original pair bodies and `audit/compiler-custody.json` authenticate that
count and the reuse of responses by warm draws. Neither accounting correction
contradicts the product claim or leaves a proof gap.

SUITE: promote the deterministic retained inclusive endpoint/generation attack
in `renderer/virgl-command/tests/standard-floating-depth-consumer-critic.mjs`,
its complete recorder and `make verify-E6-T11d40-critic`. The recurring gate
requires positive acceptance and unchanged full inverse success, then requires
actual completed native S8 sabotage to fail and independently invert as refuted.
It passed at the final harness head. Earlier qualification positive/control
recordings are retained completely. No implementation changes, production draw
or capset authority, guest execution, full API or throughput result is claimed.

Fresh commands:

```sh
node tools/verify-virgl-standard-floating-depth-consumer.mjs --output target/evidence/virgl-standard-floating-depth-consumer-critic/boundaries-0x510e527f --mode boundaries --seed 0x510e527f
node tools/verify-virgl-standard-floating-depth-consumer.mjs --output target/evidence/virgl-standard-floating-depth-consumer-critic/boundaries-0x9b05688c --mode boundaries --seed 0x9b05688c
node tools/verify-virgl-standard-floating-depth-consumer.mjs --output target/evidence/virgl-standard-floating-depth-consumer-critic/boundaries-0x1f83d9ab --mode boundaries --seed 0x1f83d9ab
# Run unchanged values.py on each direct recording directory.
make verify-E6-T11d40-critic
node --check renderer/virgl-command/tests/standard-floating-depth-consumer-critic.mjs
node --check tools/verify-virgl-standard-floating-depth-consumer-critic.mjs
# Independent audit programs and full results are preserved under audit/.
python3 /tmp/d40-fresh-critic/seal.py
python3 tools/check_task_policy.py
python3 tools/build_queue.py
```

The complete new seal is `evidence/virgl-floating-depth-consumer/verifier/`.
Every one of 7,041 logical/full members was reopened and authenticated:
276,630,684 raw bytes and 24,204,241 archive bytes, including all seven fresh
recordings, source closures, input/native/public bodies, generated compiler bytes,
full V8 counters/source bodies, browser physical events/command lines, screenshots,
qualification records and independent prediction/audit programs/results. The
full worker and both unchanged D39 archives remain separately committed and are
exact digest dependencies in this seal. SHA256 identities:

- archive: `25b0bbee63a5ac00720c8fcc9b037f695a231ab3bd29d3bb77a3d9b397e9dab0`
- index: `bbddcf9a418b2d5ce25b945dc6fd2c0fa8c416f4509fd470acfa8cd16ad3296b`
- manifest: `6e4897cec920be2bd3040f707f93c6147ad8797f05d3fbafda3458c7f86daa6c`

All 17 predictions HELD. No implementation contradiction or evidence gap remains.
