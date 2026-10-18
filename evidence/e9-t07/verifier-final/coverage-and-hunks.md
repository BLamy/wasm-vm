VERDICT: verified

Every acceptance prediction was written before evidence inspection in predictions.json.
The product boundary is frozen implementation 2c9c0a5; cb9af8ca adds worker evidence/status.
The verifier changes tests, evidence, status and generated queue only. No product fix was made.

Runtime coverage uses exact-source matching and UTF-16 code units. The global innermost
range wins. Positive function-only samples (isBlockCoverage=false, after profiler restart)
are excluded from line proof; otherwise they would overstate coverage of catch blocks.
All added executable runtime line regions have detailed positive coverage. This is not a
full branch-coverage claim. The direct-loader lease executes in a private paused restore
of a cloned original profile, with the exact original 23,860,091-byte frame and zero slices.

Residual subexpressions are explicitly waived: store46 forwards native LockManager failure;
store131/133/135/382 handle corrupt/non-Blob or failing migration/storage APIs outside the
valid v1 migration claim; store167 unwinds a database closed after capability acquisition;
store191 forwards malformed metadata; store364 forwards a sweep missing-count failure
(the recorded descriptor-change abort exercises the same atomic rollback boundary).
Library176/177 retain the T06 recording-owner guard/release and add the now-covered paused
owner-loss case. Library189/243/313/319 are disabled-control misuse/stale-owner guards that
preserve the already verified T06 owner boundary; library247 includes the initial no-row
comparison alternative, while both deleted-history and same-revision replacement refusal
are recorded; library289 is the display-label fallback. No product requirement depends on
an unrecorded guarded branch. Material quota, retry, missing-reference, partial deletion,
failed-label persistence and UI recovery branches are recorded in full.

All new store/library/loader hunks have runtime evidence. web/index.html and dist/app.html
controls execute through the actual mounted library and public demo. Source/dist mirrors
are byte identical. Generated build/cache identities, task/catalog metadata and contract
hash declarations are waived as declarative metadata and checked against their inputs.
The Make target and original21 submission gates execute at the frozen head. Changed
verification harnesses execute in recorded browser/native runs; the promoted tests and
wrapper wiring pass syntax/compile and the exact new post-browser command. There is no
new native/runtime code, so held workspace/cold/product gates are not restarted.

Novel attacks: same-revision manifest replacement; collector-held inverse exclusion;
concurrent unique-byte budget;32 actual three-page races with rehashed surviving references.
Both deliberate in-memory mark omissions fail on the exact lost disk/event payload hash.
The fresh UI context tests real IndexedDB and visible controls. Its injected label quota and
controller/save failure are negative boundary probes, not substitutes for actual guest quota.

Public evidence remains an honest composite: the original full public report remains
failed after storage completed because R2 reset the unchanged pinned GPU-pair download.
Independent original-frame/native/RAM/root/ext4 parsing holds the storage claim; a separate
real public GPU run validates all57 current/archive assets and a fresh qualified epoch4 draw.
Original traces/profiles/frames remain in target/evidence and were never opened for mutation.

SUITE: the portable critic and UI helper now run automatically after the browser proof in
make verify-E9-T07. This deposits inverse leases, identity-CAS retry, concurrent accounting,
real renderer crash cuts,32 schedules, visible error recovery and exact-hash sabotage tests.
