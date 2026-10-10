---
id: E6-T11d9
epic: 6
title: Normalize owned standard index streams for primitive restart
priority: 525.027039001
status: verified
depends_on: [E6-T11d8]
estimate: S
risk: high
capstone: false
---

## Boundary

One standard async indexed-primitive boundary: accept explicit indexed restart
and preserve disabled restart even when an original u8/u16 vertex equals its
native fixed sentinel. Parse original owned GPU index bytes; exclude only the
wire restart value when enabled, map it to native u32 fixed restart, and widen
other original indices without changing native vertex IDs. Preserve native
limits, all original fetch bounds/work budgets, generics/divisors, offset sums
and complete-batch revalidation before the real draw. Do not execute shaders
on the CPU. Legacy factories still reject restart and their original sentinel.
Reject nonindexed restart, unsupported base offsets and out-of-native-limit
nonrestart indices. No new primitive, shader, vertex/storage format, production
capability or API authority.

A bounded private native u32 index buffer is allowed only when required. Own it
through the job's final completion/drain or explicit disposal and release it
on every failure. Total normalized index bytes per job are <=4 times the
existing total source-index work budget (<=262144), with <=64 buffers and one
job. Account CPU and GPU scratch explicitly. Retained source resource identity
and original offsets remain distinct from native normalized offset0/typeu32.
Already compatible original streams should preserve the existing native path.
Zero valid indices (all restart) produce no pixels, preserve charged source
work, and use explicit no-vertex bounds/reporting. Do not confuse restart words
with actual maximum vertices or trust min/max hints.

## Deterministic acceptance

`make verify-E6-T11d9` runs literal original flags/index sizes in Node and the
headed hardware browser. Independently reconstruct actual GPU source and any
normalized GPU buffers, native modes/types/offsets/vertex IDs and full pixels. The independent original
position record carries an exact ID tag; a native shader comparison guards clip W.
Use constant per-instance flat colors so the index proof does not grant a
separate provoking-vertex qualification. Binary instance tile spacing keeps
triangle boundaries independent of subpixel quantization.
Cover each supported line/triangle mode, enabled native/custom restart values,
u8/u16/u32 originals, ordinary/instanced draws, leading/trailing/repeated/all
restart, incomplete segments and high actual nonrestart vertices. Disabled
restart must render u8 vertex255 and u16 vertex65535 instead of dropping them.
All-restart and degenerate segments produce no geometry while budgets remain
conservative. Include mixed generic/instance attributes and three schedules.

Prove exact normalized byte/work limits and tightening/short bounds; reject
out-of-native-range real vertices and invalid nonindexed flags before draw.
Change/cancel/reuse original source while reads are pending, poison native
index bindings and restore A/B/A, force partial native normalization allocation
failure and dispose with pending ownership. All read and native scratch budgets
return to zero. An actual served restart mapping/type mutation completes its
GPU draw/fence and fails the independent primitive pixel oracle. Authenticate
unchanged D7/D8/D6 carry under incremental policy; rerun only their directly
affected physical boundaries once at freeze, then one final pristine exact-head
clone. Seal original wire/upload/physical GPU-normalized bytes/native calls,
full pixels and hunk coverage. A fresh critic alone may verify; no production,
complete GLES/API, actual guest or performance claim follows.

## Adversarial verification

Predict original versus normalized values and per-segment geometry first.
Invent one independently seeded custom restart with offset/wide-index stream
and another later-task schedule; try a nonrestart native sentinel and all-restart
case. Attack resource revision after read collection, cancellation, name reuse,
allocation exhaustion and scratch accounting. Sabotage the promoted oracle
once. Classify every new hunk against recordings and carry only unchanged
code/dependency/evidence digests. Do not re-litigate unrelated shader arithmetic.

## Verification log

### 2026-10-10 — worker — activated after verified topology

Dependency E6-T11d8 is independently verified at
`bef7040804a1c71ad37112e35adcfebefbc4be21`. The original negative readiness
record `evidence/virgl-production-readiness/standard-restart-gap.json` contains
18 literal indexed restart packets: all six supported modes, original restart
values255/65535/u32max and two instances. Both original decoders reject them.
Its recorded `2d1303bf` decoder/state/compiler bytes remain identical through
the fresh D8 verdict; every source digest was rechecked before activation.

