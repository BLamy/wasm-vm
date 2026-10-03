VERDICT: verified

Frozen runtime/harness: `5dc0c408b105b432b9558b8dbaa7928998378123`, compared
with activation `5ec8846b`. The verifier did not implement this task. Its earlier
successor-design work read async API documentation but made no implementation
changes. The separately prepared initial predictions were read first and remain
byte-identical; additions are recorded separately in `supplemental-predictions.md`
and `defensive-predictions.md`, before their respective executions.

The independent headed hardware run passed 4,520 assertions and 95 records,
including 2,304 literal pixels from three independently scheduled complete
replays. It made 309 browser-task yields, recorded zero browser errors and zero
surviving buffers/syncs in every completed rig. Expected context loss is recorded
explicitly and never treated as successful GPU completion. The independent source
sabotage was detected at oracle event 356: CPU collection had no matching observed
fence signal. Worker and independent screenshots were visually inspected.

## Prediction results

Citations below are JSON paths, with array indices zero-based. `A` denotes
`attacks.json` → `variants[0].result`; `W` denotes
`../worker/hardware/report.json` → `browserResult.result`. The digest table binds
the cited files. Every initial prediction P01–P20 is carried forward as HELD for
the task's stated boundary; supplemental P21–P24 and defensive predictions also
HELD.

| Prediction | Result and concrete evidence |
|---|---|
| P01 complete decode | HELD — A.records[27] rejects malformed tail; admission preserves complete inspection and GL event count. W.ownership and attacks[2]. |
| P02 owned submission | HELD — all three independent replays overwrite and detach each admitted source buffer before stepping; exact original pixels and counts survive. A.records[6,13,20]. |
| P03 bounded admission/steps | HELD — overlap fails busy; commandsPerStep=3 stops at three commands; subsequent turns progress. A.records[28–31,77–81]; W.budgets includes the maximum admitted submission and next-size rejection. |
| P04 fresh input | HELD — private attached backing starts zero; supplied fresh 92 bytes produce the original image. W.original.initialization and A.records[6,13,20]. |
| P05 single-use owned input | HELD — each provided array is detached immediately, duplicate handoffs reject, and wrong length/type/shared/foreign input preserves the valid exchange. A.records[0–2,67–72]. |
| P06 PBO texture reads | HELD — the independent strict oracle requires a numeric readPixels offset into an owned PBO; literal partial output and complete replay pass. A.oracleEvents and W.original.glTrace. |
| P07 typed private staging | HELD — strict real-GL copy oracle checks distinct source/destination objects and matching element/other-data classes; original index reads pass. W.original.sequencing has three index copies; W.coverage also exercises other-data staging. |
| P08 zero-wait progress | HELD — every instrumented wait uses flags=0, timeout=0; forced timeouts preserve pending work across actual browser tasks. A.heartbeats=309; A.records[62,94] cover WAIT_FAILED and native context loss. |
| P09 post-signal collection | HELD — baseline has no oracle violations. attacks.json → variants[1] fails the independently injected omitted-wait path at event 356, before accepting collected bytes. |
| P10 final GPU completion | HELD — empty and command-only jobs fence before success; original eight results report observed completion. A.records[34,37] and W.original.submissions[*].result. |
| P11 precise output/ack | HELD — dense 2×2 GPU texels at nonzero x/y, offset 18, stride 19 cross SG split 21; only exact rows change. Invalid/duplicate acknowledgements cannot advance work. A.records[22,24,26,56], W.rows and attacks[11–12]. |
| P12 identity after yield | HELD — backing, membership, public-resource and context replacement invalidate transfer exchanges before upload; suspended external renderer switching rejects busy. A.records[39–53]; W.attacks[24–33,56–60]. See retained-lease clarification below. |
| P13 staged index revision | HELD — a public upload changes actual live indices to an out-of-range value after staging; result is stale-storage and zero draws issue. A.records[60]; W.ownership.reports[0].mutation. |
| P14 whole-job quotas/prefix | HELD — three draws with quota two and commandsPerStep=1 return two applied commands/two actual draws; successor submission succeeds. A.records[76]; W.budgets. |
| P15 cancellation/cleanup | HELD — cancellation before issue, during PBO wait and awaiting acknowledgement; both disposal orders, wait failure and actual context loss terminate with appropriate completion semantics and no ownership leak. A.records[33–37,55,62–65,83,94], A.oracleStatistics; W.lifecycle. |
| P16 exact original replay | HELD — each of three independent runs executes eight original submissions, 210 commands, three draws and 768 literal interior pixels with chronological public initialization/teardown. Poisoned output-reference snapshots preserve hashes. A.records[6,13,20]; W.original. |
| P17 schedules | HELD — seeds 0x9e3779b9, 0x243f6a88, 0xb7e15162 vary withheld readiness; all three frame hashes agree. A.records[6,13,20]. |
| P18 synchronous compatibility | HELD — frozen-source decoder/resource/state/draw gates pass in worker and pristine clone. The async factory lacks the synchronous escape hatch; explicit cross-capability ticket rejection preserves ownership. W.capabilities; bound regression reports. |
| P19 exact evidence/coverage | HELD — audit.json checks source/fixture/served/capture/receipt hashes, frozen commit, retained clean clone, original wire headers, and both changed runtime files. No added runtime range remains unexecuted. |
| P20 limited product claim | HELD — no core/Wasm/default-web change exists between activation and frozen head. Prior ordinary production 127/127 and no-VIRGL evidence carries forward; this task claims isolated renderer jobs only. |
| P21 empty cancellation | HELD — cancelling before first step and while final fence waits creates exactly one cancellation fence, retains the slot until signal, releases sync and permits a successor. A.records[34,37]. |
| P22 attachment mapping | HELD — reattach changes backing generation and public ID reuse changes storage generation; captured old identities fail. A.records[41,49]; W.capabilities. |
| P23 terminal ownership | HELD — stale/foreign/consumed operations do not advance successors; disposed access tombstones permit only the one owned release, then reject. A.records[56,65,85,87]; W.attacks[88–91]. |
| P24 novel partial texture | HELD — four literal texels, nonzero origin, padded rows crossing SG, timeout counts 3/7/11, unrelated-byte edits preserved; cancelled old output cannot publish into replacement backing. A.records[22,24,26,55–56]. |

