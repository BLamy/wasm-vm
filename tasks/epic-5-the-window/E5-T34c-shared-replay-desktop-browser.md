---
id: E5-T34c
epic: 5
title: Boot the shared Replay Chrome and Node 26 desktop in the browser demo
priority: 0.3873
status: verified
depends_on: [E5-T34a, E5-T34b]
estimate: S
risk: medium
capstone: false
---

## Boundary

Expose the E5-T34b image through the E5-T34a single-fetch mode in web/, update roadmap.js, and publish to Cloudflare. No driver bytes are present (privacy check on the exact shipped image and dist).

## Deterministic acceptance

Playwright on the built page and the live site: one disk fetch, desktop visible, Chrome renders smoke.html, the Node terminal answers a typed command, zero console errors, measured download size and time to desktop.

## Adversarial verification

Medium risk: check the acceptance criteria against recorded evidence and run one
bounded novel attack.

## Verification log

### 2026-11-24 — worker — submitted at b39cc978f

**Claim.** The launcher has a **Replay desktop** entry (`data-os="replay-desktop"`, React launcher row) that
opens `?guest=replay-desktop&desktop=1#ide`, the same full-window desktop surface as Omarchy (display canvas
owns keyboard and pointer, boot overlay, toolbar). `bootReplayDesktop()` in `web/main.js` cold-boots the
E5-T34b image as a chunked raw ext4 with the E5-T34a prefill. The boot manifest is `web/artifacts-replay-desktop.json`:
- kernel `releases/kernel/6.6.63/Image` (`af7c4e47…`);
- chunk manifest `releases/rootfs/replay-desktop-2af6100e9b37.chunks.json` (`2e644ad8…`, committed, byte-identical
  to `evidence/e5-t34b/build/chunk-manifest.json`);
- whole image `releases/rootfs/replay-desktop-2af6100e9b37.img.gz` (`37911eaa…`, 189,669,297 B, gitignored),
  decompressed 467,664,896 B / `2af6100e…5b05`.

Devices are the browser assembly (equal to the native `--browser-topology` set). Settings: JIT, fast
interpreter, icount divider 64, quantum 500k, no persistence or snapshot, offline network, and the E5-T34b
bootargs (`root=/dev/vda ro … quiet loglevel=4`). The overlay lifts only after the guest's
`REPLAY_DESKTOP_READY` serial marker (sway mapped both windows and Chrome reported the PASS title) **and**
`hasDesktopPixels` on presented frames. Desktop sessions get no Explorer/Docker serial RPCs and a lazy agent
channel (`web/ide.js`, `web/desktop-agent-session.js`). The deploy stages the manifest; the image and chunk
manifest go to content-addressed R2 keys through the existing `releases/rootfs/*` path, behind the privacy guard.

On the built page, locally and on the live site, the recorded runs show:
- exactly 1 `.img.gz` request and 0 chunk or Range requests;
- `fetchStats`: `fetches:0`, `localHits` about 1,222;
- Replay Chrome 108's smoke.html PASS result object, with the renderer sandboxed;
- the sway desktop with Chrome and the Node terminal side by side;
- a nonce-tagged `node -e` command typed as real DOM key events on the canvas, answered with `v26.13.1`;
- zero console errors and an unchanged 127/0 ISA suite.

**Deviation: guest RAM is 1 GiB, not the native 2 GiB.** The first boot failed in the wasm machine with
`cannot allocate 2048 MiB of guest RAM`. Guest RAM is one wasm32 allocation, and 2^31 B exceeds `isize::MAX`.
Changing that would be an emulator change, which is out of scope. 1 GiB matches browser Omarchy and is 5.6×
E5-T34b's measured 182 MiB high-water mark.

**Commands.**
- `make web-build` (57 s).
- `bash tools/serve-dev.sh 8123`.
- `node tools/verify/e5-t34c-replay-desktop.mjs boot`, then `… suite`, both on local `web/`.
- Commit b39cc978f. The pre-commit hook rebuilt and staged `web/dist`. It needs a real `rg`, which is only a
  shell function here, so it ran with a temporary PATH shim: a bash `exec -a rg` wrapper around the Claude
  Code bundled ripgrep, in the session scratchpad.
