# Quiet-text diagnostic — closed-record review

Scope: `resident-quiet-text-d3f34c5b` only; no whole-cold revalidation,
runtime changes, browser runs, gates, status, queue or commit. Prior unchanged
HELD results carry. The worker has reported a cap failure; these predictions
precede independent inspection of its raw metrics/PNG, not knowledge of that
reported outcome.

## Predictions

- P1: actual HEAD/driver/template/runtime bindings match the reviewed code;
  original seed and newly saved quiet snapshot are distinguished.
- P2: the quiet restore matches its saved CRC without boot, fresh host PCM stays
  zero until the real gesture, and physical `play`/cursor/focus observations are
  actual and newly recorded, not leftover setup state.
- P3: the actual upper-band baseline has no pinned raster, then exactly one full
  match after ten physical key edges; positive fresh PCM and the retained
  conditional same-child-wait branch support real playback, not first-PCM alone.
- P4: the literal `postRestoreEnd - postRestoreStart` determines the cap outcome;
  raster and completion-PCM observations do not establish an unrecorded earlier
  PCM timestamp. Later coherence/drag/second-restore audits remain unreached.

## Result — reached diagnostic predicates hold; original timing fails

**Exact cap interval: 4877.610000014305 ms.** Independently calculated from the
canonical failure JSON, not phase-wall timestamps:

| Observation | Raw page timestamp (ms) | Relative to original T0 (ms) |
| --- | --- | --- |
| Actual quiet restore / `postRestoreStart` | 990.5299999713898 | 0 |
| First locked, empty PCM sample | 1312.554999947548 | 322.02499997615814 |
| Second locked, empty PCM sample | 1673.8499999046326 | 683.3199999332428 |
| Actual guest cursor acknowledgment | 1807.0049999952316 | 816.4750000238419 |
| Upper-band raster-absent baseline | 1825.3249999284744 | 834.7949999570847 |
| New exact raster observed | 5825.02999997139 | 4834.5 |
| Completion PCM sampled | 5826.954999923706 | 4836.424999952316 |
| Guest-output attachment observed | 5865.9800000190735 | 4875.450000047684 |
| Frozen `postRestoreEnd` | 5868.139999985695 | 4877.610000014305 |

The later `postRestoreInteraction.elapsedMs=4877.960000038147` is collected
0.3500000238418579 ms after the frozen end; it is **not** the cap interval.
Canonical error is `AssertionError: post-restore interaction exceeded 2 seconds`
at frozen driver line 2053, with the unhandled failure retained in the adjacent
log. All preceding new event assertions reached success. There is no first-PCM
probe: the positive PCM sample above is a completion observation, not proof
that PCM began then, or that it began before two seconds. Similarly the raster
timestamp is its recorded match observation, not a reconstructed rendering onset.
JSON anchors: `postRestoreStart`:522, cursor:557, raster:597, PCM:914,
attachment:929, end:953, later telemetry:954.

## Binding and actual-event checks

P1 — HELD, diagnostic identity. Actual record/config HEAD is
`d3f34c5b5bc902f6386828ee2724e32c3f053e4b`. Independently compared the driver,
matcher, pinned template and guest helper bytes with `git show` at that exact
head; they match current inspected files and the previously reviewed hashes.
The log identifies driver SHA `da25bcd9268d5ad9408eb007d2fc8b6f4be35fee8633ac4c6ebf93cea2099d47`.
Runtime/image/kernel/helper binding, excluding separately named harness HEAD,
matches held C. Runtime remains
`42aced7a2dfc4d0a69e1ea5a15685f5d9a605f797f8df1c5db89f95051ba0425`.
Original profile digest is still
`59f3f2483c95331fad64c5cf6014a60f42b3b9fb89a50ec7b2d1c8853d9c70b5`;
this run uses its distinct `iteration-TAeP5h/profile` copy. No profiler or
clock/JIT/residency/command override is selected. Physical `play` uses the
recorded resident 5-ms pacing, not the generic diagnostic delay field's zero.

The original snapshot (`b2e057cc…`, CRC `940993e9`) is explicitly separate from
the newly paused RAM-only quiet snapshot
`efcbf4b29859ed9e970b0e0f4fe46e5b0ba3778a941720d2003178eea2c19026`,
2,847,892 bytes, CRC `a74f4503`, generation 626. Quiet saved and restored hashes
and first-present CRC agree. The pre-reload frozen audit says paused/resume/626
and stillPaused/finalGeneration626 (JSON:117,185,387,400). This is a transient
diagnostic fixture, not the unchanged installed helper's cold acceptance seal.
Snapshot digests here are compared record fields; no full RAM re-extraction or
whole image/seed-tree rehash was repeated.

P2 — HELD for reached restoration/input. Fresh HELLO is generation 2; restore
reports full repair and no sound XRUN repair, with no `booting` state. Prepared
sound retains stereo/S16/48 kHz, 3840/1920 buffer/period, zero pending TX bytes/
transfers, release, XRUN, events, kicks and reset. Both pre-click host PCM samples
are locked/suspended with write/read indices and non-silent counts zero.

