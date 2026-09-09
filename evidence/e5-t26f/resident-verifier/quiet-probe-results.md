# Quiet probe C — bounded independent diagnostic review

Scope: closed C probe only; no F verdict, runtime edits, reruns, gates, status or
commit. Prior unchanged HELD evidence remains carried. The coordinator supplied
the outcome and corrected the prompt claim before this review; the following
checks are predictions before inspecting the raw record/PNG, not blind outcome
predictions.

## Prediction ledger

- P1: the scratch diff changes the printer in guest RAM on a copied checkpoint,
  not the installed helper. The ordinary identity/feed/close/same-child wait and
  original post-restore timing path remain; setup settlement precedes the new save.
- P2: the record must distinguish the original sealed snapshot from the new quiet
  snapshot, show matching quiet CRC and empty Prepared sound/fresh locked host PCM
  before the gesture, then actual physical `play` and positive fresh PCM.
- P3: the command finishes unsuccessfully at the existing pixel-area predicate,
  before the final interaction timestamp/cap. The PNG may show real green output
  without a final job notification/prompt; neither a two-second pass nor exact
  completion latency follows from the failure-capture timestamp.

## Results

P1 — HELD, diagnostic isolation. Independently hashed the actual scratch driver
to the advertised digest (ledger below) and compared it with the normal runner.
Its additions at lines 136–141 and 1698–1742 require resident reuse, reject other
diagnostic controls, physically define only `e5_print_observation(){ :; }`, and
save a new RAM state after guest cursor acknowledgment and 2,000 ms of **setup**
settlement. This is not a replacement for the original installed-helper seal.
The original `e5_play` still checks identity before feeding, writes finite PCM,
closes FD3 and waits the original child; green output follows successful `wait`
(`tools/guest/e5-t26f-resident-aplay.sh:145–168`). The source diff does not replace
those operations. Pre-identity text remains visible; suppressed post-identity
values are supported by the retained guards, not independently printed anew.

P2 — HELD for the reached observations, not the entire F sequence. In the failure
JSON, `milestones.run.binding` and the seed profile digest match the previously
held profile recording (excluding the separately named harness HEAD). The C run
uses a distinct `iteration-ozjy5a/profile`. Original CRC `940993e9` is explicitly
separate from the quiet snapshot CRC `a74f4503`; both quiet saved/restored hashes
are `1c57ab093c4da6d4f6270d8e05e7fdefa9f501cff7c0c531391532108b0b8994`.
The quiet snapshot is 2,847,892 bytes, generation 626. Frozen pre-reload audit is
paused/resume/626 at both endpoints; actual first present matches the quiet CRC,
fresh HELLO is generation 2, and there is no `booting` state (JSON:117,185,387,400).
The later full coherence audit remains deferred; do not claim C completed it.

The quiet sound observation is Prepared (`state=2`), stereo/S16/48 kHz,
3840/1920-byte buffer/period, with zero pending transfers/bytes, release, XRUN,
events, kicks or reset. Two post-restore, pre-gesture samples at T0+293.040 and
647.020 ms are locked/suspended with producer/read indices zero. The actual
guest cursor matches at T0+780.745 ms. Ten recorded key transitions exactly
match physically typed `play` plus Enter. Failure-state PCM advances producer
0→1440, read index 1440, with 1440 non-silent frames and maxAbs
0.999969482421875; output context is running (JSON:523,557,592,920,1010).
The unbased PCM accessor's `writtenFrames=4096` is the inspected ring window,
**not** 4096 produced frames. No first-PCM timestamp was collected here.

P3 — HELD, retained oracle failure. Independently viewed both PNGs. The failure
image has two actual terminal windows, newly echoed `play`, and green
`e5t26f-aplay` in the active upper terminal. It has a caret on the next line,
**not a final job-Done notification or shell prompt**. The older lower terminal
retains its prior 0.324-ms underrun and prompt; neither belongs to this playback.
Green is consistent with the retained same-child successful-wait branch, but is
not evidence of finished shell/prompt rendering.