- `bash tools/deploy-cloudflare.sh`. The first attempt stopped at artifact validation: the gitignored Omarchy
  `omarchy-apps-ready-98235fbe8cc4.snap.gz` and `omarchy-apps-virgl-ready-3583ea9927d1.wvgpair` were absent locally,
  which is unrelated to this task. I restored both from their public content-addressed R2 keys with SHA-256 checked,
  then re-ran.
  - `[privacy] OK: 796 file(s)`, covering the Pages tree and every R2 source including the new `.img.gz`.
  - The two new R2 objects were uploaded and publicly verified.
  - The 204 MB virgl pair's public check hit the script's 300 s curl limit, so it re-uploaded the same bytes to
    the same content-addressed key.
  - Published at https://bcd9f1bb.wasm-vm.pages.dev, which is production https://wasm-vm.pages.dev (`evidence/e5-t34c/deploy.log`).
- `E5_T34C_URL=https://wasm-vm.pages.dev E5_T34C_APP=/app E5_T34C_OUT=evidence/e5-t34c/live node tools/verify/e5-t34c-replay-desktop.mjs boot suite`.
- Gates: `node --check` on all changed JS. `node --test tests/omarchy-startup-state.test.mjs` passes 4/4.
  `tests/omarchy-desktop-agent-session.test.mjs` is 4 pass / 3 fail, identical at HEAD~ with the old `main.js`
  (`ReferenceError: mountSessionTimeline is not defined`, a pre-existing fixture gap). No Rust changes, so no
  fmt, clippy or cargo tests.

**Results (system Chrome 158 headless, 1280×800, production URL without `?testHooks`).**

| | local (serve-dev, `web/`) | live (`wasm-vm.pages.dev/app`, image from R2) |
|---|---|---|
| download | 1 request, 189,669,297 B in 1.7 s | 1 request, 189,669,297 B in 84.7 s |
| chunk / Range requests | 0 of 169 total | 0 of 171 total |
| fetchStats | fetches 0, localHits 1221 (320,077,824 B), error null | fetches 0, localHits 1223, error null |
| page open → desktop visible | 167.9 s | 242.9 s |
| guest uptime (icount/64 clock) | sway IPC 25.40, READY 64.23, RAM HWM 162,092 KiB | sway IPC 24.18, READY 62.90, RAM HWM 162,600 KiB |
| typed command → Node answer | 51.2 s | 51.3 s |
| Node output | `E5T34C_56D18492 v26.13.1` | `E5T34C_18436867 v26.13.1` |
| console errors | 0 | 0 |
| ISA suite | 127 passed, 0 failed | 127 passed, 0 failed |

Chrome: `REPLAY_CHROMIUM_TARGETS … "title":"Replay RISC-V PASS #1"` and `REPLAY_CHROMIUM_PAGE … "value":"pass {"pass": true,
"runs": 1, "javascript": 42, "webassembly": 42, "pixel": [42,128,64,255], "browser": "Chrome/108.0.0.0"}`, then
`REPLAY_CHROMIUM_READY renderers=1 sandboxed=1`.

Input proof: the script never writes to the serial console; it uses no `sendInput` or `typeBytes`. It clicks
the canvas at 82%×50% to focus foot, which follows sway's click focus. It then presses W3C codes, holding Shift
explicitly. The keyboard bridge recorded 0 frames before typing and 208 (local) or 206 (live) after: 2 per key
plus Shift pairs. The live count is two lower because its nonce has no hex letter. Each run's nonce is fresh,
and the line is relayed to serial only because the typed pipeline appended it to `/run/replay-desktop/events`.
`desktop-node.png` shows the typed command and its output in the foot window beside Chrome's PASS JSON.

**Evidence (`evidence/e5-t34c/`).**
- `{local,live}/`: `boot-summary.json` (times, counts, fetchStats, display, chrome/node lines, keyboard
  frames), `requests.json` (every page and worker request, with Range header and body size), `console.json`,
  `serial.log`, `desktop.png` (at ready), `desktop-node.png` (after the typed command), `demo-suite.{json,png}`
  and `run.log`.
- `deploy.log`.

**Gaps / not proven.**
- 1 GiB instead of 2 GiB RAM (above).
- Timing is single-run on a loaded host (load average 9 to 15). The live download time is this Mac's link to R2.
- foot shows three empty `desktop$` prompts before the typed command in both runs, with no keyboard frames
  sent before typing. Their origin was not investigated; they do not affect the command or its output.
