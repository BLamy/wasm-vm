# Quiet-text diagnostic — independent preflight

Scope: new diagnostic runner and pinned raster, compared with unchanged quiet C.
No runtime edits, browser run, task status, queue or commit. Prior unchanged HELD
results carry. Matcher factory `tools/verify/e5-t26f-text-oracle.mjs` was absent
at initial inspection, so complete integration preflight remains pending.

## Predictions before bounded offline checks

- P1: pinned template bytes/hash/label must equal the independently inspected
  calibration candidate, never be learned from timed output.
- P2: baseline and later search must isolate the actual upper window. Suspect
  the newly reused generic `detectWindowChrome()` merges these overlapping
  windows and includes the old lower token; test on the real calibration PNG.
- P3: native exact matching must reject stale/partial/all-green/wrong glyphs and
  out-of-ROI locations; factory implementation/coverage still awaited.
- P4: keyboard checks, raw records, finite playback and original T0/cap must
  remain independent of the removed aggregate pixel-area predicate; only the
  diagnostic path may claim its separately identified raster result.

## Initial blocking finding — R1, upper-window isolation fails on the real fixture

The new runner calls `window.__desktopCursor.detectWindowChrome()` at lines
1309 and 1339. That existing generic detector uses dominant body edges across
overlapping windows (`web/desktop-cursor.js:116–154`), not the F-specific upper
window geometry. Running its actual extracted code offline on the independently
reviewed native calibration PNG returns:

```json
{"window":{"left":115,"top":13,"right":1253,"bottom":745},
 "titlebar":{"left":115,"right":1253,"top":13,"bottom":39}}
```

Consequently the runner's search region is **[115,1253) × [39,745)**. It fully
contains the exact old token at **[115,187) × [355,368)**. The source-reference
exclusion expression at lines 1325–1328 evaluates **false**. A correct exact
matcher must find that stale token, so baseline absence at line 1324 fails even
earlier. This is a fail-closed blocker, not an observed false acceptance.

Rechecked separately on the retained C `quiet-prepared.png`: independently
validated its cyan outline coordinates, extracted native canvas (80,84)/1280×800,
and ran the same actual detector. It returns the identical merged bounds, and
the old lower token remains byte-for-byte equal to the pinned raster there too.
Thus this is present on the quiet prepared fixture, not just a synthetic example.
The critic's first recheck assumed the older screenshot's y=85 crop; its outline
assertion failed before testing geometry. Reading this actual 1440×1145 PNG's
outline rows (80/81 and 886/887) corrected the crop to y=84. This was a critic
coordinate-assumption error, not a worker/runtime finding; the corrected check
above passed without changing any evidence pixels.

**Required narrow correction:** derive and retain an actual upper-window-only
content ROI using the F-specific topmost geometry, and check that same window
through the observation. Keep baseline absence/reference exclusion intact.
Do not enlarge accepted stale content, mask the known token, alter production
geometry, or weaken the matcher to get past this finding. Cover this exact
retained-image case before a timed browser run.

## Other preflight dispositions

- P1 — HELD. Independently decoded the pinned base64: exactly 3,744 bytes,
  identical to calibration candidate `[1]`, with the reviewed SHA and 72×13
  dimensions. Source JSON and PNG digests also match their actual files.
- P2 — FAILED as R1 above. No browser run required to reproduce it.
- P3 — NEEDS INSPECTION. Imported `e5-t26f-text-oracle.mjs` was not yet present;
  matcher semantics, factory serialization and its coverage are not reviewed.
  This is expected work in progress, not a separate implementation refutation.
- P4 — static scope retained. Compared the entire delta against quiet C: the
  resident/reuse-only guards, same RAM printer override, prepared-sound/fresh-zero
  checks, physical `play` at 5 ms, common PCM checks and original final cap are
  unchanged. A separate raster result replaces the area predicate; old command
  records are not rewritten. Full integration disposition awaits the factory
  and corrected ROI. This is not F verification or acceptance authorization.

## Incremental correction and bounded matcher review

The coordinator corrected the runner during preflight. The initial runner SHA
was `673e20fd53b1041353c806b2223d55c59c2aa18a9274c516dd31c8c67d8c9896`;
the corrected reviewed SHA is listed below. The original finding and failed
critic crop assumption are historical observations, not findings against the
corrected source. No prior unrelated HELD proof was rerun.

**R1 — CLOSED for the corrected code.** The runner now serializes the existing
self-contained `readTopmostDragTitlebar` into the page, takes its horizontal
edges and the first 200 client rows, and compares the same titlebar while polling
(`quiet-text-probe:1309–1314,1340–1341,1591–1592`). This is an explicit client
band, not a claim to recover the full window body. Using its actual extracted
helper and the serialized matcher on retained, unmodified source pixels gives:

| Retained frame | Actual titlebar | Actual search ROI | Exact matches |
| --- | --- | --- | --- |
| calibration native PNG | [557,1253) × [13,39) | [557,1253) × [39,239) | none |
| C quiet-prepared native crop | same | same | none |
| C failure native crop | same | same | (557,195) only |

The lower reference at (115,355) is outside both horizontal and vertical bounds.
The last row above only tests the new oracle on a historical image; it does not
retroactively accept C or give the new oracle a browser observation timestamp.

