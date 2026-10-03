VERDICT: verified

Fresh verifier for E6-T12c; no implementation contribution. Scope is isolated
state execution on frozen source `d530c0943c9c8bdb757e0f8ee440794d1316aea9`, diff
from `442b87c0`. Predictions were written before implementation/worker evidence;
final-code trusted-host controls were predicted before their runs. Sources,
reference semantics, actual state, lifetime observations, cold-clone evidence and
coverage failed to refute the task. No draw, guest activation, capset or FPS claim.

Predictions and concrete observations:

- P1 HELD — worker `hardware/report.json:463` records the original submit161
  prefix: 38 commands, unsupported draw byte5684; subsequent packets are explicitly
  separate, including 142 submit249 cleanup commands split 131+11 at11384. The
  eight submissions apply 207 non-draw commands in total. Original shader hashes
  remain e96102a3… and 80d6db6a…; the complete digests are in predictions.md and
  receipts. `audit.json` binds original compressed and decoded inputs, actual
  served modules/Wasm/fixture bytes, all recordings and both exact-head receipts.
- P2 HELD — typed namespaces reject wrong-type and destroyed handles; A/B/A uses
  identical object IDs but distinct resource/context generations. Independent
  `attacks.json:931` records 528 rejects/recoveries over 11 families and three
  seeds, without state-budget or lease growth. Simultaneous resource5/surface3
  numeric reuse leaves the old FBO bound to its original native texture until an
  explicit new surface bind (`attack-cases.mjs`, final lifetime block).
- P3 HELD — original CREATE_SUB_CTX selects1; worker A/B2/A/B1/A selection and
  teardown resolve per-context tables, returning to0 on current subcontext
  destruction. Invalid/missing/duplicate selection is bounded. Pinned creation,
  destruction and object-table semantics are cited in reference-notes.md.
- P4 HELD — original TGSI passes through the actual pinned Wasm translator and
  actual hardware WebGL2 compile/link. Independent LINK after fragment unbind
  leaves CURRENT_PROGRAM and virtual fragment binding null; rebind restores the
  same generation-owned program. Worker destroys/reuses a bound shader name,
  retains the old selector until rebind, then observes old program deletion.
- P5 HELD — actual reflected attributes are in_0/in_1 FLOAT_VEC4, original vertex
  layouts are two float components at stride16 offsets0/8, index buffer is u16.
  fsconst0 is uvec4[]/float32-bits, fssamp0 is sampler2D/unit0, VirglBlock is 656
  bytes with FLOAT winsys_adjust_y at640 equal1. `worker/hardware/report.json:634`
  and `:702` record reflection and actual state; the independent oracle reads
  actual uniform values, binding index and all 656 GPU buffer bytes.
- P6 HELD — original four 1065353216 words and independent negative-zero,
  subnormal, finite random and -1 bit patterns survive uniform4uiv unchanged.
  Zeroing that upload fails `attacks.json:5196` at the raw-uniform oracle.
  Constants and block bytes are reset correctly after hostile host writes and
  every alternating context restoration.
- P7 HELD — worker checks 6144 literal clear pixels, including original 1024 blue
  pixels. Independent checks 50176 pixels across 48 seeded clears plus retained
  old-storage magenta clear. Full CLEAR ignores disabled physical color writes,
  zero-area scissor and rasterizer discard, then restores copied virtual mask.
  Pixel oracle independently attaches the exact resource texture and compares
  readPixels bytes with literal0/255 clear values, not renderer output snapshots.
- P8 HELD — worker queries program/VAO/FBO/vertex/index/texture/sampler/mask/blend/
  viewport state after hostile poisoning and A/B2/A/B1/A switches. Independent
  adds 48 A/B/A cycles with actual system UBO byte corruption and changed block
  binding; disabled depth/stencil/scissor/discard and correct raw constants/masks
  return each time. Omitting the UBO refresh fails `attacks.json:5212`. Unsupported
  active depth/storage/image, nonidentity swizzle and incompatible attachment
  reject during the independent seeded runs, with valid-state recovery.
- P9 HELD — worker observes public resource5 removal, surface3 name destruction
  while still bound, and final texture deletion only at FBO unbind byte11384.
  It separately proves view/shader retained bindings, copied blend/raster fields,
  sampler deletion compaction, and store-first disposal. Independent double-name
  reuse tests the native old/new textures directly; all final state/resource
  budgets are zero, and no draw call executes (`attacks.json:5157`).
- P10 HELD — all task rejection families are represented in worker 51 named cases
  (`worker/hardware/report.json:2486`) and repeated independent mutations. The
  13 labelled trusted failure controls (`:2743`) cover GL helper/shader/sampler/
  program/UBO allocation, compilation/reflection and post-allocation cleanup;
  state recovery and idempotent disposal hold. An ordinary trusted Error escapes
  unchanged with no context publication; this is separately labelled, not a
  guest-input claim. Malformed complete-wire tails apply no prefix.