- Only headless system Chrome was tested. There was no Firefox, real GPU, mobile or DPR≠1 run, and no
  repeat/warm-cache visit.
- The chunk manifest is fetched without a digest check. Image integrity rests on the declared decompressed
  SHA-256 (checked before boot) plus the per-chunk hashes.
- smoke.html's subtitle still says "Weston / Wayland" (inherited from E5-T34b).
- The roadmap row stays `in-progress`, pending this task's fresh verifier.

### 2026-11-24 — fresh verifier — VERDICT: needs-evidence

Scope: b39cc978f (implementation) + 442daa3aa (submission). Medium risk: acceptance criteria + one bounded
novel attack. Live deployment claimed, so the live site was checked instead of a cold clone. Predictions
were written before observing.

- **P1 live acceptance — HELD.** Predicted 1 `.img.gz` request of 189,669,297 B, 0 chunk/Range requests,
  `fetches:0`, about 1,220 `localHits`, Chrome PASS #1, the fresh nonce answered by v26.13.1, 0 console
  errors and 127/0.
  - Ran `E5_T34C_URL=https://wasm-vm.pages.dev E5_T34C_APP=/app E5_T34C_OUT=<scratch>/live node tools/verify/e5-t34c-replay-desktop.mjs boot suite`.
  - Requests: 171 in total, `wholeImage:1` (R2 `sha256/37911eaa…/…img.gz`, 189,669,297 B in 55.0 s),
    `chunkOrRange:0`.
  - `fetchStats`: `fetches:0`, `localHits:1223`, `localImage:true`, `error:null`.
  - Desktop visible at 219.2 s. Guest reported `REPLAY_CHROMIUM_TARGETS … "Replay RISC-V PASS #1"`, the
    smoke PASS object (`Chrome/108.0.0.0`), and `REPLAY_CHROMIUM_READY renderers=1 sandboxed=1`.
  - My nonce `E5T34C_A9057E8B v26.13.1` was answered 49.4 s after typing began (serial line 28).
  - Keyboard frames: 0 before typing, 212 after (93 chars). Console errors: `[]`. Suite: 127/0, launcher
    `ready · one 181 MiB download`.
  - The screenshot shows Chrome's PASS JSON beside foot, with the typed command echoed and answered in the
    foot window.
  - This matches the worker's live table in shape (171 requests, 1/0, about 1223 hits).
- **P2 typed-input authenticity — HELD.** Predicted the command could reach a shell only through the
  DOM → evdev bridge.
  - The guest DOES expose a serial root ash (`root@replay-desktop#`). It is a potential backdoor, together
    with `/usr/local/sbin/replay-desktop-type` (TIOCSTI).
  - Source check: the script never calls `sendInput`/`typeBytes`/exec. `keyboardHost` is the display
    canvas in `_desktopMode` (web/main.js:572), and `ide.js` returns null from `cliGuestServicesSession`
    for `DESKTOP_SESSION_KEYS`, so no Explorer/Docker RPCs run.
  - The live serial log contains no echoed `node -e` line and no `WVM_TYPE` line. A serial-shell or
    replay-desktop-type path would have printed one. It also has exactly one output line, where a serial
    `tee` would have printed it twice. The only page→serial bytes are xterm's CPR reply after the prompt.
  - Three empty `desktop$` prompts: not acceptance, origin unconfirmed. Hypothesis: busybox ash lineedit
    redraws on SIGWINCH as sway retiles foot (terminal mapped at uptime 49.7 before Chrome mapped).
- **P3 deployed bytes = verified bytes — HELD.**
  - The live `artifacts-replay-desktop.json` is the committed one with R2 content-addressed URLs and
    identical digests.
  - The live R2 chunk manifest's SHA-256 is `2e644ad8…2ecc`, equal to
    `releases/rootfs/replay-desktop-2af6100e9b37.chunks.json` and `evidence/e5-t34b/build/chunk-manifest.json`.
  - The live `.img.gz` was downloaded once: SHA-256 `37911eaa…faba`, 189,669,297 B. It decompresses to
    467,664,896 B with SHA-256 `2af6100e9b37b9d1effd5102922672b682ec27d1eb1f56aa66e343c865d55b05`, which
    is E5-T34b's verified image. The download was deleted afterwards.
  - Live `main.js`, `ide.js`, `desktop-agent-session.js` and `roadmap.js` have the same SHA-256 as the
    committed `web/dist`.
