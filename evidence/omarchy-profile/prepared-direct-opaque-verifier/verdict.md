VERDICT: refuted

The required coherent prepared pair was not produced. R1 independently proves
the direct-property readback and a fresh rendered Foot frame, then fails while
saving the snapshot. Those successful preparation findings remain HELD for
incremental work. They do not prove responsiveness or admit a candidate.

## Evidence identity

- Frozen implementation: `32c412f7ea0fe34d1b2f9f28ace3004a1ed64fad`.
- Authoritative run: `evidence/omarchy-profile/prepared-direct-opaque-r1/`.
- Report SHA-256: `abc4f6e07166f2569b6e619e4556844897f53fc432a40571ba683e2432d7a771`.
- Parent receipt SHA-256: `ee23a92b51da6172a888e3e2ed326268cdc91057411597c6050bb31d51ca7727`.
- Worker seal: 15 files, `prepared-direct-opaque-gates/sha256.txt`, index
  `22917f60a59d5825e0afd9bfd6ffde22f58bcec34e70b6c3c9ebead547b1b0bb`.
- Predictions were written before R1 evidence and included at the frozen head.
  Independent source, raw-wire, PNG and seal audits pass. The independent pair
  byte parser was not run: the private pair directory is empty.

## Findings and HELD matrix

- **P1 — HELD.** All 28 recorded helper identities match frozen Git blobs and
  local bytes; all 93 served-resource receipts match their actual source.
  R3 source bytes, WASM `1bc72852…`, cap256, recyclingOFF, ICount64 and original
  geometry are unchanged. No runtime/web/Cargo diff exists from the carried
  runtime parent. Citation: `source-audit.json`, `run-audit.json`.
  **Demand:** carry these exact identities; recheck only a changed boundary.
- **P2 — HELD.** Input-ignore is acknowledged at `05:22:44.837Z`, before the
  first page request at `.841Z`. Raw recording contains zero input events,
  no keyboard/tablet/mouse/agent send, one original `setDisplay(1280,800)`,
  one layers query and one direct batch. Citation: report lines 1913, 26569;
  `run-audit.json` independent serial reconstruction and worker-call inventory.
  **Demand:** retain the fence and no-input boundary for any replacement run.
- **P3 — HELD.** The actual single batch's framed wire completes at
  `05:24:47.324Z`: eight `ok` acknowledgments, then
  `true,true,1,1,1,true,true,true`, then the mapped visible active Foot JSON,
  exit0. This takes 60.290s from serial send. Report fields equal those bytes;
  no extra active-window query occurred. Citation: report line 27292;
  `run-audit.json` serial entry 1, reconstructed from `workerTraffic` rather
  than trusting the worker parser. **Demand:** carry the R1 readback finding.
- **P4 — HELD.** Foot `0x55555eb73630` is mapped, visible and not hidden at
  `[12,38]`, size `[1256,750]`. Canvas2D is 1280×800; native allocation is
  1280×832 with original 1280×800 guest rectangle. Citation: report lines
  26923, 27303; independent image decoder in `prepared-image.json`.
  **Demand:** retain this original geometry and native terminal-interior ROI.
- **P5 — HELD.** Post-response baseline at `05:24:47.326Z` is 5 received /
  5 presented. The qualifying state is 6/6, 6 drawn, zero replayed frames.
  It is captured at `05:32:48.176Z`, 480.850s after baseline. The real prepared
  PNG is personally inspected: dark Foot window with an empty shell prompt.
  Independent PNG decoding finds 486 bright pixels / 74 colors in ROI
  `[24,48,312,93]`, exactly matching the recorded native gate. Image SHA is
  `97fc180d4d35c68ca5941dc591afb315220550165469f3c4ead7827989cc2f3f`.
  Its pixels equal the initial prompt image, while the independent frame
  counters establish a new received/presented frame; changed pixels were not
  the criterion. Citation: report lines 537, 26984, 26993, 27047;
  `prepared-image.json`. **Demand:** carry this R1 freshness/image finding.