Pinned Mesa26.2.2 `virgl_screen.c`320..321 uses one bit for both custom and fixed
primitive restart. Its `virgl_encode.c`982..1010 sends the full original restart
value when enabled and zero when disabled. WebGL2's primary specification
section PRIMITIVE_RESTART_FIXED_INDEX always enables each native type's maximum
sentinel. Fixed-only admission cannot justify Mesa's production cap bit. This
ordered S boundary normalizes actual retained indices as needed; it does not
grant production qualification. The explicit production graphics request keeps
this chain ahead of unrelated queue work.

Primary references: Mesa26.2.2 release source and
https://registry.khronos.org/webgl/specs/latest/2.0/ .


### 2026-10-10 — worker — implemented; awaiting fresh critic

Runtime and browser harness freeze:
`31e4b3ff907d36f54689513796927acc16b5fd62`. Final recording/receipt head:
`ef30bcccb02f006a72da6c4796134b9c780a828d`; the sole intervening change
is the receipt parser. Native Rust/device, shader/compiler, resource/cache,
constant-domain and link/uniform boundaries remain unchanged. The selected
high-risk submission is syntax/diff custody, actual fixed16MiB compiler build,
literal Node/browser packets, native hardware bytes/calls/pixels, varied later
schedules and lifetime/failure attacks, full affected D6/four legacy browser
gates, direct D7/D8 physical acceptance plus native sabotages/offline audits,
and one final pristine exact-head clone. These isolated factory changes expose
no production demo import or negotiation; deployment stays in E6-T11d.

Exact commands from the managed checkout:

```sh
VIRGL_STANDARD_RESTART_EVIDENCE_DIR=target/evidence/virgl-standard-restart-final make verify-E6-T11d9
python3 tools/virgl-command/standard-restart-receipt.py target/evidence/virgl-standard-restart-final
python3 tools/virgl-command/standard-restart-cold.py --output target/evidence/virgl-standard-restart-final-cold
python3 tools/virgl-command/standard-restart-seal.py target/evidence/virgl-standard-restart-final target/evidence/virgl-standard-restart-final-cold evidence/virgl-standard-restart/worker
```

The first hot command passes every compiler, wire, GPU and independent byte/pixel
gate, then its receipt parser raises `KeyError: bytes` on the deliberately
forced second `createBuffer`-null event. It is not a runtime refutation. The
original log and report heads remain unchanged. The narrow receipt-only repair
recognizes that non-byte event and explicitly authenticates unchanged physical
sources across only this receipt-file delta; the direct receipt command passes.
No old report is relabeled and no unrelated gate is restarted for this repair.
The final pristine clone runs the complete corrected default command once at
`ef30bcccb02f006a72da6c4796134b9c780a828d`, passes, and stays clean with
scrubbed environment. Hot physical source-head identity31e4 and final cold
source-head identityef30 are both recorded in their actual receipts.

Each original hot/cold hardware run proves189 frames/139008 pixels,377 actual
native draws and318 physical normalized EBO captures. Each Node and browser
matrix proves292 literal flag/indexed/mode/legacy/hostile packets. All six core
modes cover custom/fixed/out-of-original-type restart, original u8/u16/wide-u32,
zero/one/two/four instance fields, mixed generic/array/divisor records, original
nonzero offsets, leading/trailing/repeated/all restart and incomplete segments.
Native vertex IDs are checked by the original position's exact ID tag and a
native shader comparison guarding clip W. Per-instance flat colors stay
constant; this does not grant per-vertex provoking-state qualification. Binary
instance tiles preserve exact fixture geometry. All-restart has explicit
null/empty actual fetch reporting, native no-geometry behavior and charged
source work. Disabled restart renders vertex255/65535 as actual vertices.

Eight rejection jobs and four suspended original-index attacks cover short
position/constant/index storage, work/read limits, real nonrestartu32max,
revision after index collection while a constant remains pending, cancellation
and public-name reuse. Eleven private ownership scenarios reach exactly
262144 native bytes/64 buffers and tightened work/read/draw limits. The actual
second buffer creation/upload errors occur after a successful first draw;
only that prefix draws, the final fence drains, and all scratch/read budgets
return to zero. Cancellation holds native storage through a subsequent source
read or final fence. Explicit disposal invalidates pending tickets and deletes
every owned native buffer. A/B/A mode/context/native EBO poisoning restores
actual bindings. CPU scratch is charged at native upload and is zero at every
yield. The retained D6 negative for legal u8/u16 maxima now tests a genuine
one-byte-short source; its original historical evidence is carried unchanged.