- P11 HELD — audit recomputes 369 checks, confirms every source/input and evidence
  digest, actual hardware WebGL enabled, zero browser errors and clean cold
  checkout before/after; independently reading the retained clone still finds
  frozen HEAD and no changes. The clean clone rebuilt the translator and fresh
  dependencies; generated Wasm bytes match the worker and verifier. Both baseline
  screenshots were visually inspected. Coverage classifications follow below.
- P12 HELD — worker and cold-clone wire mutations of original constant and color
  mask fail the actual uniform/mask oracles. Independent runtime mutations zeroing
  raw constants and suppressing system UBO refresh also fail. The latter catches
  stale mutable GPU storage independently of the worker's chosen mutations.

Changed-hunk sufficiency (precise V8 innermost-range union of exact-source worker
and independent recordings, not a line-presence approximation):

| Changed boundary | Evidence/classification |
| --- | --- |
| state.mjs:1–118 configuration, errors, context generations, leases, helper allocation | Executed; ordinary Error propagation independently covered. Only two diagnostic fallbacks at89 waived below. |
| state.mjs:120–212 references, object destruction/creation and rollback | Executed; original lifetimes, copied state, reused names, quotas and labelled allocation/post-allocation failures. |
| state.mjs:213–311 link, actual reflection, block allocation and layout | Executed; original bridge/GPU path, reflection/limit failures; optional empty fragment block metadata independently exercised while retaining actual vertex block requirement. |
| state.mjs:312–397 complete physical GL restoration | Executed; actual state queries, original/seeded CLEAR and poisoned mutable UBO/constant data. |
| state.mjs:398–497 command application/reset/transfer/CLEAR/draw stop | Executed; original ordered state/teardown plus seeded malformed/unsupported/type/lifetime cases. |
| state.mjs:498–555 inspect/context/submission/disposal APIs | Executed; all 68 V8 functions execute, final budgets zero; errors and stale/disposed ownership covered. |
| resources.mjs:457–468 lease-bound native-storage capability | Executed; valid retained generation, forged/foreign/released/disposed leases, public ID reuse and final collection. Unchanged resource implementation carries T12b proof forward. |
| tests/state-acceptance.mjs and state-fixtures.mjs | Executed by worker/cold recorded gate; original bytes/selected lifecycle events recomputed and independently bound to frozen source. Test oracles reviewed against pinned semantics and actual GL queries, with independent literals/sabotages. |
| verify-virgl-object-state.mjs/.sh, state-receipt.py, state-cold.py and Makefile target | Exact-source successful worker/cold orchestration and both sabotage paths recorded. CLI misuse/timeout/filesystem-failure diagnostics are host orchestration, waived from guest-semantic coverage. |
| READMEs/task metadata/QUEUE | Declarative documentation and lifecycle only; reviewed against implemented scoped contract. |

`audit.json` reports zero unexecuted scoped functions. Its only uncovered state
ranges are `?? "invalid-lease"` and `?? "Storage lease release failed."` at line89
(offsets6110–6128 and6154–6188). WAIVED: these select fallback diagnostic text only
if the trusted releaseStorage capability violates its response contract by
returning a malformed failure without code/message. The verified store returns
structured errors; valid guest input cannot reach these alternatives. Actual
structured lease rejection and store-first cleanup execute. These are not unused
state semantics, and no guest-selected behavior is waived.

Mock/environment hunt: actual translator bytes, original shader text, GL compile/
link/reflection, native texture/buffer handles and readPixels are used. Synthetic
B remaps only resource handles and retains shader bodies; independent random
seeds are 0x6a09e667, 0xbb67ae85 and 0x3c6ef372. Trusted fault wrappers are labelled
and do not substitute for successful hardware proof. No reference readback is
used as CLEAR's oracle. Browser is Chrome154/ANGLE Metal/Apple M4 Max, hardware
WebGL enabled, without software-renderer or disable-GPU flags. CLI environmental
scrubbing and retained clean-clone HEAD/status were independently inspected.

Permanent suite: retain original deterministic acceptance target, worker attack
cases, exact original corpus and verifier attack runner with seeded rejection,
GPU lifetime/UBO oracles and source sabotage controls. The verifier runner and
audit script are committed reproducible promoted tests under this directory;
no runtime patch is required. Unchanged compiler-language/resource proofs carry
forward; whole-stream drawing remains the dependent task.

Commands:

- `node evidence/virgl-state/verifier/run-attacks.mjs`
- `python3 evidence/virgl-state/verifier/audit-evidence.py`

Final digest anchors:

- Worker receipt: 94d8db69ea0ee07aff2221cc4ad73aaea3589b06d3cc7ffd8456e1381683146d
- Cold receipt: 633abb0077a5cdd416e7f06146fc0313dc93baff2dd0759289425e8694496f90
- Independent attacks: 29ccc226b0acad86e37a70939e8be1866e346a9e527ce5732ec00ac5057661d6
- Independent audit: 5ce1258a510a4728c1d92d38a28bfcd21218f151ddde27d0ec13f1d335e93e1d
- Independent screenshot: 14b0327e9fa88c89ad9574cad18bed9c741b747769b9a3f446181b71495606b7