- **P6 — HELD.** Preparation has one deadline `05:37:44.836Z`, exactly 900s
  after navigation start. The prepared image completes after 603.340s.
  Export starts `05:32:48.176Z` with deadline `05:35:48.176Z` (180s), fails
  1.684s later, and owned cleanup closes by `05:32:50.077Z`; no watchdog
  extension or late success. Citation: report lines 26564, 27285, 27368;
  parent `run.json`. **Demand:** retain the fixed phase deadlines.
- **P7 — FAILED for required export; fail-closed subcriterion HELD.**
  `workerTraffic[1930]` sends `snapshotSave` at `05:32:48.250Z`, after pause
  and two zero-pending persistence samples. `capturePair:1048` throws
  `Uncaught RuntimeError: unreachable`; two guest-error events record that
  trap. There is no `exportFinishedAt`, pair receipt, seeded-store selection
  or output file. `target/omarchy-direct-opaque-r1` is private0700 and empty.
  Citation: report lines 26357, 27351, 27367, 27424;
  `export-failure-audit.json`, `final-audit.json`.
  **Demand:** diagnose and repair the snapshot-save failure, then record the
  required complete coherent pair under the same acceptance boundaries.
- **P8 — HELD for result/admission; one overbroad subprediction FAILED.**
  Parent result is `preparation-failed-input-untested`, `usablePair:false`,
  `keyboardAcceptance:false`, exit1 with normal owned closure. No candidate,
  responsiveness or release is admitted. The original prediction's phrase
  “no … accepted fresh image” was overbroad: a later export failure can retain
  a valid earlier image. That is a verifier prediction error, not a product
  defect; P5 remains HELD. Citation: `run.json`, report lines 537, 27366.
  **Demand:** preserve both the valid image fact and the negative final result.
- **P9 — NEEDS EVIDENCE for positive export completion.** The real run executes
  new preparation through snapshot-save failure and the negative classifier.
  Positive completion/status and parent pair validation have synthetic
  control-flow coverage only. The exact hunk map and narrow demand appear in
  `coverage.md`. **Demand:** after repair, cover real export completion and
  independently inspect complete snapshot/delta bytes; do not restart
  unrelated HELD runtime/direct-property/ROI/fence checks.

## Bounded attacks and limits

The actual preparation helper and browser pixel callback reject a synthetic
nonblank frame5 against post-response baseline5, with no screenshot/export.
A frame6 control passes only as synthetic evidence (`stale-frame-attack.log`).
The exact positive wrapper also rejects a foreign delta generation8 against
snapshot7 despite correct recomputed hashes (`postprocessor-fixture.json`).
Seven owned-wrapper controls cover failure/cleanup boundaries. The frozen
worker submission contains 67 passing affected tests plus two syntax checks.
No verifier guest/browser launch, heavy build, deployment or cold clone ran.

The startup progress path `latest.png` is deliberately reused. Its first
05:22:46.881 observation is overwritten and cannot be personally re-inspected;
it is not acceptance evidence. The last per-path progress hash and both unique
prepared/failure image hashes match. `audit-run.py` records this explicit
limitation instead of treating the obsolete progress digest as a current file.
The later failure PNG is uniformly dark RGB15, zero bright ROI pixels,
SHA `99e841eafe74fa9581294d17177df857321e9a9f381502367c43520c829cd7f3`;
it does not erase the earlier successful frame or establish a usable pair.

The source calls the intended API: `__snapshotSave` → controller `snapshotSave`
→ `persistSnapshot` → `save_resume`. The record lacks the original Rust
panic/allocation stack, so it does not establish a specific trap cause or a
harness-only correction. Merely increasing the export deadline would not
address the observed immediate trap.

SUITE: retain existing affected tests and the explicitly synthetic verifier
controls. No successful-pair promotion until the refutation is resolved.
The parent owns task lifecycle and Git; this verifier changed no implementation.