The concrete failure is `visualDiffPixels=1154 < 2000`, despite
`terminalMarkerSeen=true`, no red marker, and `inputSequenceMatch=true`
(JSON:920; the error retains the same fields). The marker-only wait returns,
then `finishCommand` throws immediately at the pixel threshold
(`scratch:940,1271,1282`; `web/desktop-terminal.js:21,903,913–915`). This is not
a 120-second marker timeout and not an observed audio hang. Even the later
guest-focus confirmation is unreached because it follows `typeCommand`.

The raw T0 is `1027.4650000333786`; `postRestoreEnd` is **absent**. The final
cap at `scratch:1959` was never evaluated. Host phase logs span 10:37:12.572
restore-completion → 10:37:16.382 failure, exactly **3.810 s**, but that is not
the canonical interaction-end duration or a timestamp for when each guest event
first succeeded. It cannot establish a two-second pass, nor recover an exact
completion latency. The server capture has only the two permitted favicon 404s;
this failure record is not a completed final browser-error audit.

## Minimum legitimate timed smoke and performance direction

F's actual criteria require two real windows, restored visible text/cursor and
matching first-present CRC; then actual typed text, cursor movement, window
focus and successful gesture-triggered playback within the original two seconds.
They do **not** prescribe a wall of `/proc` output, a particular terminal window
size, a 2,000-pixel repaint, or a shell job notification/prompt after playback.

- A narrowly labeled latency smoke may omit repeating the later drag/second
  restore/coherence audits, profiler calls, metadata printing and bulky report
  collection. It must not claim those omitted paths were exercised. Existing
  unchanged HELD proofs stay carried; a changed fixture is still diagnostic.
- A quieter/smaller terminal is legitimate if two genuine windows remain and
  physical text actually renders in the focused guest terminal. Replace any
  size-dependent pixel-area heuristic with an explicit meaningful guest-text/
  completion oracle, reviewed before the next measurement. Do not merely lower
  a threshold to fit C, add filler text to inflate pixels, or accept a DOM/host
  key ledger, cursor repaint or old green patch as typed-text proof.
- Preserve identity/empty-stream anchors and the real physical gesture, finite
  feed, close and **same-child successful wait**. A fresh, guest-rendered success
  token conditional on that wait plus positive fresh PCM can prove completed
  playback without waiting for a subsequent shell prompt. First PCM alone still
  cannot. This needs no new privileged guest API or raw queue-status export.
- All required successful events must be observed against original restore T0
  and satisfy the unchanged 2,000-ms cap. Later screenshots/report assembly may
  document timestamped events, not substitute for missing timely observations.
  No clock reset, subtraction of post-restore work, or retrospective pass for C.

Concrete direction: decouple meaningful visible-text/completion proof from bulk
repaint before using a quiet workload as a timing screen. C shows that the
existing area heuristic rejects this visibly smaller output, not that printing
caused the prior latency. The new snapshot also follows extra guest execution,
setup typing and settlement, so comparing C directly with the original cold seal
is not an isolated printer-only timing comparison. There is no demonstrated
stable benefit and no reason from C alone to promote the transient RAM variant.
Prior functional HELD results remain unchanged; this probe remains negative.

## SHA-256 ledger

All file digests below were computed from actual bytes and mechanically rechecked.
Paths are repository-relative; evidence JSON line citations above refer to the
first entry. Snapshot digests above are the explicitly compared JSON fields,
not a claim that the entire saved RAM blob was re-extracted during this review.

