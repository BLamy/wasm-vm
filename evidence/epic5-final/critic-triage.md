# Epic 5 final critic triage — 2026-09-07

This is bounded triage, not a verifier verdict. No runtime, task status, queue, or
deployment state was changed. Chromium-only final proof is assumed per the current
user direction; independent machines, WebKit, and host rr are waived. Existing
fresh-clone evidence is carried rather than repeated unless the final capstone itself
requires one exact-head clean build.

## Evidence identity and current blockers

- Current checkout HEAD is `683fb09d597a54ead898bd926f3f09cee22e3ee4`, with
  unrelated in-progress E5-T26h working-tree changes. It is not a frozen evidence
  head and must not be used to relabel older recordings.
- E5-T22g is independently verified. Its tracked evidence hashes recompute exactly:
  browser `f435ae02b64b1e4df87df84a4fc35a1b9ddbcb66fe09450018794752355ddb64`,
  desktop `0dcae8efd09f40bbc5e29a058ffdac6cd9f4020f3ffbf1826af82e74b9a5eb8d`,
  demo `4d79c86ecd6a41a664a91e670ca2d39bb2607efdba4e7d20337f613ea69ddbe4`,
  fresh-browser verifier `de1b0e3ec88b44861306e23ae2d2348b8f36006490c7c25e9d245a5af685a2d7`,
  and zero-time attack `bba44f4d3659abf601c395ac137b45d913c7dbb756b988796907dbf392f7aaf7`.
  No T22g rerun is needed if its runtime boundary remains unchanged.
- E5-T22c's `blocked_on: E5-T22g` is stale because T22g is verified. The valid
  post-T22g unprofiled desktop recording does not satisfy T22c: first matching
  frame times are 1878.89, 1501.98, 2128.86, 5267.67, 2746.01, 1774.20, and
  2221.27 ms; full-desktop times are 1955.79, 1538.76, 2988.99, 7832.91,
  2858.21, 1847.54, and 3287.14 ms. Four of seven modes violate both strict
  two-second checks. Functional mode/EDID/scanout/canvas, PID/client, overlap,
  marker, and zero-error observations remain useful held evidence, but no existing
  recording can clear T22c.
- E5-T25b's retained JSON/PNG hashes recompute as
  `8cd005bf639b7638548c18b38a0bb32938b2494b179797aa875ddc5bd70060f7` and
  `d81ba53cbe4146e0be05be40bbbd6c53d9f082910bb7595d32958301b718a059`.
  The artifact is producer head `a14bf545`, p50 4.3726 FPS, p95 5.1830 FPS,
  CV 11.321%, and has valid raw records/null rejection, but predates the
  stationary-window fix and contains no `windowBefore`, `windowAfter`, or checked
  displacement fields. The post-fix Chromium attempt stopped at `desktopReady`
  before Foot launch. Therefore it cannot clear T25b's remaining coverage gap.

## Smallest safe remaining gates

1. **T22c performance sentinel, then one strict run.** Do not repeat T22g. On the
   next performance candidate, use 2560x1600 as the cheap falsifier; it currently
   misses by the largest margin. Only after both first-frame and complete-desktop
   latency are below 2000 ms should one frozen-head Chromium
   `make verify-E5-T22c` run all seven modes. Acceptance is `gaps=[]`, with the
   already-established agreement/client/overlap/freeze checks still passing.
2. **T25b one post-fix Chromium baseline.** Once the separate browser worker restores
   `desktopReady`, record exactly one frozen/exact-head headed Chromium artifact:
   five 300-move drags, CV below 15%, nonzero drawn/guest/duration attribution,
   empty errors, null-sink rejection, and for every run retained pre/post titlebar
   geometry with correctly signed displacement of at least 100 px. Carry the held
   deterministic stationary/wrong-way and raw-record audits; no fresh-clone,
   Firefox, or WebKit repeat is needed. Consolidate DPR/busy/throttle stress into
   T25d/capstone instead of duplicating this long baseline.
3. **Do not confuse repeatability with the capstone target.** T25b's current 4.37 FPS
   p50 is repeatable but far below T28's hard 15 FPS requirement. T25d explicitly
   allows publishing a measured gap, so verifying T25d alone cannot satisfy T28.
   A bounded S performance-remediation slice (or an explicit user-approved change
   to the capstone threshold) is required before the integrated capstone run.
4. **One final capstone session after leaf tasks.** Reuse one clean exact-head build
   and one fresh Chromium profile for the final integrated type/hear/drag/clipboard/
   resize/focus run. Fold the audio-during-drag and DPR/throttle observation into
   that session. The 30-minute idle/resume/poweroff leg and snapshot-restore attack
   need explicit retained checkpoints; they cannot be silently represented by the
   currently required `<=3 min` “full demo” recording.

## Capstone/task-graph reconciliation required before activation

- E5-T28 depends on cancelled planning parent `E5-T25`, not its replacement leaf
  `E5-T25d`. It also exercises T22 resize and T26 restore without depending on the
  corresponding final leaves (`E5-T22d` and `E5-T26g`). If T28 is truly the final
  Epic 5 capstone, reconcile whether `E5-T27` must also precede it.
- E5-T28 is pending estimate `L`, has no `risk`, no verification command, and no
  approved decomposition. AGENTS.md forbids activating that shape. Split it into
  ordered S slices (script/default product; integrated Chromium recording;
  idle/resume/restore and final critic), or document an approved atomic exception.
- Its statement that every piece is individually verified is currently false:
  T22c/T22d, T25b/T25d, and T26h/T26f/T26g are not all verified. Its Chrome+Firefox
  criterion also conflicts with the current Chromium-only instruction and should
  be amended explicitly rather than informally waived.
- E5-T28 is an Alpine Level-5 capstone, not Omarchy publication. ROADMAP.md requires
  Epic 5 completion and stack merge before exporting the mutable prepared Omarchy
  qcow2. Add a separate hash-bound Omarchy export/chunk/browser/publication milestone
  before Cloudflare production; do not deploy the current Alpine artifacts under an
  Omarchy claim.

`python3 tools/check_task_policy.py` currently reports OK only because E5-T28 remains
pending and E5-T26h is the sole active lane; that does not validate T28's future
activation or its cancelled-parent dependency.