The served actual mapping fault retains the original custom marker instead of
nativeu32max. Its `drawElementsInstanced` and final real fence complete, then
`mode-2-custom-0 independent restart pixel oracle` fails: pixel(2,3) expected
[85,56,51,128], observed[0,0,0,0],error128. Physical normalized GPU bytes show
the wrong original marker. Original/mutated source hashes, all literal packets,
original GPU uploads/buffers, private native EBO bytes, attributes/generics,
full pixels, real fence events, cleanup counters and V8 coverage are sealed.
D6 divisor, D7 generic and D8 mode sabotages also fail their original oracles.

Evidence of record: `evidence/virgl-standard-restart/worker/manifest.json`,
`records.json`, `recording.tar.gz`:6862 records,14118238 archive bytes.

- Archive SHA256 `bc713cc04fc443130c36a98abcd87586d4df52fad6ff2ffea16416b7ed618764`.
- Index SHA256 `3508f8a5acec1ed9ee54ed54e3ab886f37d9ee4083fd3ad3b8c08f74fa4ce779`.
- Hot receipt SHA256 `ce10ae383776b80c94366ebc167e8e41d6e40ffdf6294e77167e89269da2417a`.
- Cold report SHA256 `99f3be9267d5ad3947aced666fb3ec7ce62ccc0fd3b8602dc9bd02c22090cdd8`.
- Cold receipt SHA256 `8914cdf8ecad9443310a7077752a48761f93e76f12bfdc6c8630185e18eacdde`.
- Cold checkout `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-virgl-standard-restart-cold-r_4c3bae/wasm-vm`.

This claims only bounded index-stream lowering under the standard async facet.
Points, other storage/state/shader API families, provoking-state qualification,
production capsets, actual guest rendering, demo deployment and MIPS/FPS remain
outside its authority. Only a fresh critic may verify.

### 2026-10-10 — fresh verifier — VERDICT: verified

VERDICT: verified

The complete task and predecessor-to-submission diff were read before evidence.
P0–P9 were written as falsifiable predictions before opening
the archive; `verifier/predictions.json` SHA256
`a08d42dca27adb305ed5750f52610622e8fd1439264fd030a66a8991802c56cd`.
All ten held; no semantic contradiction or coverage gap remains. Submission
`13e0f7b26276cc1dd20bd3c67b82d463d07e4df0` is the actual head of the
fresh hardware reports. The later verifier commit adds tests, evidence and
metadata only; its runtime is identical to the frozen runtime source.

Paths below are relative to `evidence/virgl-standard-restart/verifier/`.
Worker report citations under `unpacked/hot/` or `unpacked/cold/` reopen from
the corresponding `hot/` or `cold/` member of the unchanged worker archive.
Fresh reports reopen from this verifier's archive. `citations.json` binds every
named point below to its original JSON line and complete report SHA256.

- **P0 custody and incremental carry — HELD.** All 6862 worker records, 726
  frozen source references, four generated binaries, 6854 receipt files and
  266 unchanged compiler/resource boundary files authenticate. Original hot
  reports retain source head31e4; the final pristine clone retains headef30.
  Git and source digests confirm that their only intervening change is the
  receipt parser. The original full hot `make` failed at `KeyError: bytes`
  after its compiler/wire/browser/offline gates passed; it is not relabeled
  passed. The narrow corrected receipt and the complete corrected pristine
  ef30 gate pass. `authentication.json` SHA256
  `8e6ceeda7c21c82667d2f85a1c1c42700582270986c620e0968214f42f440ab1`.
  Twenty historical files and their D6/D7/D8 seals match predecessorbef704:
  `carry-forward.json` SHA256
  `57166916d7a96bfaf19101eacd1c84702a821b5b01044fe47e2f639216d77a51`.
  Earlier HELD compiler/resource/cache/constant/link findings carry only for
  these unchanged boundaries. Old legal-u8/u16-sentinel rejection authority
  does not carry; the renewed D6 short-source negatives execute in hot/cold.