- **P4 privacy — HELD.**
  - `check-no-replay-backend.py` passed (12 markers, 11 driver digests) on:
    - the live `.img.gz`: OK, 1 file (recursive gzip/ext4 scan);
    - `web/dist` plus the chunk manifest plus the boot manifest: OK, 784 files;
    - `--git-range 681109bc0..442daa3aa`: OK, 83 blobs.
  - Deploy routing: `artifacts-replay-desktop.json` was added to `MANIFEST_NAMES`. Its
    `releases/rootfs/*` entries go into `R2_QUEUE`, and every `R2_QUEUE` source plus `$DIST` goes through
    the privacy guard before upload (tools/deploy-cloudflare.sh:224-229). `deploy.log` lines 8 and 16-17
    confirm this.
- **P5 non-regression — FAILED.**
  - I ran all 80 `web/tests/*.test.mjs` at 442daa3aa and at the parent 681109bc0 (temporary worktree,
    since removed). 79 files gave identical results.
  - `omarchy-desktop-agent-session` is 4 pass / 3 fail on both, so the worker's "pre-existing" claim holds.
  - `tests/omarchy-desktop-services.test.mjs` regressed from **8/0 on the base to 4/4 at HEAD**:
    - `ReferenceError: DESKTOP_SESSION_KEYS is not defined` in the vm-extracted `cliGuestServicesSession`
      (tests at lines 329 and 348);
    - stale source regexes for `keyboardHost = _omarchyDesktopMode` (line 361) and
      `probeAlpineAssets`/`bootAlpineFromDocker`/`renderDocker` `=== "omarchy"` (line 377).
  - The worker's gate list ran neither this file nor the base comparison.
  - The production semantics look preserved, because `DESKTOP_SESSION_KEYS` contains `omarchy`. However,
    the committed regression wall guarding "a desktop owner gets no service RPC" is red, and nothing asserts
    the same for `replay-desktop`.
  - **Demand (test-only):**
    - Update the fixture: inject `DESKTOP_SESSION_KEYS` and match `_desktopMode` and `DESKTOP_SESSION_KEYS.has`.
    - Add a `replay-desktop` key case to the RPC-gate and Docker-affordance tests.
    - Show the file passing in full, plus the other 79 files unchanged.
  - Per AGENTS.md this is evidence-needed. Do not rerun the browser boots unless runtime JS changes.
- **COVERAGE — HELD except as noted.**
  - Executed in the live boot: `_desktopMode` host/pointer/tabIndex/viewport/lifecycle hunks (keyboard
    frames, `wvm:desktop-ready` fired); `scanReplayDesktopOutput` and the `resetGuestReady` resets; the
    `replayDesktopBootOptions`/`bootReplayDesktop` success path; `setGuestChip`; the load-time probe and
    `setOsOptionAvailability` (suite launcher `ready`); `desktop-agent-session` lazy key; the ide.js desktop
    CSS, labels and service gates; and the roadmap.js keydown gate (`/` typed in the command, focus not stolen).
  - Launcher navigation hunk (main.js `normalized === "replay-desktop" && navigateToDesktop`): not in the
    worker's run. I exercised it live: a click on `[data-os="replay-desktop"]` from `/app?noAutoBoot=1`
    navigated to `…&guest=replay-desktop&desktop=1#ide`. HELD.
  - Waived:
    - the invalid-manifest `throw` (a defensive guard; the probe maps it to unavailable);
    - workspace.jsx hint gate (visual-only);
    - .gitignore;
    - the deploy script, which `deploy.log` exercised.
- **Novel attack (corrupt served image) — HELD on safety. Follow-up on UX.**
  - Routed the live R2 `.img.gz` to a valid gzip of 467,664,896 zero bytes: right size, wrong SHA.
  - Predicted fail-closed with no chunk fallback, plus a visible boot error.
  - Observed over 600 s: 1 image request, 0 Range/blob/chunk fetches (only the chunk manifest JSON), 0
    serial bytes (no kernel started), and the overlay never lifted. Safety held.
  - However, no `wvm:guest-error` surfaced. The boot status stayed `Booting Replay desktop…` with a black
    screen for 10 minutes. This is not attributed to this diff (the prefill and error plumbing come from
    E5-T34a and the worker host), and silent failure UX is not an E5-T34c acceptance criterion. Suggested
    as follow-up work, not raised here.
