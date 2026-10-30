---
id: E0-T29
epic: 0
title: Launcher and workspace on the shared interface — one obvious start, advanced behind disclosure
priority: 0.2
status: in-progress
depends_on: [E0-T28]
estimate: S
risk: medium
capstone: false
---

## Boundary

Second slice of the site redesign (parent E0-T31). **Source (re-opened 2026-10-30):** the PR 626
stack (`c396efe1e`) plus the verified E0-T28 foundation (`bfa710ee8`), on branch
`codex/ui-redesign-workspace`. The old-main delta is re-applied here and must be re-proven; the
old-main text below still describes the launcher/workspace intent, and the 626 additions follow.

### PR 626 integration (what this source adds to the boundary)

626 ships E9 time-travel and session controls in `web/index.html`, owned by
`web/session-timeline.js`, `session-timeline-runtime.js`, `session-library.js`, `session-bundles.js`
and related modules: `#session-timeline` (`[data-timeline=…]`: saved recording select, open,
refresh, record sample/file example, stop, bundle export/import/file/cancel/delete, scrub range,
exact transition text (20-digit decimal string), seek/back/forward/play/pause, branch
create/run/pause/save/discard/live/input/send, keyframe and event selects, replay console, digest,
status), `#session-library` (`[data-session=…]`: input recording, checkpoint guest, GPU desktop,
checkpoint/stop/retry/resume/gpu-capture, session/point selects, open/refresh, rename form, storage
limits, persist/cleanup/delete, status), and thirteen self-check panels (`#event-clock-panel`,
`#network-capture-panel`, `#witness-pages-panel`, `#gpu-history-reader-panel`,
`#gpu-journal-stream-panel`, `#owned-http-panel`, `#unrecorded-control-panel`,
`#session-replay-panel`, `#streamed-replay-panel`, `#session-keyframe-panel`,
`#session-seek-panel`, `#device-completions-panel`, `#time-entropy-panel`,
`#input-recording-panel`). This slice:

- moves recordings/time travel and saved sessions into an optional library **Recordings** pane,
  progressively organized, and the self-checks into an optional **Checks** pane (or the
  Diagnostics area), both closed at first load — no recording/configuration wall at startup;
- builds those panes from library controls that operate the native controls (value + real
  events, presses), so the native controllers keep owning state, actions, disabled/error states,
  privacy/offline/qualified-GPU restrictions and confirmations; option values, file-input and
  form-submit semantics and the transition's decimal string are passed through unchanged;
- hides a native widget only where its working library equivalent exists; runs no expensive
  check just to restyle it;
- removes the launcher's leftover blue gradient/system font and the header version wrap, keeps
  the foundation's warm header with the autoplay notice hidden, and restores the Settings → Sound
  readout of `#audio-autoplay-badge`;
- keeps the foundation's Case studies entry and new-tab help from the app;
- satisfies the carried phone terminal-focus criterion below with an ordinary tap.

No Rust, artifact, schema, recording-format or controller-semantics change.

What the main-based app ships today, and what this slice changes:

- **Launcher** (`#os-launcher` in `web/index.html`, driven by `web/main.js`): four native guest
  buttons (`[data-os]` Omarchy, Alpine + Node.js, Alpine, BusyBox) with equal weight, a native
  "Desktop graphics" select above them, and a status line. Replace the visible launcher with a
  library island: one primary **Start Linux** action that starts BusyBox with no configuration,
  a one-line explanation, and Alpine + Node.js, Alpine and the Omarchy desktop as secondary
  choices with honest capability/download notes. Omarchy's graphics choice moves into its own
  settings. Show real start status, errors and a retry path. Nothing large downloads until a
  guest is chosen; the existing `?guest=` query contract keeps working for later homepage CTAs.
- **Workspace** (`#ide-root`, built by `web/ide.js`): an emoji activity bar, a file/container
  sidebar, an always-visible editor area and display pane above a 280 px terminal, a terminal
  bar of keyboard/pointer/microphone debug chips, and a blue status bar whose Network item opens
  a popover of native provider fields. Make the terminal (or the display, when chosen) the main
  content; open Files, Containers and the editor on demand; move keyboard/pointer capture and
  counters into an Input sheet and network provider settings into a Settings sheet built from
  library controls; keep display/terminal choice discoverable with an honest note when no guest
  frame exists. At 360/390 px secondary panes are closed by default and open as full-size panes
  with a way back; the terminal keeps full width; ordinary tap targets are at least 44 px,
  including the shared header Menu and nav.

Engine contract: every runtime id, `data-*` hook, event and test hook that `main.js`, `ide.js`
and the specs use keeps working. Native controls stay in the DOM as the engine's inputs; library
controls operate them (value + real `change`/`click`), so persistence keys and credential
handling are unchanged (one-time secrets are never persisted or put in a URL). xterm, the guest
canvas and the legacy file/container/editor DOM stay outside the `.wv-ui` isolation guard. Under
`?testHooks` (`html.e2e-showall`) the legacy activity bar, terminal-bar controls and status bar
stay visible for the core suite. No change to keyboard/pointer capture, storage, networking,
CPU/JIT or guest restore semantics. No Rust changes.

## Deterministic acceptance