- **P1 literal admission — HELD.** Independently classified all 292 worker
  Node packets and each browser's matching 292 packets. Standard modes1–6
  admit only the specified boolean/indexed/offset/restart combinations; legacy
  modes4/5 still reject restart. Hostile booleans, nonindexed restart, offsets,
  stream output and malformed tails fail before native draw. Fresh Node and
  browser matrices each add 123 independently constructed packets.
  `boundary-audit.json` binds the literal-record digests and exact errors.
- **P2 original and native bytes — HELD.** Literal transfer bytes reconstruct
  every actual original GPU index buffer at its retained identity and original
  offset. Private u32 buffers replace only the exact enabled marker with
  u32max; all other IDs survive. Disabled255/65535 render, out-of-original-type
  markers never truncate, compatible native streams retain type/offset, and
  a real nonrestartu32max rejects. Points: hot `hardware/report.json` lines
  243531 custom, 244626 wide, 248933 disabled-byte, 250023 disabled-short and
  251112 out-of-type. The independent hot/cold audits check 636 physical
  normalized buffers and 754 native draws in total.
- **P3 native geometry, IDs and pixels — HELD.** A promoted oracle without
  runtime/decoder/compiler imports derives the six modes, segment/tail/loop
  geometry, original/native types and offsets, attribute/generic/divisor
  bindings and full pixels from original bytes. Original position ID tags and
  native I2F/SEQ clip-W guards physically observe unchanged native IDs.
  Constant per-instance flat colors avoid a provoking-state claim. All 378
  original hot/cold frames and 278016 pixels hold. Audit SHA256s:
  hot `78299acd4c57f71bce1a94af72904db0898325eb549e9afc706ff97f2a8d3ca8`,
  cold `b2f7742ac032a6e0cc0b28189fc8bf1a4bcd084167b0831ca92a157c91912676`.
  Only the declared bounded GLES line endpoint/exterior edge alternatives
  are allowed; interiors, outside pixels, loop closures and triangle shared
  edges remain strict. No observed pixel forms an expectation.
- **P4 actual bounds and no vertices — HELD.** Actual nonrestart bytes determine
  min/max independently of hints. All-restart reports null min/max and null
  first/last/byte ends with explicit empty fetches and clear pixels, while
  count times max(1,instances) still consumes work. Exact/one-short original
  index, position, constant and aggregate read storage give the specified
  outcomes; the exact generic/read ceiling is65552 and65551 rejects. Point:
  hot `hardware/report.json` line431849 (`all-custom-empty`).
- **P5 original identity while pending — HELD.** The complete pending batch
  remains revalidated after index collection while a constant is still
  pending; changing the collected original source rejects without draw or
  normalization. Public-name reuse preserves only the retained old generation
  and bytes. Cancellation and stale revisions drain pending reads and real
  fences; staging/read counters end at zero. Points: hot report line1063546
  (`pending-collected-index`) and424835 (`pending-reuse`).
- **P6 exact limits and native lifetime — HELD.** Exact65536 source words and
  64 draws reach262144 retained native bytes and64 buffers. Work65535 rejects
  after only its valid63-draw prefix. Private buffers are owned before upload,
  detached from the current guest VAO EBO at every observed yield, retained
  through later reads/final drain, and deleted on completion or explicit
  disposal. CPU scratch is charged at upload and zero at every yield. Second
  create/upload failures preserve only the successful first-draw prefix and
  drain its real final fence; cancellation at a later read or final fence
  retains native storage until that drain. Explicit disposal deletes owned
  native objects and invalidates pending tickets. All native/read/staging
  counters finish at zero. Points: hot report499567 exact,534562 one-short,
  671767 upload failure,674171 owned cancellation,1220853 disposal; fresh
  report254827 independently seeded all-restart exact-work case.
  `boundary-audit.json` SHA256
  `0b2370e34ddcae68bde4b1955a16002fc45b1d2a5822a8f783ffb1b1470754d4`.
- **P7 restoration and sufficiency — HELD.** A/B/A native mode/EBO/VAO
  restoration matches original bindings and pixels. Authenticated clean-source
  V8 precise coverage maps every added executable token in all18 runtime
  hunks:65 executable lines have positive counts;12 comment/delimiter lines
  are explicitly waived. There are zero unexecuted semantic additions. The
  audit excludes the altered served source from clean coverage. Worker gate,
  receipt/cold/seal and affected harness changes execute; unclaimed tool I/O
  error reporting and declarative documentation/evidence metadata receive
  narrow waivers in `verdict.json`. `coverage-audit.json` SHA256
  `03ee0eda43939d109ce4097176b660c239a1773ba94a55f251aa3338fca186c0`.
