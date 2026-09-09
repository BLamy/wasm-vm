# E5-T18e partial browser evidence audit — no task verdict

Scope: `cold-01` through `cold-12` and `warm-prime`, independently audited against
the predictions already recorded in `predictions.md`. The runtime/image/harness
candidate remains `9ed9e0d1c57daf64f6362193bc30b79482dd3258`; main is
`8de49f979b8b20595b871fcdb90f0af36af0116a`. No boot, build, or test suite was rerun.

## Results for the selected completed cases

- P-F1, initial binding — HELD. Recomputed the source-binding digest from the
  publication record. All 30 clone sources match; only the already reviewed
  playbook differs in main. All 14 runtime files match in both checkouts and
  their dist trees. A read-only `--check-publication` audit also hashed the full
  new 1-GiB image, both manifests, and all 8192 chunk positions / 823 objects:
  every value matches the v5 lock. See `partial-publication-check.json`.
- P-F2, selected contexts — HELD for 12 cold cases and warm-prime. All 13 bind the
  same publication and have matching completion markers in acceptance.log.
  The 12 cold records have cacheDisabled=true and zero reported HTTP cache hits.
  Warm-prime has cacheDisabled=false and zero hits, consistent with priming an
  empty context; warm reload remains unreviewed.
- P-F3, visual evidence — HELD for all 13. Verified all 26 PNG file hashes, decoded
  their 1280x800 canvas regions at screenshot origin (80,84), and independently
  reproduced all 26 recorded framebuffer hashes byte-for-byte. Each desktop PNG
  contains all 94 exact black/white cursor pixels at guest hotspot (480,160).
  Every Terminal PNG changes 344355 pixels from the preceding desktop capture.
  Accepted launcher checks, empty browser/presentation errors, nonfailed fetches,
  increasing retired-instruction counts, and distinct desktop/terminal guest
  digests agree. Original UART byte lengths match recorded output counts, and no
  fatal kernel marker was found. Guest-state digest validation does not claim an
  independent replay of guest memory.
- P-F4, partial timings — HELD as recorded measurements: 12 cold boots took
  816.430–841.236 seconds, mean 830.748 seconds; warm-prime took 827.701 seconds.
  These are partial measurements under concurrent load, not the final distribution.

## Independent screenshot inspection

The 26 screenshots form exactly four byte-identical groups, whose membership and
digests are recorded in `partial-first13.json`. The verifier visually inspected
all four representatives: `cold-01.png`, `cold-01-terminal.png`, `cold-02.png`,
and `cold-02-terminal.png`. Both desktop variants show patterned wallpaper, the
dark top panel, the Terminal launcher, and the arrow. Both terminal variants show
the foot title bar, window controls, dark client body, and a visible shell prompt.
The differing guest clock text accounts for the two visual variants.

## Coverage and outstanding proof

In `tools/verify/e5-t18e-desktop-bringup.mjs`, the input/rebuild path (73–93),
context/cache setup (126–138), captures (140–153), and successful desktop/cursor/
Terminal path (160–198) have direct evidence. The read-only publication CLI path
(14–17) was independently exercised. Publication rejection branches are covered
by the retained mutation tests; the newly recorded main-head unit log reports
23 passed, zero failed/skipped. Its digest is bound in `partial-first13.json`.
Failure-only screenshots/logging (200–204) are waived as diagnostic output with
no additional runtime behavior or successful-boot claim.

NEEDS EVIDENCE: cold-13 through cold-25, warm-reload, the final 27-case aggregation,
final timing summary, end-of-run source/runtime/publication check (220–238), and
completion/cleanup. Those are not inferred from the first batch. The final report
is not adjudicated in this partial audit. No verdict, status, queue, or commit
change was made. All unchanged T18a-d and documented drill results carry HELD.

`partial-first13.json` preserves per-case JSON, PNG, framebuffer, guest-state and
UART digests plus exact acceptance-log line citations. Subsequent review can carry
these results forward when those digests and their source boundary are unchanged.
`audit-completed-cases.mjs` is the read-only audit command; it accepts the clone
directory followed by the explicit completed case labels.