`bash tools/verify-ui-workspace.sh`. It reruns `tools/verify-ui-foundation.sh`, then drives the
real UI in Playwright (`web/tests/ui-workspace.spec.js`, `PW_DISABLE_TS_ESM=1`):

- desktop and 360/390 px: the first view has one primary action and no horizontal overflow;
  pressing **Start Linux** boots the real BusyBox guest and a typed
  `printf 'ui-%s-%s\n' ready 42` prints `ui-ready-42` in the terminal;
- secondary guests show honest availability; Omarchy's graphics choice reaches
  `#desktop-graphics`; nothing heavier than the launcher loads before a choice;
- Settings sheet: provider-conditional fields appear per provider, values persist through the
  existing key, secrets are not persisted, focus returns to the trigger; after closing it and
  after a Terminal → Display → Terminal round trip, keyboard input still reaches the guest;
- Files/Containers/Editor open and close (side panes on desktop, full panes on phones) and the
  terminal regains full width; tap targets ≥ 44 px at phone widths;
- zero browser errors.

Also run once at the frozen head: the in-browser RISC-V suite to its current total with zero
failures (screenshot of the pips), the affected existing specs, `make web-build` and
`tools/build-web-dist.sh`. Evidence in `evidence/ui-redesign/workspace/`.

Carry-forward from the E0-T28 latest-source review: at 390 px, boot a real BusyBox guest,
write a unique guest-file marker, keyboard-activate **Case studies** in the phone menu, close
the new page and dismiss the menu. An ordinary tap on the terminal must focus the actual
xterm textarea, and trusted keyboard input must read the preserved marker. Do not call
`wvmDemo.focusTerminal()`, `locator.focus()` or another programmatic focus helper to make that
return path pass. Preserve the same guest/controller/session; this phone-focus criterion is
required before the combined mobile grade.

## Adversarial verification

Medium risk. Attack: (1) find a runtime id/hook referenced by JS or a spec that the new markup
lost or detached from its handler; (2) boot, open and close each sheet, switch views, and confirm
keyboard input still reaches the guest and library overlays never forward keys to it;
(3) confirm a library control really operates the engine (provider persistence, Tailscale
login/logout status, graphics choice) rather than local state; (4) at 360 px, operate every
moved control and measure tap targets; (5) confirm the isolation guard does not touch xterm,
the canvas or legacy pane DOM. One bounded novel attack of the verifier's choosing.

## Verification log

### 2026-10-30 — fresh foundation verifier — terminal return carried into this slice

On foundation product `9347dd4bc`, real phone Case studies keyboard navigation preserves the
BusyBox controller, session generation 1, document, IDE and guest file. However, after popup
close → return → Escape → ordinary `#term` tap, focus stays on Menu and typing emits no serial
echo. `web/terminal.js` is byte-identical to PR626 (SHA-256
`fca4f0c080aad34b5d38121ffe9160275869a279f98fa28a20f6ea1c27b55eae`).
The foundation's focus-only API makes subsequent trusted `cat` return the preserved marker,
which proves machine survival but does not satisfy ordinary phone interaction.

Receipts: `target/ui-verifier/foundation-626/first-phone-real-guest-nav.{json,zip}` records
the initial failure; `phone-real-guest-nav.json` records Menu focus after the tap, actual xterm
focus after the explicit helper, and successful `foundation-survival-626` readback. The
promoted `web/tests/ui-foundation-guest-navigation.spec.js` isolates navigation survival with
explicit focus; this slice must add or strengthen the normal tap proof above on the latest
source. No terminal implementation was changed by the verifier; this is not a final waiver.

> **Historical, old-main source.** The worker/verifier entries below this note, through
> "r3 — VERDICT: verified", were recorded on `05fa92c82` + the old foundation (`78124cf53` →
> `f221fb166`), before the PR 626 stack. They and `evidence/ui-redesign/workspace{,-r2,-r3}/` are
> kept as history (by digest) and do not verify the latest-source integration.

### 2026-10-30 — worker — implemented, submitted for verification

Frozen implementation head: `2b9f97c11` (one commit on the verified foundation `78124cf53`; the
task-start commit is `a32bb18a5`). Evidence: `evidence/ui-redesign/workspace/` (`HEAD` names the
head; `SHA256SUMS` covers every file). Changed source (19 files, digests at that head):
`changed-source-sha256.txt`; full name/status list: `changed-since-foundation.txt`; shipped dist
digests: `dist-sha256.txt` (`sw.js` version `380123f9787d`).

What changed:

- **Launcher** (`launcher.jsx`): one primary **Start Linux** (BusyBox, no configuration), a
  one-line explanation, Alpine + Node.js / Alpine / Omarchy as secondary rows with download and
  GPU notes, Omarchy graphics behind a library **Desktop settings** disclosure (default
  untouched), real start errors (first line of main.js's message) with **Try again**. It presses
  main.js's own `[data-os]` buttons and writes `#desktop-graphics`; those natives stay in a hidden
  `.os-launcher-engine`. `main.js` gains one line: `data-launcher-ready="true"` after it binds the
  buttons, so a press made during manifest probing is delivered rather than lost.
- **Workspace** (`workspace.jsx`): guest name/state and boot progress, Terminal/Display
  Segmented, Files/Containers/Editor toggles (phone: a Tools sheet and full-size panes with
  **Back**), a Settings sheet with keyboard/pointer/terminal controls and network providers
  (`network-settings.jsx`, provider-conditional fields bridged to main.js's inputs with real
  `change` events; secrets are never persisted), and a first-use hint until the first Enter.
  Layout is data attributes on `#ide-root` read by grid CSS in `index.html`; no engine node moves.
- **Tool panes** (`projection.jsx`, `tool-panes.jsx`): ide.js's file tree, transfers, container
  pane, editor tabs/toolbar and container exec controls are re-rendered as library List rows,
  Buttons, Switches and TextFields that click/write the native nodes; the natives are hidden in
  the ordinary app and unchanged under `?testHooks`. On BusyBox, Containers shows a short panel
  (no runtime; restart into Alpine via the `?guest=` contract) and no longer starts ide.js's
  serial probe. ide.js gains a native **Refresh** for the file tree (calls its `loadTree()`).
- **Terminal focus**: the guest pointer bridge (`src/input/pointer.js:608`) cancels the
  pointerdown whose mousedown xterm uses to take focus, so once anything else had focus the
  terminal could not regain it by click (reproduced on the untouched `?testHooks` layout).
  `ide.js` now focuses the terminal on pointerdown in its pane; pointer forwarding and the capture
  policy are unchanged. Also: xterm FitAddon padding fix, legacy palette/theme retone, ≥44 px
  phone targets including the shared Menu/nav.

Commands at the frozen head:

- `bash tools/build-web-dist.sh` (runs `make web-build`) — exit 0, reproduced the committed
  `web/dist` exactly (`build-web-dist.log`).
- `bash tools/verify-ui-workspace.sh` — PASS, exit 0 (`verify-ui-workspace.log`): the full E0-T28
  foundation acceptance (static checks, deterministic digest `13b23c8c…`, 28 library modules,
  12/12 Playwright) plus 8/8 workspace cases:
  first view at 1280/390/360 px (one primary action, nothing heavy fetched, no overflow,
  phone targets ≥44 px); Start Linux → real BusyBox → `printf 'ui-%s-%s\n' ready 42` prints
  `ui-ready-42`; hint shown then gone; no visible native button/input/select outside the library
  in the app panel; Settings provider fields (WebSocket/Tailscale/Headscale/wvrelay/offline)
  write the native inputs and the existing persistence key, auth key never stored, real
  Tailscale **Log in** status and **Log out** clearing, focus back to Settings, sheet text never
  reaching the guest, then `expr 6 \* 7` → `42`; Display ↔ Terminal round trip then
  `view-42`; Files: create a file in the shell, **Refresh**, open it, edit, library **Save**,
  guest `cat` shows the edit; BusyBox Containers panel with restart links and zero console
  bytes written; side pane narrows and restores the terminal width; phone 390/360 Tools →
  Files pane → **Back** (focused) → command output; Desktop settings disclosure by pointer and
  keyboard reaching `#desktop-graphics`; a forced start failure shows the error and **Try
  again** boots for real.
- Same spec with `--trace on`: 8/8, traces in `traces/*/trace.zip` (`ui-workspace-traced.log`).
- `node evidence/ui-redesign/workspace/riscv-suite.mjs http://localhost:8233 …` — the in-browser
  riscv-tests suite through its real **Run tests** button: **127 passed, 0 failed**, zero
  browser errors (`riscv-suite.json`, `riscv-suite-pips.png`, `riscv-suite-trace.zip`).
- `npm run test:keyboard && npm run test:pointer && npm run test:keymap` — exit 0
  (`node-input-tests.log`).
- Stills at the frozen head: `launcher-desktop.png`, `launcher-phone-390.png`,
  `busybox-files.png`, `busybox-containers.png`, `phone-390-{shell,tools,files}.png`.

Known limits and failures (not green):

- **`e3-t05f1-docker-bootstrap.spec.js` fails at line 19**: it clicks `#ide-act-docker` with
  `noAutoBoot` before any guest is selected; `#ide-root` is `display:none` by the launcher rule
  `#panel-ide:not([data-os-selected="true"]) #ide-root`, present unchanged on base
  (`05fa92c82:web/index.html:748`) and here (`web/index.html:692`). Case 1 ran to its 360 s
  timeout, case 2 was interrupted at the same locator, case 3 did not run
  (`e3-t05f1-docker-bootstrap.log`). A bounded probe of the same URL on base and frozen source
  gives identical results: button attached, `wvmDemo` present, button not visible, hidden by
  `div#ide-root` (`compat-probe.json`, `compat-probe-*.png`). No harness or product change was
  made for it.
- The retargeted `e4-t32` "default JIT keeps whole-machine BusyBox" case was **not run** at the
  frozen head. Its first step calls `window.wvmDemo.runBusybox()` right after `load`, while
  main.js is a dynamic import that defines `wvmDemo` after `load` (measured ~73 ms vs ~43 ms on
  a base extract); in this session that step failed identically on the base extract (log not
  retained). Only its Settings-sheet UI path was changed.
- Pre-existing, unchanged: `e3-t17-runtime-smoke` "offline and relay UI" selects a select
  inside a closed popover and fails on base; `web-ux.spec.js` targets the removed
  `#boot-alpine`; ide.js's container-runtime probe echoes `__WVBEGIN…` commands into Alpine
  terminals; input typed the instant `isGuestReady()` flips is lost on the legacy layout, while
  here the command runs and only its first characters' echo is overwritten by an early redraw.
- Alpine containers were exercised only on the local image, which has no `wvrun` (runtime-absent
  state): runtime/resume/pull/images projected and pressable, but running containers, container
  logs/exec projections and file drag-and-drop forwarding were not exercised end to end. The
  Omarchy desktop was not booted. Firefox/Safari and a cold clone were not run.
- Engine-owned copy shown verbatim inside panes (e.g. "Boot Alpine to enable WVFT") is unchanged.

### 2026-10-30 — fresh verifier — VERDICT: refuted

Reviewed `78124cf53..756ffd773` against frozen product `2b9f97c11`. Predictions were prepared
from the task/diff before opening the worker evidence. Verifier artifacts are local at
`target/ui-verifier/workspace-r1/`; no implementation files were edited. Medium risk: the
acceptance plus one bounded novel attack; no cold clone, native gauntlet or extra guest-runtime
investigation. Final whole-site design scoring belongs to E0-T30.

- **P1 first view / P2 real start — HELD.** Predicted one primary action, no heavy pre-choice
  fetch, no overflow at 1280/390/360 px, then a real BusyBox command result. Independently ran
  `PLAYWRIGHT_PORT=8172 bash tools/verify-ui-workspace.sh`: foundation **12/12**, workspace
  **8/8**, exit 0 (`acceptance.log:481-483,1126-1128`). The normal start, forced failure/retry,
  real terminal input and first-use hint are exercised; retain these outcomes on unchanged code.
- **P4 library controls / P5 isolation / P6 settings / P7 focus / P8 file save / P9 basic phone
  panes / P10 graphics choice — HELD for the exercised paths.** The same run proves native
  provider values/events/persistence, secret omission, actual login/logout status, overlay key
  isolation and focus return, Terminal/Display round trip, real guest file edit/Save/readback,
  library file-tree/editor actions, BusyBox no-probe Containers, full-width phone Back flow,
  measured ordinary targets >=44 px, no horizontal overflow, and the advanced graphics
  disclosure writing `#desktop-graphics`. See `acceptance.log:792,872,952,1026,1122` and the
  corresponding eight worker traces. Native xterm/canvas/editor hosts remain outside `.wv-ui`;
  only projection hosts are inserted. Foundation HELD boundaries carry forward; its affected
  nav behavior was also rerun. This does not prove every unexecuted projection handler below.
- **P9-N same file after Back — FAILED, reproduced twice at the intended state.** Prediction:
  on a phone, edit/Save a real guest file, Back to terminal without closing its tab, reopen
  Files and tap that same file; its editor becomes visible with the saved text in the same
  guest. Observed at `same-file-phone.json:40-50`: `wsPane="files"`, `wsEditor=null`, one tab,
  textarea hidden, saved value `saved-from-phone-42\n`, BusyBox generation 1 unchanged. The
  screenshot `same-file-phone.png` shows Files still occupying the phone. The promoted test
  independently reaches the same final assertion and fails within 5 seconds:
  `web/tests/ui-workspace.spec.js:261-307`; `promoted.log`; trace
  `promoted/ui-workspace-phone-reopeni-9bd6e-ts-editor-in-the-same-guest-chromium/trace.zip`,
  `0-trace.trace` call `call@97` tap (line 435), `call@99` visibility failure (lines 453/483).
  Cause is the changed `workspace.jsx:209-217` responding only to an *increase* in tab count,
  while unchanged `ide.js:1761` activates an existing tab without increasing it. **Demand:**
  opening an existing file must reveal its editor as opening a new file does; keep the saved
  contents/session and the promoted test. Earlier setup-only failures and trailing serial
  framing whitespace are not findings; the final recording reaches the predicted state.
- **P3 honest guest capability copy — NEEDS EVIDENCE.** New `launcher.jsx:16,21` promises an
  Alpine container runtime and `tool-panes.jsx:89-112` promises Alpine includes `wvrun` and
  offers a restart for containers. Yet this submission expressly reports the local Alpine
  artifact has no `wvrun` (worker log above, lines 169-172); its committed captures/acceptance
  demonstrate BusyBox, not a usable Alpine container path. **Demand:** make the reachable copy
  honest for the artifact actually served, or record that exact artifact satisfying the
  promise. This requests UI/copy accuracy, not an unrelated image/runtime repair.
- **P4/P5 projection and moved-control sufficiency — NEEDS EVIDENCE.** Files Refresh/open,
  tab rendering/close and Save are exercised. The worker explicitly leaves file drop and
  running-container/log/exec projections unexercised. Behavioral hunks still needing a bounded
  contract recording are `projection.jsx:113-143` (native input + Enter/form), `161-177`
  (original DataTransfer forwarding), `239-255` (checkbox/drop adapters), and
  `tool-panes.jsx:163-197` (container portal lifecycle). The acceptance also displays but does
  not operate the moved Input actions (`workspace.jsx:124-152`), and does not exercise the new
  GPU recovery mirror (`launcher.jsx:121-145`). **Demand:** one focused browser adapter proof
  asserting the native values/events, disabled parity and portal cleanup for these branches,
  plus the moved Input actions/recovery links; distinguish adapter proof from guest capability
  proof. A full Omarchy boot or a working container image is not required for this UI boundary.
- **P11 evidence identity/build/core — HELD, with metadata reconciliation.** All **42** evidence
  digest entries and all **19** frozen product-source entries match (`manifest-check.json`).
  Seven of eight recorded dist digests match submission bytes; the exception is `sw.js`,
  because the submission hook also regenerated `tasks.json`. Independently reconstructed its
  shell hash with the unstamped placeholder: expected = actual **`b607fba8d425`**
  (`sw-audit.json`), rather than the earlier recorded `380123f9787d`. The UI source/dist build
  checks pass. Frozen core evidence is **127 passed / 0 failed / zero errors**
  (`evidence/ui-redesign/workspace/riscv-suite.json:2-7`, screenshot/trace); keyboard 47,
  pointer 13 and keymap 5 pass in `node-input-tests.log`.
- **Touched compatibility harness — NEEDS EVIDENCE, bounded to the changed sequence.**
  `web/tests/e4-t32-whole-worker.spec.js:174-209` retargets Settings/login/rejection/logout but
  was not run at the frozen head. Normal login/logout is acceptance-proven; its injected
  rejection and persisted-state clearing sequence is not. Record that changed sequence after
  bounded ordinary readiness, without rerunning unrelated performance/guest gauntlets.
  The old Docker bootstrap result is accurately disclosed: first timeout, second interrupted,
  third not run. The base/current DOM probe records the same hidden `#ide-root` ancestor;
  that pre-existing helper failure and already-hidden legacy tests/run/bench controls are
  **waived as B regressions**, not counted green or raised as new product requirements.

**Changed-hunk coverage:** `bridge.js`, `network-settings.jsx`, workspace/layout/mounting,
launcher start/retry/disclosure, native Refresh/focus additions, and normal file/editor
projections are exercised as described above; same-tab activation is refuted; the named
unexecuted event adapters/recovery/Input actions and retargeted harness need the focused proof.
`styles.css`, index/ide palette and `terminal.js` color hunks are declarative visual changes,
checked by direct captures/layout/target assertions (no new engine-semantic claim).
`README.md`, task/catalog metadata, HTML rev stamps and generated bundle hunks are **waived
as independent runtime paths**: documentation or generated output covered by the source,
build/digest and service-worker checks. Package/dependency/build/router boundaries are unchanged
from verified E0-T28; retain their HELD outcomes. No hunk was classified dead.

**SUITE:** promoted the real-tap same-file phone regression above into the permanent workspace
acceptance, with explicit boot/command deadlines and a 5 s final UI deadline. It fails at the
claimed pane boundary; no assertion was weakened. All original acceptance cases remain green.
Product correctness and coverage must hold before marking this task verified.

### 2026-10-30 — worker — r2: same-file reopen fixed, copy and adapter proof gaps closed

Frozen implementation head: `9da6e392f` (one commit on the verifier's `027dc638b`). Evidence:
`evidence/ui-redesign/workspace-r2/` (`HEAD`, `SHA256SUMS`). Changes since r1:
`changed-since-r1.txt`; product-source digests since the verified foundation (22 files):
`changed-source-sha256.txt`; shipped dist digests at the implementation head:
`dist-sha256-at-impl-head.txt` (`sw.js` version there `6f10969070d4`; the submission commit's
hook regenerates `tasks.json` and so re-stamps `sw.js` once more, as in r1 — read the final
version from the submission head).

Fixes:

- **P9-N same file after Back.** `projection.jsx` now dispatches an explicit open intent when a
  person presses a file row or a container row; `workspace.jsx` responds by showing the editor
  (phone: the editor pane) whether ide.js creates a tab or re-activates the existing one. The
  tab-count rule remains only for tabs opened by other paths. The verifier's promoted test
  (`ui-workspace.spec.js:264`, real taps, unchanged) passes, with one tab, the saved contents and
  the same guest session.
- **P3 honest copy.** The launcher no longer promises a container runtime for either Alpine
  guest. The BusyBox Containers panel says BusyBox cannot run containers, that containers need an
  Alpine image including `wvrun`, that not every host publishes one, and that the pane checks the
  running image after a restart. File-transfer status now reads "Start an Alpine guest to copy
  files between this computer and the guest." (`file-transfer.js`, `index.html`); the ready text
  keeps "WVFT controller attached" in parentheses for the existing `e4-t32-file-transfer-async`
  assertion. Names and requirements wrap (no truncation), checked in `busybox-containers.png`.
- **Clear did nothing (pre-existing).** ide.js's Clear called `window.__term.clear()`, which
  main.js's terminal wrapper never had; it now calls the wrapper's xterm `term.clear()`. Found
  by the new Settings adapter proof below.

Adapter proof, `web/tests/ui-workspace-contracts.spec.js` (6 cases, in the real app with a real
BusyBox guest; fixtures are copies of the engine's own markup/state with RECORDING handlers and
are labeled as such — they prove forwarding, not a container runtime or GPU recovery):

1. Container panel adapters (fixture: ide.js `openContainer` markup, `ide.js:2759-2785`): host
   insertion into the native panel with natives hidden and logs left native; pointer and keyboard
   Button presses reach native handlers; Exit Exec disabled parity both ways; Follow Switch
   toggles the native checkbox and fires its `change`; TextField writes the native input with
   `input` events, Enter submits the native form carrying the native value; an engine-side clear
   of the input shows in the library field; removing the panel removes both hosts.
2. File drop (no fixture): a DataTransfer dropped on the library zone reaches the real
   `#file-transfer-drop` with the same file (`drop-note.txt:18`), `dragging` class set/cleared by
   file-transfer.js, and file-transfer.js queues the file in its own list, which the projection
   shows.
3. Settings Input actions (no fixture): capture Switch flips `data-keyboard-capture` off/on via
   `#ide-keyboard-toggle`; Release increments main.js's `releaseCount` with reason
   `panic-button`; Pointer mode disabled parity with the native toggle; Clear empties the xterm
   scrollback; typing afterwards still runs a command.
4. GPU recovery mirror (fixture: the `#gpu-status`/`#gpu-retry`/`#gpu-cold-retry` state main.js
   writes): status and both links appear with the native hrefs, and disappear when cleared.
5. Keyboard reopen: Enter on a file row opens it; after hiding the editor, Enter on the same
   (still open) row shows it again with one tab.
6. The retargeted `e4-t32` Settings sequence (`e4-t32-whole-worker.spec.js:174-209`) after a
   bounded ordinary start: Tailscale **Log in** rejection text, injected worker rejection shown
   in the sheet, guest still up, **Log out and revoke** clears persisted state and the one-time
   key, ≥3 worker RPCs. Run here instead of that spec's racing first step and perf gauntlet.

Commands at `9da6e392f`:

- `bash tools/build-web-dist.sh` (runs `make web-build`) — exit 0, reproduced the committed
  `web/dist` exactly (`build-web-dist.log`).
- `bash tools/verify-ui-workspace.sh` — PASS, exit 0 (`verify-ui-workspace.log`): foundation
  12/12 (digest `ba028b29…`), then 15/15: the 9 workspace cases (including the promoted reopen
  case and new copy assertions) and the 6 contract cases.
- Same two specs with `--trace on`: 15/15, one trace per case in `traces/` (`traced-run.log`).
- Stills: `launcher-desktop.png`, `launcher-phone-390.png`, `busybox-files.png`,
  `busybox-containers.png` (zero browser errors, `busybox-panes.log`).

Carried HELD from r1 without rerun (boundaries unchanged since `2b9f97c11`: `main.js`,
`src/input/*`, `terminal.js`, wasm/pkg and the riscv-tests path are untouched; ide.js changes
are the Clear handler only; the rest is UI bundle, copy and CSS): in-browser riscv-tests
127 passed / 0 failed / zero errors; keyboard 47, pointer 13, keymap unit tests; the verifier's
HELD P1, P2, P4–P8, P10 and P11 outcomes for unchanged paths.

Still not green / not claimed: `e3-t05f1-docker-bootstrap.spec.js` fails at line 19 before any
guest is selected (pre-existing hidden `#ide-root`, bounded base/current probe in
`../workspace/compat-probe.json`; waived as a B regression by the verifier); its long cases were
not rerun. The full `e4-t32-whole-worker.spec.js` was not rerun (only its changed sequence, case
6 above). Running containers, container logs/exec against a real runtime, and Omarchy remain
unexercised end to end; cold clone and Firefox/Safari not run.

### 2026-10-30 — fresh verifier — r2 — VERDICT: refuted

Incremental review of frozen product `9da6e392f`, submission `9550c3928`, against `2b9f97c11`
and the r1 verdict. Predictions were prepared from the repair diff before opening r2 evidence.
Local verifier recordings/logs: `target/ui-verifier/workspace-r2/`. The prior bounded novel
attack is retained; no additional attack, full old suite, runtime/image repair or cold clone.

- **P9-N same-file reopening — HELD.** Predicted the saved editor becomes visible after phone
  Back → Files → tapping the existing file, with one tab and the same guest. The unchanged
  promoted regression now passes independently (`incremental.log:560,564`). Desktop Enter
  reopening also passes (`incremental.log:400`). Carry these results forward unchanged.
- **P3 capability/copy repair — HELD.** `launcher.jsx:16,21` removes the unconditional container
  runtime promise; `tool-panes.jsx:89-112` explains the runtime requirement and host-dependent
  availability before a deliberate restart. Inspected r2 `launcher-phone-390.png` and
  `busybox-containers.png`: names and notes wrap visibly. This does not claim a working local
  Alpine container runtime. File-transfer idle copy is plain, and the real drop-path contract
  checks that it appears.
- **P4/P5 adapter proof / moved actions / changed Settings sequence — HELD except the specific
  disabled-state failure below.** Independently ran the six submitted contract cases plus the
  phone regression with Playwright and `--trace on`: **7/7**, exit 0 (`incremental.log:86-564`).
  This closes the r1 proof gaps for native button presses/disabled parity, checkbox change,
  input value/input event/Enter submission/engine-side clear, original file drop into the real
  transfer handler/list, portal removal, capture off/on, Release, pointer disabled parity,
  actual xterm Clear followed by a usable guest, GPU recovery DOM/link reflection, and the
  retargeted injected rejection/logout/persisted-state clearing. Container/GPU fixtures are
  clearly labeled recording handlers and prove the UI adapter, not guest runtime success.
- **P4/P5 native checkbox disabled parity — FAILED, rechecked once.** Prepared prediction:
  when ide.js disables Follow during log-stream start/stop (`web/ide.js:1931`), its projected
  Switch must also become disabled. Extended the existing recording-handler fixture to set
  native `Follow.disabled=true`, assert that native state, and assert the library state with
  a **5 s** deadline. The native assertion passes; the library assertion receives **enabled**
  twice (`follow-disabled.log`, `follow-disabled-recheck.log`; promoted
  `web/tests/ui-workspace-contracts.spec.js:117-123`). The recheck trace is
  `follow-disabled-recheck/ui-workspace-contracts-con-8c774-re-ide-js-2759-2785-markup--chromium/trace.zip`;
  `0-trace.trace` native `call@65` passes at lines 278/283; library `call@67` fails at lines
  285/325 (also extracted in `follow-disabled-trace-points.json`).
  `projection.jsx` reads `child.disabled` for the checkbox but the Switch at line 249 omits
  `isDisabled`, leaving an enabled-looking control whose native click is suppressed.
  **Demand:** propagate native checkbox disabled state to the library Switch; retain this
  regression and prove disable/re-enable parity. No container runtime change is requested.
- **P11 evidence identity / carried boundary — HELD with declared metadata differences.** All
  **32** r2 evidence digests match. **21** source entries match; the sole source exception is
  generated `web/tasks.json`. Of ten implementation-head dist digests, eight match; only
  `tasks.json` and its dependent `sw.js` stamp changed in submission. Independently reconstructed
  the final SW shell hash: expected = actual **`a3fe56bbfa22`** (`manifest-check.json`). All
  **42** r1 evidence digests still match (`carried-digests.json`), and the core/input/pkg/main/
  terminal/riscv-test boundary diff is empty. Carry unchanged foundation, P1/P2/P4-P8/P10/P11,
  **127/0** core and keyboard 47/pointer 13/keymap 5 HELD evidence. Old Docker and full e4
  limitations remain accurately disclosed and are not recounted as successes or new defects.

**Changed-hunk coverage:** file-open intent/workspace response and native Clear fallback are
exercised by the independent cases; the container-open intent uses the same tested dispatch/
listener path (the unused `kind` detail is declarative metadata). Copy hunks are directly
inspected; the file-transfer idle text is exercised by its drop proof, while ready wording is
declarative text preserving the existing controller marker. New adapter test fixtures are
explicit boundary fixtures, not runtime mocks reported as guest success. Acceptance wiring is
exercised by the worker's recorded 15/15 run. Rev stamps, generated bundles/catalog and the SW
are waived as independent behavior paths after source/digest/build reconciliation. The only
remaining refutation is native-checkbox disabled parity; no unrelated HELD result is reopened.

**SUITE:** promoted the eight-line disabled/re-enabled Follow check inside the permanent
container-adapter contract. It fails precisely after the native-disabled assertion passes.
Policy check must precede queue generation; task returns to `in-progress` for this narrow fix.

### 2026-10-30 — worker — r3: native checkbox disabled parity

Frozen implementation head: `06c7aff0f` (one commit on the verifier's `f04ef9c71`). Evidence:
`evidence/ui-redesign/workspace-r3/` (`HEAD`, `SHA256SUMS`; only the changed adapter path is
recorded). Changes since the r2 verdict: `changed-since-r2-verdict.txt`; changed source digests:
`changed-source-sha256.txt`; dist digests at the implementation head:
`dist-sha256-at-impl-head.txt` (`sw.js` `35cb1b0cc74c` there; the submission hook re-stamps it
once more after regenerating `tasks.json`).

Fix. The demand was to propagate the native checkbox's disabled state to the library Switch.
`isDisabled` alone cannot do it: `@brett_lamy/ui`'s `Switch` reads only
`checked`/`onChange`/`className`/`style` and its aria labels, forwarding neither `isDisabled` nor
a ref to react-aria (`node_modules/@brett_lamy/ui/dist/components/switch.js`). The projection's
new `NativeLinkedSwitch` (`projection.jsx`) keeps the library Switch and, after every render,
sets `disabled` on that Switch's own `<input role="switch">` from the native checkbox, so the
browser blocks activation and assistive tech reads it as disabled; changes are ignored while the
native checkbox is disabled, and a `data-disabled` style dims it. Checked state and change
forwarding are unchanged (native `click()` → ide.js's own `change` handling).

Proof at `06c7aff0f`:

- The verifier's promoted assertions (`ui-workspace-contracts.spec.js:117-123`, unchanged): the
  projected Follow Switch becomes disabled with the native checkbox and enabled again after it.
- New case (`ui-workspace-contracts.spec.js:145`, labeled fixture of ide.js's Follow checkbox
  with a recording `change` handler): a real mouse press on the disabled switch leaves it and the
  native checkbox unchecked with no `change` recorded; after re-enabling, a press checks both and
  records exactly `[true]`.
- Sabotage (`sabotage.txt`): without the mirroring line, the promoted case fails at line 121;
  restoring it rebuilds the identical bundle.
- `bash tools/build-web-dist.sh` (runs `make web-build`) — exit 0, reproduced the committed
  `web/dist` (0 changes; `build-web-dist.log`).
- `bash tools/verify-ui-workspace.sh` — PASS, exit 0 (`verify-ui-workspace.log`): foundation
  12/12 (digest `26409e94…`), then 16/16 (9 workspace + 7 contract cases).
- Traced run of the two Switch cases only: 2/2, traces in `traces/`
  (`traced-switch-cases.log`). The other cases' traces are not duplicated; they are unchanged
  in r2 evidence.

Carried HELD without rerun (the engine boundary `main.js`, `ide.js`, `src/`, `terminal.js`,
`file-transfer.js`, pkg and crates is unchanged since `9da6e392f`): the verifier's r2 HELD
results (same-file phone reopen, copy, the other six contract cases, evidence identity), the r1
HELD results for unchanged paths, in-browser riscv-tests 127 passed / 0 failed / zero errors,
keyboard 47 / pointer 13 / keymap 5 unit tests, and foundation determinism.

Compatibility limits carried, not green: `e3-t05f1-docker-bootstrap.spec.js` still fails at line
19 before any guest is selected (pre-existing hidden `#ide-root`; bounded base/current probe in
`../workspace/compat-probe.json`; waived by the verifier as a B regression); the full
`e4-t32-whole-worker.spec.js` was not rerun (only its retargeted Settings sequence, contract
case 7); running containers/logs/exec against a real runtime, Omarchy, cold clone and
Firefox/Safari remain unexercised.

### 2026-10-30 — fresh verifier — r3 — VERDICT: verified

Frozen product `06c7aff0f`, submission `9a97ec3e2`. This is the incremental review of the
remaining disabled-Switch boundary; all unchanged r1/r2 HELD results remain carried. Predictions
were prepared from the adapter/CSS diff and the installed library source before testing. Local
recordings and identity audit: `target/ui-verifier/workspace-r3/`.

- **P4/P5 disabled/re-enabled parity — HELD.** Confirmed `@brett_lamy/ui` 5.10.1 Switch forwards
  neither `isDisabled` nor a ref (`dist/components/switch.js:7-16`, its declaration lists no
  disabled prop). Judged the adapter's observable behavior. Independently ran the promoted
  container contract and the new physical-press case with scoped `PW_DISABLE_TS_ESM=1`, port
  8176, and `--trace on`: **2/2**, exit 0 (`contract.log`, traces in `contract/`). Native and
  rendered checkbox disabled state now agree; re-enabling restores a working actual native
  change event. The previously failing assertion is unchanged.
- **Touched accessibility/appearance/activation — HELD.** The independent `switch-state.mjs`
  probe records `switch-state.json:24-42`: both disabled flags true, accessibility role
  `switch`, name `Follow`, `disabled:true`, opacity **0.45**, cursor **not-allowed**. The disabled
  input cannot take focus; a physical mouse press forwards no change and preserves selection.
  Dimensions remain 51 × 31 px in this desktop probe. Re-enabling restores opacity 1 and the
  pointer cursor (`:44-61`); Space then toggles the real native checkbox and the recorded change
  log becomes `[true,false]` (`:63-82`). Zero browser errors. Screenshot
  `switch-disabled.png` was inspected; the trace is `switch-state.zip`. These are adapter
  fixtures, not a claim of a working guest container runtime.
- **Evidence identity/build packaging — HELD.** All **13** r3 evidence digests and all **5**
  changed-source digests match. Four implementation-head dist digests match; the only two
  exceptions are declared generated `tasks.json` and its dependent SW stamp. Submission changes
  under `web/` are exactly source/dist catalogs and `sw.js`. Independently reconstructed the
  final SW shell hash: expected = actual **`b54d18f5f83d`**, superseding implementation stamp
  `35cb1b0cc74c` (`identity-audit.json`). The independently tested JS/CSS and adapter source
  bytes are unchanged at submission; source UI bytes after route swap equal shipped UI bytes.
- **Incremental carry — HELD.** All **42** r1 and **32** r2 evidence digests still match, and
  the engine boundary diff since r2 is empty. Retain same-file phone/keyboard reopen, truthful
  conditional copy, native Settings/input/drop/portal contracts, core **127/0**, keyboard
  47/pointer 13/keymap 5, and foundation determinism. The worker's final gate records foundation
  **12/12** and workspace/contracts **16/16** (`evidence/ui-redesign/workspace-r3/verify-ui-workspace.log:461,1741`).
  The known old Docker harness limit and absent real container/Omarchy E2E proof remain
  accurately disclosed; no broader suite or new attack was required.

**COVERAGE:** the new `NativeLinkedSwitch` render/layout effect, enabled forwarding, native
disabled blocking, re-enable path and two CSS declarations are exercised by the focused cases
and state probe. The disabled `onChange` guard is redundant defense behind the proven native
input blocking and is waived as an independent user path.
Imports, generated bundle/rev/catalog changes are waived as separate runtime paths after
source/digest/packaging reconciliation. No changed behavioral hunk remains unproven or dead.
**SUITE:** retain the permanent promoted disable/re-enable assertion and physical-press case;
the worker also records the expected failure when the mirroring line is removed. No further
test promotion is needed for this repair. Status advances to `verified`; the overall site
design grade remains for the public-page slice.