- **P8 actual oracle sensitivity — HELD.** The recorded served wrong-marker
  mapping completes `drawElementsInstanced` and a real final fence, retains
  original marker0x7a4d in physical normalized bytes, then fails
  `critic-mode-2-wide-custom-per-fence promoted independent restart pixel
  oracle`: first mismatch(0,3), expectedclear[0,0,0,0],
  observed[58,53,41,128],error128. Point: `final-promoted/fault-restart/report.json`
  line1880, SHA256
  `2fc33b9b82476de845fe7d0bfc57c838be1f3c7e93187028f1a85bcacee5654f`.
  The honest earlier attempt used an out-of-storage marker and stopped at
  native INVALID_OPERATION1282 before pixel comparison; its recording and
  original fixture are preserved, and it does not count as this proof.
  Only the fresh fixture marker was changed to the seeded in-storage value.
- **P9 bounded novel hardware run — HELD.** Independent seed0xc37a4d29 uses
  nonmonotonic wide original IDs, index offset44, independent binding/source
  offsets and per-fence later schedules1–7, plus rotated/ordinary schedules.
  All six modes, tails1/2/3, disabled maxima, fixed/custom/out-of-type/all
  restart, tight bounds, original identity, partial failures, cancellation,
  disposal and A/B/A restoration hold. The promoted gate passes52 frames,
  51712 pixels,177 actual native draws/normalized buffers,59 runs and2778
  directly checked yield states on headed AppleM4Max ANGLE Metal. Console,
  page and request errors are empty. Point: `final-promoted/hardware/report.json`
  line194564, SHA256
  `25d55902c7ffc3bdb86e4f1a3c4d5055b1213500cee16e936f5f77eb9cbcb289`.

SUITE: promote the independent hardware harness, literal/byte/geometry oracle,
offline physical audit and `make verify-E6-T11d9-adversarial`. Retain the seed,
whole raw GPU/fence/yield records, actual sensitivity failure, honest earlier
attempt, original predictions and per-hunk coverage in the verifier seal.
No runtime or worker evidence was edited. Complete GLES/API, production
capsets/import, per-vertex provoking convention, actual guest rendering, demo
deployment and MIPS/FPS remain unqualified.

Commands completed before status publication:

```sh
python3 evidence/virgl-standard-restart/verifier/authenticate.py
node tools/virgl-command/standard-restart-adversarial-pixels.mjs evidence/virgl-standard-restart/verifier/unpacked/hot evidence/virgl-standard-restart/verifier/hot-physical-audit.json
node tools/virgl-command/standard-restart-adversarial-pixels.mjs evidence/virgl-standard-restart/verifier/unpacked/cold evidence/virgl-standard-restart/verifier/cold-physical-audit.json
VIRGL_STANDARD_RESTART_ADVERSARIAL_EVIDENCE_DIR=evidence/virgl-standard-restart/verifier/final-promoted make verify-E6-T11d9-adversarial
python3 evidence/virgl-standard-restart/verifier/boundary_audit.py
python3 evidence/virgl-standard-restart/verifier/coverage_audit.py
python3 evidence/virgl-standard-restart/verifier/write_verdict.py
python3 evidence/virgl-standard-restart/verifier/seal.py
```

Evidence: `verifier/manifest.json`, `records.json`, `recording.tar.gz` contain
746 records and1828264 archive bytes. Every member was reopened and checked
against the index immediately after sealing. Recording-time scripts retain
their actual submission-head checks; source snapshots include the exact newly
promoted harness/oracle used by each physical report, with no later-head
relabeling.

- Verifier archive SHA256
  `eba0398049413c1cafebb0ce44c5122ead642406449689587f5ab968dd5fc7fd`.
- Verifier index SHA256
  `5e8254fed99a4de6beaa72e2fdeba756346c1f8ab83fbce4495cabd47c4999fe`.
- Full verdict SHA256
  `51374d95e7254266a389bc757d060e19e9ae2ee4d99219d097040f4dbd5e182c`.