| File | SHA-256 |
| --- | --- |
| evidence/e5-t26f/resident-quiet-probe-c-3174e1c5/failure-command-e5t26f-post-aplay-completion.json | 211126675b9ad83a5c333f22e43cfd3ec6d87c67c0d366e9aa9f75db0610d6c4 |
| evidence/e5-t26f/resident-quiet-probe-c-3174e1c5/failure-command-e5t26f-post-aplay-completion.png | 39321a88e7a89ab5dc921d182b2089edf3f5f44dc0b7e280794440ca7c342a69 |
| evidence/e5-t26f/resident-quiet-probe-c-3174e1c5/quiet-prepared.png | 753b2c1f04353e87872bc2f660c70b5828658d1a9c4d2ccbde1d0484c8ed58b1 |
| evidence/e5-t26f/resident-quiet-probe-c-3174e1c5/failure-command-e5t26f-post-aplay-completion-server.log | 8bf5dde4a91373fb28fb40199d61fa90ef247933c9c213823bdcaaf8b1b7e867 |
| evidence/e5-t26f/resident-quiet-probe-c-3174e1c5.log | b649b01eec073a38cc5eed6501902ece4ba7deb573fedc8934ed3099aa5df55b |
| tools/verify/e5-t26f-quiet-probe-scratch.mjs | 7b827daaf0815570bedbcf9af5683e56899c15d1c2b8d56b9d962fb076b5149f |
| tools/guest/e5-t26f-resident-aplay.sh | 2ae65408985f18be8b1287521bad23803282d652bb8f98421a135a351dac213c |
| web/desktop-terminal.js | abbd6e81176c4ea79cbb77c77886b2c7b39e8be32835acd3c9a13342fa10dc69 |

## Incremental native-raster calibration review

Independently viewed `resident-text-calibration-3174e1c5/native-canvas.png`.
Candidate `[1]`, rectangle **[115,187) × [355,368)** (72×13), visibly reads
**`e5t26f-aplay`**, including its green background, in the lower initial-playback
terminal. Candidate `[0]` is the different `e5t26f-shell-ok` token. The old
0.324-ms underrun is still visible above the playback token; this is prior
successful recovered playback, not a zero-XRUN assertion or new playback proof.

Offline decoding with the existing Playwright PNG library confirms native
1280×800 dimensions. Independently extracting the 3,744 row-major RGBA bytes
from the PNG gives byte-for-byte equality with `calibration.candidates[1].rgba`
and SHA-256 `868249728c21a50b44997f9a83499202dafaecdf6e07f345d08e8da8ab5294fc`.
An exhaustive exact-raster search over this PNG finds **one** match, at (115,355),
and none in the upper terminal content rectangle [557,1253) × [39,507).

The calibration source (`tools/verify/e5-t26f-text-calibrate-scratch.mjs:1698`)
restores the original snapshot and asserts CRC `940993e9`, pauses, reads native
canvas `getImageData`, and serializes that same canvas as PNG. Its candidate
selection uses green bands; it does not infer text. Actual metadata agrees with
the previously held runtime/image/helper binding and original snapshot digest;
reported browser/HTTP errors are empty. Independent visual reading supplies
the label, independent PNG decoding supplies the crop equality. No timed input
or new-image claim follows, and the deferred coherence audit is not relabeled.

**Calibration is suitable to pin before the diagnostic.** Freeze candidate bytes,
dimensions, SHA, source PNG and independently reviewed label; do not select or
relearn them from the later output. The upcoming runner must test absence on
its **actual post-restore, pre-`play` baseline**, not this calibration image.
Baseline and later full-template matches must refer to the same actual focused
upper window's content; the whole template must lie inside that ROI. Searching
the whole desktop would accept the known stale lower-window match. The absence
here only validates this calibration frame, not a future quiet snapshot.

This reviews calibration/provenance and the proposed design, not the matcher or
its future integration. Physical input, actual guest-visible text/focus/cursor,
fresh PCM, retained conditional wait and original deadline remain required.
No browser launched, implementation changed, or timed result inferred.

| File | SHA-256 |
| --- | --- |
| evidence/e5-t26f/resident-text-calibration-3174e1c5/native-canvas.png | f524daa892cdc6e79a4e6dfabe2a30f59345abfcb7648f73e1d4b92fca925fbe |
| evidence/e5-t26f/resident-text-calibration-3174e1c5/calibration.json | 4f3ed1b5e4908e2d30a35ddc402bfdb9d6d09738c6208564106af9c94c9c2800 |
| evidence/e5-t26f/resident-text-calibration-3174e1c5/server.log | c5fdabf29eece56db40b327002bc371a7086a27a12674c0160f1a21f4b09f4d3 |
| tools/verify/e5-t26f-text-calibrate-scratch.mjs | 6facda523e87a814c0f44762603b3aa421615add8f5d660853a48d31357e9b60 |