- **Roadmap row:** left `in-progress` by the worker. AGENTS.md assigns roadmap updates to the worker, so it
  needs flipping after verification. Not flipped here.
- **SUITE:** deferred until P5 clears. The repaired `omarchy-desktop-services` cases with a `replay-desktop`
  key are the promotion candidates.

Commands:
- `node tools/verify/e5-t34c-replay-desktop.mjs boot suite` (live URL);
- `curl` of the live manifests and R2 objects, plus `shasum` and `gunzip | shasum`;
- `check-no-replay-backend.py` (three scopes above);
- `node --test` over `web/tests/*.test.mjs` at HEAD and at the base worktree;
- a scratch Playwright attack script (launcher click + `route.fulfill` of the corrupt image).

### 2026-11-24 — worker — evidence response (test-only; no runtime change)

The verifier found one gap: `web/tests/omarchy-desktop-services.test.mjs` went from
8 pass / 0 fail to 4/4, and nothing covered the desktop-session rule for
`replay-desktop`. Fixed in the test only:
- The fixtures now evaluate the exact production lines `const DESKTOP_GUESTS = …` and
  `const DESKTOP_SESSION_KEYS = …` from `ide.js`, not a copy (fixes
  `ReferenceError: DESKTOP_SESSION_KEYS is not defined`). Stubbed
  `cliGuestServicesSession` follows the same set.
- The source-pattern assertions follow the E5-T34c rename (`_desktopMode`,
  `DESKTOP_SESSION_KEYS.has(guestSession()?.key)`).
- New `replay-desktop` cases cover: the production set is exactly {omarchy,
  replay-desktop}; a Replay desktop owner's RPC is rejected (raced against 1 s, so
  a wrongly allowed RPC fails instead of hanging) and a late CLI completion is
  fenced; and Replay desktop ready events cannot start Explorer or Docker.

Results: 11 pass / 0 fail. Sabotage (remove `replay-desktop` from production
`DESKTOP_GUESTS`): exactly the 3 new tests fail; `ide.js` was restored
byte-identical. Full sweep of the 80 `web/tests/*.test.mjs` files: 10 files fail, and
all 10 give identical pass/fail counts on parent `681109bc0` (temporary worktree,
removed). They are pre-existing, environment-dependent failures, not E5-T34c
regressions. No runtime JS changed, so the live/browser evidence carries forward.

### 2026-11-24 — fresh verifier (r2) — VERDICT: verified

Scope: the evidence response 430488beb against the needs-evidence entry 3b87f5704. Medium risk. This is an
incremental re-verification (AGENTS.md "Re-verification is incremental"): the response is test-only, so I
reran the missing proof and the touched harness and did not redo the browser, live or deploy checks.
Predictions were written before observing.

- **R1 no runtime change — HELD.** Predicted the diff touches only the task file, `web/tests/`,
  `web/dist/sw.js` and `web/dist/tasks.json`.
  - `git show --stat 430488beb` lists exactly those 4 files.
  - `git diff 3b87f5704 430488beb -- web ':!web/tests' ':!web/dist/tasks.json' ':!web/dist/sw.js'` is
    empty.
  - The `sw.js` hunk is the single build-time `VERSION` cache-namespace hash (`9f52f1366bae` →
    `ff836d167edf`). It changed because the dist content hash includes `tasks.json`, which is the task
    metadata feed (the Verification log text) regenerated by the pre-commit build.
  - Neither file is emulator, loader or desktop runtime code. Neither was deployed after the live checks.
    The live bytes P3 proved (`main.js`, `ide.js`, `desktop-agent-session.js`, `roadmap.js`) are unchanged
    in `web/dist` since 442daa3aa, so the live evidence still describes the current runtime.
- **R2 desktop-services wall green — HELD.** Predicted 11/0.
  - `cd web && node --test tests/omarchy-desktop-services.test.mjs` gave tests 11, pass 11, fail 0,
    duration about 40 ms.
  - The parent 681109bc0 baseline for this file is 8/0, rechecked in a temporary worktree. So the earlier
    4/4 regression is gone and 3 cases were added.