P12 is interpreted against the existing resource lease contract: a retained native
allocation may remain valid after its public name is removed. Reusing the numeric
name must never retarget that lease. Transfers require current public membership
and backing identities and reject their replacement; immutable retained draw
allocations retain their original generation. This preserves the verified resource
lifetime semantics rather than imposing a new blanket public-unref prohibition.

## Changed-hunk sufficiency and trusted failures

`audit.json.coverage` maps every hunk and its exact served-source coverage inputs.
All added character ranges execute across the worker hardware run, the same-source
synchronous regressions and this independent run: resources.mjs has 235 changed
lines; state.mjs has 207. There are no runtime waivers or dead added branches.

The first census identified six defensive ranges. Independent trusted fault cases
then exercised resource release-error aggregation (245/482), moved synchronous
gather exception cleanup (326), idempotent native release (635), and state
programmer-exception propagation (670/676). Native release happens before the
injected error; accounting still reaches zero. One-shot gather allocation failure
returns its scratch reservation; fence allocator programming exceptions propagate
unchanged. These cases never invent a GPU signal or substitute output bytes.
See A.records[85,87,89,90,92] and the corresponding precise coverage.

Non-runtime additions are the documented API, acceptance/receipt/cold tooling and
Make target executed in both final gates. Development driver reproductions are
clearly labelled diagnostics and are not used as final acceptance evidence.
Unchanged architectural/production proofs carry forward; no unrelated native
suite, guest transport, production activation, FPS or MIPS claim is added.

## Evidence, replay and retained suite

- `node evidence/virgl-async/verifier/run-attacks.mjs` — headed hardware cases,
  actual GL event oracle, precise coverage, screenshot and source sabotage.
- `python3 evidence/virgl-async/verifier/audit-evidence.py` — independent receipt,
  source/fixture, original-packet, clean-clone and added-range audit.
- `make verify-E6-T11b1` remains the permanent worker gate. Keep this independent
  attack runner and its literal partial-texture case as promoted regression
  artifacts; no compiled binaries are part of this review.

Final worker receipt:
`a2da723555c9de7ad5efcf96721095d9a2c3159b3c5626c0ebd6c32c73e9f049`.
Final cold receipt:
`d45407818f2514ee7d8e5c3fc15202bef13377d8ad285ec182d0e67b6f4cffcb`.
The retained clone still has the exact frozen HEAD and empty status. Cold assertion
counts differ slightly with readiness polling (479,427 versus worker 479,438);
all 93 attack cases and specified command/pixel results agree. Poll counts are not
a performance or determinism budget.

| Artifact | SHA-256 |
|---|---|
| Initial predictions | `677ada291f5788b987dfe01f2d2b34fa14c16fc50fe123ddc062158b8d72b111` |
| Supplemental predictions | `e5f2d03722513d9624c783c951bf8718360ca48566460e7825b01e0f82b1d53a` |
| Defensive predictions | `acd0f5b015604191ba4b340f18f4ab32f21756fcf97a502079ae16055b5e61f7` |
| Independent attacks | `5be2721cebc7b87d0dca3353adea0c7f446787a06f25170fbe4270598d4d021a` |
| Independent precise coverage | `28b29b1b5f40c1de0361056422077e7a977693c630e7e4b56a7de27a15c0ee4d` |
| Source/evidence/coverage audit | `5e560aaf3eb504ae7f99a90faace0c9cceb678cd0a705789074d4792ddfd6ae7` |
| Independent screenshot | `618a585c5565db2c34356fdabb895580efa0e8496eaa94080256ee0d971ed92d` |