**P3 — bounded module checks HELD.** Read all 105 module lines and all 231 test
lines. `node --test tools/verify/e5-t26f-text-oracle.test.mjs` independently exits
0: 17 passed, 0 failed/skipped. Coverage includes all RGBA channels, wrong glyph,
solid/cursor patterns, clipped/shifted/overlapping occurrences, mandatory bounded
ROI, malformed geometry/storage, detached owned bytes, match overflow and fixed
work limits, plus factory serialization without external imports/globals. The
reviewed real template matches an artificial blit; that test is honestly labeled
as synthetic, not browser acceptance. The separate real-frame checks above close
the immediate calibration/ROI applicability question.

Bounded novel/sabotage check: mutate the last RGB byte of a copy of the pinned
72×13 raster (neither fast-reject anchor). The real matcher returns `[]`. Delete
only the full row/pixel comparison from an **in-memory** factory copy: a single-
candidate ROI returns `[{x:0,y:0}]`, and the negative assertion fails. The first
larger-frame sabotage attempt instead hit the retained match-overflow guard;
the single-candidate check isolates the intended full-raster obligation. No
source file, recorded PNG, or pinned template was modified.

**P4 — static boundary HELD; caller integration coverage pending.** Exact ten
DOM/guest-key edges, new-frame/unchanged-titlebar checks, fresh baseline absence,
one full match, focus/no-new-red checks and independent returned oracle identity
remain in the corrected caller. Its legacy command record is not marked accepted
or rewritten. The original T0/common PCM/final 2,000-ms cap path is unchanged;
oversized resource waits cannot make the cap pass. User-owned caller-integration
tests are still being added and have not been claimed as independently executed
here. No additional code blocker found in this reviewed revision. No timed run,
full diagnostic success, performance improvement, or F acceptance is inferred.

## Current reviewed-byte anchors

These identify the inspected in-progress revision; subsequent changes require
only scoped rereview. All file digests below were computed from actual files.

| File | SHA-256 |
| --- | --- |
| tools/verify/e5-t26f-quiet-text-probe.mjs | da25bcd9268d5ad9408eb007d2fc8b6f4be35fee8633ac4c6ebf93cea2099d47 |
| evidence/e5-t26f/resident-text-template.json | 58609c000193c8079fa21a408aef4d6dd7a7ad17fbc06d3e3f6bd02a6894e85e |
| web/desktop-cursor.js | 680545225f533b51a62fb8cd655f9870fac7af3ca54a9b5dbbe561e42cc38380 |
| evidence/e5-t26f/resident-text-calibration-3174e1c5/native-canvas.png | f524daa892cdc6e79a4e6dfabe2a30f59345abfcb7648f73e1d4b92fca925fbe |
| evidence/e5-t26f/resident-text-calibration-3174e1c5/calibration.json | 4f3ed1b5e4908e2d30a35ddc402bfdb9d6d09738c6208564106af9c94c9c2800 |
| evidence/e5-t26f/resident-quiet-probe-c-3174e1c5/quiet-prepared.png | 753b2c1f04353e87872bc2f660c70b5828658d1a9c4d2ccbde1d0484c8ed58b1 |
| evidence/e5-t26f/resident-quiet-probe-c-3174e1c5/failure-command-e5t26f-post-aplay-completion.png | 39321a88e7a89ab5dc921d182b2089edf3f5f44dc0b7e280794440ca7c342a69 |
| tools/verify/e5-t26f-text-oracle.mjs | dc14730662600ff3cc978848065d86e431793258c00056c9ae0c3d326edc11ba |
| tools/verify/e5-t26f-text-oracle.test.mjs | d30b4d2b95ab472aa525e4325b53bcd34309c77551f5fa4bd5a114a0418932ae |

## Incremental caller-regression review

Read all 258 lines of `tools/verify/e5-t26f-quiet-text-probe.test.mjs`. Runner
and matcher digests remain exactly those above. Independently ran only
`node --test tools/verify/e5-t26f-quiet-text-probe.test.mjs`: exit 0,
**11 passed, 0 failed/skipped**. No browser launched and no active browser record
or new profiler record was inspected.

These tests execute the extracted actual caller, physical-typing helper,
titlebar detector, serialized matcher and admission guards. The real calibration
PNG supplies the stale lower token; later success frames are explicitly artificial
blits. Negative cases exercise wrong/mirrored and partial rasters, old-token-only
frames, stale baseline before typing, unadvanced frames, missing/moved titlebar,
duplicate matches, missing/reordered input edges, focus loss, and a new red marker
despite exact green output. Failed raw sequences survive without a success result.
The fixture refuses calls to the old area-based command finisher. No expected
callback success object is substituted for the actual matcher/caller result.

Limits are honest: the test supplies keyboard events, focus state, a synthetic
clock and three fake polls. It proves predicate behavior, not actual guest input,
focus, audio, process completion or browser latency. Its clock test invokes the
extracted literal cap at 2000/2000.001 ms and checks source placement of original
T0/end/gesture ordering; that is not an executed end-to-end timing trace. Unchanged
PCM and same-child-wait evidence remain carried, not re-proven by this file.

**P4 caller-predicate coverage — HELD.** The previously pending focused caller
tests now cover the changed boundary. No new actionable blocker found. This
closes the code/test preflight only; actual browser functional/timing disposition
awaits the closed record. No successful run or F acceptance is assumed.

| File | SHA-256 |
| --- | --- |
| tools/verify/e5-t26f-quiet-text-probe.test.mjs | 99f69785b98b661760cd586e147e55544d76aa1576bfabd9f9aa535c2be1ccec |