- **R3 not self-licking — HELD.** Predicted that each sabotage would fail at least one test within the
  1 s race, with no hang.
  - The fixtures regex-extract the production `const DESKTOP_GUESTS = …` and
    `const DESKTOP_SESSION_KEYS = …` lines from `web/ide.js` and evaluate them in `vm`.
  - `rpcFixture` evaluates the production `guestSession()`…`bgExec` span, which includes the real
    `cliGuestServicesSession`.
  - Each sabotage edited the real `web/ide.js` or `web/main.js`, ran the file, then restored the copy saved
    aside. Afterwards `shasum -c` was OK and `git diff --quiet web/ide.js web/main.js` was clean.

  | Sabotage | Result | Tests that failed | Runtime |
  |---|---|---|---|
  | (a) remove `"replay-desktop"` from production `DESKTOP_GUESTS` | 8 pass / 3 fail | "production desktop-session set covers…", "Replay desktop key blocks service RPC…" (failed by the race at 1003 ms, not a hang), "ready lifecycle isolates the Replay desktop…" | 1 s |
  | (b) production `cliGuestServicesSession` only blocks `session.key === "omarchy"` | 10 / 1 | "the Replay desktop key blocks service RPC and fences late CLI completion" (race rejection at 1003 ms) | 1 s |
  | (c) revert main.js `keyboardHost = _desktopMode ?` to `_omarchyDesktopMode ?` | 10 / 1 | "desktop control entry points remain wired to the existing production bridges" | <1 s |

  - Note, not a finding: the lifecycle and log-stream fixtures still stub `cliGuestServicesSession`, using
    the production key set. That is why (b) is caught only by the RPC test, which runs the real function.
    That is sufficient coverage of the gate.
- **R4 the other failures already exist on the parent — HELD.** Predicted that every file failing at
  HEAD fails identically on 681109bc0.
  - I ran all 80 `web/tests/*.test.mjs` at HEAD. 12 files fail in this environment (the worker reported 10;
    the count depends on the environment):
    - e4-t32-node-identity 0/11 (the Playwright `chromium-1148` binary is missing);
    - e4-t32-worker-protocol 31/1;
    - e5-t26i-guest-clock 9/1;
    - e5-t26j-icount-divider 10/1;
    - e5-t26k-decoded-cache 0/1;
    - e6-t11d72-interactive-clock-critic 2/2;
    - e6-t11d72-paced-policy-critic 4/3;
    - omarchy-admission-probe 5/1;
    - omarchy-cold-counter-recycling 5/1;
    - omarchy-desktop-agent-session 4/3;
    - omarchy-seeded-loader 12/1;
    - virgl-interactive-clock 14/2.
  - I reran all 12 (not just 3) in a temporary detached worktree at 681109bc0, with `web/node_modules` and
    `web/pkg` symlinked so the environment matched. The pass/fail counts were identical, and the sorted
    failing test names were identical in every file. The worktree was removed and pruned.
  - These failures are stale source patterns in loader and clock code and a missing browser binary. None of
    them is in code this task changes.
- **R5 carried forward unchanged — HELD.** P1 live acceptance, P2 typed-input authenticity, P3 deployed
  bytes = verified bytes, P4 privacy, COVERAGE, and the corrupt-served-image attack all carry forward from
  the 3b87f5704 entry. The code they cite, the image and manifests they depend on, and their evidence
  digests are unchanged, because no non-test runtime file changed (R1).
  - P4's `--git-range` scan covered 681109bc0..442daa3aa. The response adds only test, task and dist
    metadata text with no driver bytes.
- **P5 non-regression — now HELD**, via R2 and R4.
- **SUITE.** The repaired `web/tests/omarchy-desktop-services.test.mjs` with its 3 `replay-desktop` cases
  is promoted as committed; R3 showed it is sabotage-sensitive. Nothing else is promoted.
- **Follow-ups (not E5-T34c criteria, carried from r1):**
  - no surfaced error when the image digest is wrong (silent `Booting…`);
  - the roadmap row is still to be flipped by the worker.

Commands:
- `git show --stat 430488beb`;
- the scoped `git diff` above;
- `node --test tests/omarchy-desktop-services.test.mjs` (HEAD, parent, and 3 sabotage runs);
- an 80-file `node --test` sweep at HEAD;
- a 12-file rerun in `git worktree add --detach … 681109bc0`.