The new pointer ledger starts at zero and records exactly tablet-move sequence
1 followed by mouse-down/up sequences 2/3. The guest-rendered cursor matches
(684,392), not just a delivered host coordinate. Post-click output is unlocked;
pre-play producer is still zero. The raster baseline has zero keyboard events/
frames. Its ten new recorded DOM and guest-key edges are exactly P/L/A/Y/Enter
down/up, with DOM timestamps T0+835.670 through +894.135 ms. No mixed-origin
terminal `atMs` values were subtracted from page T0. Focus remains accepted and
canvas-focused, actual guest output occurs in that upper terminal, and final
held buttons are empty. This is not a new drag-release/no-stuck run.

P3 — HELD, actual new raster and completed playback. The pinned template file
and its embedded bytes equal the independently reviewed calibration. Baseline
upper ROI is [557,1253) × [39,239), exact matches `[]`; the later result is
exactly `(557,195)`, with new frame count 4→9 and no red marker. Independently
decoded both this run's prepared/failure PNGs, validated their cyan outline,
and cropped native canvas (80,84)/1280×800. The actual matcher independently
returns zero/one upper-band matches respectively. The old lower token remains
outside this ROI. No evidence image or template was edited.

Independently viewed the canonical failure PNG: two actual terminal windows,
newly echoed `play`, green `e5t26f-aplay`, the resident job-Done notification and
a fresh prompt are visible in the upper window. This is different from C's
earlier caret-only final frame. The older lower window still shows its prior
recovered 0.324-ms underrun; do not attribute it to this playback.

The only RAM replacement is the metadata printer. Frozen helper lines 145–168
still check the armed original PID and full observed identity before finite
feed, close FD3, and execute `wait "$e5_pid"`; only exit zero prints green.
The prepared text binds PID999/start27744, FIFO3, PCM4/owner999. Post values are
not freshly printed in this quiet variant: the unchanged guards, authenticated
restored fixture, new exact conditional output and visible job completion
support the same-child success claim. A raster alone would not prove it.

Completion PCM is producer 0→1440, read index1440, fill0, **1440 non-silent**,
maxAbs0.999969482421875, with actual guest output attached and running context.
Rendered frames increase 44133→238821; this sink counter alone would include
silence and is not the playback proof. The completion sample's based
`writtenFrames=1440` is distinct from the failure-state unbased ring inspection
window `writtenFrames=4096`.

## Unreached boundaries and conclusion

P4 — original cap FAILED, diagnostic reporting truthful. The legacy command
record is not rewritten to accepted; the separately labeled exact-raster result
is successful. Its raw area metric happens to be3922, but no 2000-pixel shortcut
supplies this result. `acceptance:false` and `normalRestore.checksPassed:false`
remain. The failure occurs before the normal post-restore coherence audit;
`coherenceAudit.status` remains `deferred` and receipt fields there remain null.
Do not conflate the earlier paused pre-reload audit with that unreached audit.
No drag phases, drag/second-round-trip restore, guest-release check, or complete
F success are recorded. The initial setup restore plus quiet reload are not
the task's later drag round-trip. Prior unchanged HELD evidence carries only
under its own established bindings.

The server capture contains only two favicon404s, no non-favicon HTTP failure;
the final normal browser-error audit is unreached, so no broader zero-error
completion claim is made. Duplicate `post-restore.*` captures were not needed
or used in place of the canonical failure record.

This closes the diagnostic oracle's actual-run observation: genuine quiet output
is recognized without substituting a bulk-pixel threshold, yet **4877.610 ms
still exceeds 2000 ms**. It demonstrates neither a speedup nor a dominant cost,
and does not authorize a default change, runtime optimization or timing waiver.

## Artifact SHA-256 ledger

Computed from actual files and mechanically rechecked; paths are repository-relative.

| File | SHA-256 |
| --- | --- |
| evidence/e5-t26f/resident-quiet-text-d3f34c5b/failure-post-restore-interaction-checks.json | e0d194f81af21d81266c193a61a9137c535d428be851bd1568c086f17b259cfc |
| evidence/e5-t26f/resident-quiet-text-d3f34c5b/failure-post-restore-interaction-checks.png | 8cd241a3fd4a6c58fc9a364980de1903432a678b20b39d04005b7f0f27f867fe |
| evidence/e5-t26f/resident-quiet-text-d3f34c5b/quiet-prepared.png | 753b2c1f04353e87872bc2f660c70b5828658d1a9c4d2ccbde1d0484c8ed58b1 |
| evidence/e5-t26f/resident-quiet-text-d3f34c5b/failure-post-restore-interaction-checks-server.log | e5a3b116ee677a3a2db9bc83668a5e6b087aa937722c6f08c6a12c157d2d65af |
| evidence/e5-t26f/resident-quiet-text-d3f34c5b.log | 2a719004df7d863f733a0b36954ef3b5d18725f1f3711467143ee5864c0d2b01 |
| tools/verify/e5-t26f-quiet-text-probe.mjs | da25bcd9268d5ad9408eb007d2fc8b6f4be35fee8633ac4c6ebf93cea2099d47 |
| tools/verify/e5-t26f-text-oracle.mjs | dc14730662600ff3cc978848065d86e431793258c00056c9ae0c3d326edc11ba |
| evidence/e5-t26f/resident-text-template.json | 58609c000193c8079fa21a408aef4d6dd7a7ad17fbc06d3e3f6bd02a6894e85e |
| tools/guest/e5-t26f-resident-aplay.sh | 2ae65408985f18be8b1287521bad23803282d652bb8f98421a135a351dac213c |
