# E5.5-T04a actual-demo integration plan

Planning only, 2026-09-09. T04a is **pending** and must not activate until a fresh
verifier marks T03a verified. The current cold browser run belongs to the main
worker. Nothing in this document claims that run succeeded or authorizes changes
to its inputs. No runtime, harness, task status, build, staging or deployment was
changed to prepare this plan.

Line anchors below describe checkout `297b003ca1f1104dd539b9e79e023622b06bb9c1`.
Recheck functions against the eventual T03a accepted head before patching; the
live harness is still being coordinated separately.

## 1. Release identity and smallest production boundary

The supplied candidate identities are provisional until T03a accepts exactly
these bytes. If its final receipt changes, use that receipt throughout, not these
values plus an override.

| Item | Candidate binding |
| --- | --- |
| Image, local validation only | `target/omarchy-profile-r2.ext4`; 4,294,967,296 bytes; SHA-256 `47584cba39876ee958ea8fa39d3432488277d230abb2997b5999e54b8defe13e` |
| Chunk manifest | `target/omarchy-profile-chunks-r2-256k/manifest.json`; SHA-256 `ec1bc2601b104cfb6d6875c091377ccfd0654d5b6aab71c6a08ae37263f1c391` |
| Layout | Version 1, split; 16,384 logical chunks of 262,144 bytes; actual logical count is not unique-file count |
| Matching kernel | SHA-256 `af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce`; 24,208,896 bytes |

Add one kernel-only `web/artifacts-omarchy.json`, containing the accepted kernel
URL, SHA and size, with no rootfs, initramfs, bootSnapshot or overlayDelta entries.
Use a same-origin content-addressed URL such as
`releases/kernel/6.6.63/<kernel-sha>/Image`. Its actual serialized bytes get a new
SHA-256 after creation; do not invent that digest in this plan.

Add a frozen `OMARCHY_BOOT` descriptor in `web/main.js`, not a second selection
framework. Pin `manifestUrl: "./artifacts-omarchy.json"`, its computed
`manifestSha256`, and `imageManifestUrl` plus `imageManifestSha256`. Use
`./releases/omarchy/<chunk-manifest-sha>/manifest.json`, with sibling
`chunks/<sha>.bin` objects. Record the image SHA in the descriptor/evidence as the
offline image-to-manifest binding; it is not a substitute for hashing the manifest.

Set these boot options explicitly:

```js
mode: "chunked",
persist: false,
bootSnapshot: false,
bootProfileUrl: null,
extraDiskUrl: null,
fileTransfer: false,
slirpNet: false,
slirpProvider: "offline",
slirpDoh: "",
enableMic: false,
ramMib: 1024,
imageLen: 4294967296,
guestClock: "icount",
bootargs: "root=/dev/vda rw console=ttyS0 earlycon=sbi",
```

Carry the **accepted T03a** execution policy, including any explicit divider and
bootargs change, into this one descriptor and its tests. Divider 64 is currently a
diagnostic choice, not permission to change the global default. No page-query or
harness-only override may be necessary to make the default acceptance run boot.
Leave general worker/JIT implementations intact; require the real worker backend
for this Omarchy path and surface unavailability instead of silently selecting a
different backend. Keep the measured Canvas2D presentation policy.

`persist:false` still permits a fresh, in-memory copy-on-write disk for necessary
guest startup writes. It must not import, open, seed, save or restore a durable
overlay/snapshot. Do not turn the guest root filesystem read-only, clear someone
else's stored disks, or equate an empty durable store with a cold boot guarantee.

## 2. Exact production edit map

| File / current lines / function | Minimal intended edit |
| --- | --- |
| `web/main.js:1890–1957`, availability state / `bootAlpineFlavor` | Add `bootOmarchy()` alongside the explicit diagnostic helpers, using the fixed descriptor and existing `runLinuxBoot(..., {requestKey:"omarchy", onClaim})` single-flight owner. Do not reuse `bootAlpineFlavor`: it enables persistence and snapshots. |
| `web/main.js:1962–2060`, `window.wvmDemo` | Expose `bootOmarchy` and a read-only guest profile/boot-error projection. Keep console subscription and serial input APIs. Existing explicit legacy diagnostic helpers need not be rewritten, but must never be called by default startup, embed startup or error recovery. |
| `web/main.js:2930–3019`, startup IIFE / `runConfiguredAutoBoot` | Remove default Alpine/Node availability probes and the Node → BusyBox fallback. Normal startup calls only `bootOmarchy`. Keep `noAutoBoot` as a diagnostic opt-out. Remove `guest`/`boot` as automatic legacy selectors; reject non-Omarchy values visibly instead of selecting another guest or disguising them as success. Legacy regression fixtures can explicitly opt out and invoke their named diagnostic helper. Preserve the 400 ms single-flight claim/test event where useful. |
| `web/main.js:13–30,1184–1188,1460–1484,1668–1688`, worker selection / failure paths | For Omarchy, reject a missing worker or incompatible forced backend visibly; do not suggest a legacy boot as recovery. Keep the current owner-generation teardown and no-second-worker-on-error invariant. Set `lastBootError` on asynchronous errors as well as initial failures. |
| `web/main.js:1275–1328`, worker options | Pass the two new digest options unchanged through `...opts`; do not let persistence, snapshot, rootfs, network or guest selection query parameters override the fixed Omarchy descriptor. The known full image length replaces the current 512 MiB progress assumption. |
| `web/main.js:1345–1390,1893–1905`, `onState`, `onOutput`, readiness | Separate "serial shell ready" from desktop readiness. For Omarchy recognize the real non-root prompt after stripping OSC (BEL/ST), DCS and CSI, across output-chunk boundaries; retain enough raw tail for OSC3008 rather than truncating at 200 bytes first. A prompt stops serial boot-progress polling but does not claim Hyprland, Foot, setup completion or keyboard success. No image-specific fabricated ready string. |
| `web/main.js:2386–2405`, `setGuestChip` | Show `omarchy@omarchy-demo` / UID 1000 profile information, not `root@omarchy`; distinguish selected profile from independently observed login identity. Keep errors readable in the serial transcript and a visible status element. |
| `web/index.html:1028–1041,1128`, default tab/panel; `web/tabs.js:1–16,25–43,57–59` | Make Demo/IDE active by default and honor explicit `#roadmap`/`#docs` deep links. Update both initial HTML and the JS default. On entering Demo focus the display, not xterm; serial remains deliberately focusable. |
| `web/index.html:781–787,1275–1294`, embed CSS / startup | Remove the independent `runBusybox()` timer. Embed must use the same Omarchy auto-boot path and display, not hide `.ide-body` and show only a terminal. |
| `web/landing.html:472`, `data-embed-src` | Remove the legacy `noAutoBoot` from the embed URL when removing its separate boot timer; otherwise the landing iframe never starts. Preserve the normal source-to-dist app link rewrite. |
| `web/ide.js:126–137,193–195,410–443,1069–1130,1237–1254` | Apply the desktop-first pane/focus changes below; preserve the existing canvas, terminal and drag controls, not a new demo page. |
| `web/ide.js:16,478–505,1135–1141,2447–2466` | Do not automatically browse `/root` or launch background file/container shell RPCs in the lean Omarchy profile. Default to a collapsed tools sidebar with an honest "not enabled for this profile" state; guard ready-event `loadTree` and Docker probes by profile. Keep their existing explicit diagnostic behavior elsewhere. Serial commands from the proof must not race automatic IDE commands. Show boot failures instead of overwriting them with "guest offline". |
| `web/roadmap.js:130–163`, capability declarations; `798–826`, `initRoadmap` | Add a specifically named clean Omarchy/Hyprland/Quickshell/Foot capability with the T03a receipt and eventual T04a evidence, not relabeled Weston evidence. Do not mark it live from ISA-test success. Keep `tasks.json` as task-status authority; only the normal owner/verifier lifecycle may advance statuses. |

For the pane tweak, put `#ide-root` in a desktop mode by default: collapsed tools
sidebar, hidden empty editor body/tabstrip/toolbar, display pane `flex:1 1 auto;
min-height:0`, and an initially 180 px serial pane with the existing resize handle.
Keep an explicit tools toggle that restores the existing editor arrangement; the
default must not spend most height on the empty editor below a 190 px thumbnail.
At 1320×1180 and 1024×768, assert a visible, positive-size canvas viewport with no
page overflow or covered serial controls. Let `DisplayViewportController` retain
its aspect-ratio/letterboxing behavior. Do not fake or stretch guest pixels.

The capability machinery must survive: retain the `#suite-*`, `#metric-*`,
`#hover-*`, `#roadmap-grid`, ELF run/reset bindings, `RISCV_TESTS`, and
`runSuite()` (`main.js:2728–2800`). The current list is **127**, including
`rv64mi-p-misaligned-virtual-pages`, not the historical 126 or HTML's stale 110.
Provide a small user-accessible disclosure/button for the retained compliance
panel rather than relying on Playwright's show-all CSS to make it reachable.

## 3. Manifest integrity at the consuming loader, not check-then-fetch

`web/loader.js:100–126` currently fetches/parses unsigned text;
`293–322` fetches the boot manifest and later the chunk manifest. Add optional
`manifestSha256` and `imageManifestSha256` options at `178–189` (mandatory in the
Omarchy descriptor, optional for existing diagnostic callers).

Implement a small verified-fetch helper in this file. Validate expected SHA
syntax before fetching. Fetch each manifest **once**, read its raw `arrayBuffer`,
hash those bytes with the existing `sha256hex`, compare against the code-pinned
expected digest, and only then UTF-8-decode with fatal decoding and parse. Use the
same verified boot object and the same verified chunk-manifest text for the rest
of this invocation. Do not hash `JSON.stringify(parsed)`, re-encode a normalized
text response for the expected file digest, or verify with a preliminary fetch
and let the existing loader fetch it again.

The chunk text passed at `loader.js:519` to `WasmLinux.newChunkedDisk` must be the
verified text from this helper. Preserve `360–366`'s hash check on the actual
downloaded kernel buffer and wasm's existing per-chunk verification before cache
insertion. Assert the expected manifest geometry as well. The manifest format
contains ordered chunk hashes, not a whole-image SHA: the external image verifier
binds that exact manifest digest to the accepted whole-image digest; the browser
authenticates the ordered mapping and every fetched chunk. It never fetches the
4 GiB rootfs merely to repeat the offline image hash.

Fail closed on missing/HTML/invalid-UTF8/invalid-JSON or digest-mismatched
manifests. Generalize `fetchAsset`'s stale Alpine/local-only error wording for
these paths. Failures must precede disk construction/storage access and must
reach the page's visible error state. Kernel/chunk substitution must fail even
when HTTP status and size are correct. A mutable transport alias cannot weaken
these byte checks.

Do not modify warm-state algorithms for this task. Explicit `persist:false`
bypasses the durable constructor (`398–500`) and stored restore (`679–702`);
`bootSnapshot:false` plus the kernel-only manifest excludes shipped restores
(`706–796`). Keep `bootProfileUrl:null` to avoid the default Alpine prefetch.
No import/export/reset/retry-as-writer UI may enable a snapshot or durable overlay
for this profile. Instrument that absence in tests; do not erase stores to pass.

Use `/releases/` content-addressed paths so `web/sw.js:28–34` already excludes
these assets. The boot descriptor JSON is shell-owned and protected by its
code-pinned digest; a mixed old/new shell fails visibly rather than choosing an
old guest. Record actual source/dist/manifest/wasm hashes at the tested build.

## 4. Real display, physical keys and actual-demo harness adapter

Reuse `main.js:70–139`'s `PresentationController`,
`onDisplayFrame:handleDisplayFrame` at `1323`, the viewport, and `__presentation`.
There is no second canvas, synthetic HTML, replacement worker, screenshot
background, or injected guest-ready state in the actual-demo success run.

The current keyboard host **and pointer host** are `#term`
(`main.js:509,780`). For Omarchy, bind existing physical capture/reconciler and
pointer bridge to the focusable display canvas/viewport; set canvas `tabindex=0`
and click-to-focus. Keep xterm's `onData`/backpressure sink strictly serial.
Disable Omarchy evdev forwarding when serial has focus, so diagnostic commands
cannot also type into Foot. Keep held-key lifecycle release, capture-off,
reserved shortcuts, modifier reconciliation and the existing adapter at
`1438–1460`. Switching away from the display releases held guest keys.

Also guard `roadmap.js:787–792`'s global `/` shortcut against a prevented event
or focused guest canvas: its current INPUT/TEXTAREA check excludes neither a
canvas nor an already-handled key. A Slash in a terminal pathname must not steal
focus into the roadmap search. Reuse existing evdev mapping (`null` on unknown
code), not a hand-written code/shiftKey mapper.

Extend only the reusable harness after the T03a run is released, with proposed
`--actual-demo` and `--demo-url` arguments. In this mode:

1. Load actual built `/dist/app.html` from `tools/serve-dev.sh` (or the actual
   staged `/app.html`); default boot, no `guest`, `noAutoBoot`, `persist`, snapshot,
   `startPaused` or execution-policy override on the happy URL. Existing public
   `__linuxCtl`, `__presentation`, `__keyboardCapture` and `wvmDemo` APIs suffice.
   Do not use `testHooks` to expose all panels and then call the result default
   layout. Preserve a fresh Chromium context and record any service-worker policy.
2. Install a console subscriber before auto-boot. A single additive
   `wvm:demo-api-ready` event immediately after `window.wvmDemo` closes
   (`main.js:2267`) lets an init-script observer subscribe synchronously with no
   polling race. Record raw serial via `wvmDemo.onConsole`, state/errors and real
   presentation counters. Observer failures must fail the evidence run.
3. Adapt `observeGuest`'s operations to the existing page controller: `start`
   waits for normal auto-boot, not a call to `startLinuxBootWorker`; serial uses
   `wvmDemo.sendInput`; capture awaits `__linuxCtl.pause()`, then samples its
   digest/clock/fetch stats and `__presentation.readPixels/state`. Return the
   same evidence shape where possible without pretending local counters are
   actual controller observations.
4. For local external assets only, map the exact requested content-addressed
   kernel/chunk URLs to the selected validated bytes. The existing server route
   `E5_T18A_DESKTOP_ASSET_DIR` → `/e5t18a-desktop/` (`serve-dev.sh:24–31,96–106`)
   can supply them via narrow harness asset routing. Forward bytes unchanged;
   never replace `/dist/app.html`, JS/wasm, or the built boot manifest, and never
   rewrite manifest digests/URLs in flight. This is a local transport binding,
   not evidence of public hosting. The production-shaped staged URLs are T04b's
   responsibility.
5. Preserve the observed-login UID 1000 check, split/echo-safe serial fences,
   bounded Hyprland polling and one-shot user journal diagnostics. Require a
   mapped Foot and a surface whose PID matches the actual package Quickshell
   process with `/usr/share/omarchy/shell`; no namespace-only acceptance.
6. For mandatory keyboard acceptance, focus the mapped Foot via observed
   Hyprland address and focus `#ide-display-canvas` in the page. Reuse
   `typePhysical`: explicit `ShiftLeft` down/up around physical codes for `%`,
   `>`, capitals, etc.; never `keyboard.type`, paste, direct serial command
   injection or direct `sendKeyboardEvent` calls from the proof in place of the
   actual DOM route. Record real evdev frame growth and a controller RPC barrier.
   Independently read the unique nonce file and owner UID via serial. Serial may
   check absence beforehand/read afterward, but must never write the nonce file.
7. Require `keyboardVerified:true`, nonuniform real framebuffer readback,
   successful presents, non-root identity, package-process/surface evidence and
   zero non-favicon console/page errors. Preserve failure transcript/screenshot
   on timeout; `--keyboard none` cannot satisfy this target. Do not reject every
   journal warning (the known missing `/dev/fuse` is not an absent executable).
8. Run the retained capability suite on this same built page/context, preferably
   after the guest evidence is captured and the guest paused. Click the real
   compliance control; require 127/127 and 0 failed plus the separated-page live
   pip. Record both desktop and suite screenshots, then check the controller
   identity did not change. ISA success alone never sets the Omarchy badge live.

The existing harness's local artifact receipt cannot replace runtime digest
enforcement. Actual-demo options must compare expected CLI image/manifest hashes
against the built descriptor; they may not replace the descriptor to force a
different image. Archive the actual fetched asset hashes and build identity.

## 5. Exact narrow gates to implement and run later

Proposed new tests: `web/tests/omarchy-boot.test.mjs` for the verified-fetch and
fixed-config boundary (mock fetch/storage/constructor, no guest), and
`web/tests/omarchy-demo.spec.js` for actual app DOM/input/startup wiring with
explicitly labeled fixture tests. Keep fixtures out of the real acceptance run.

- Default request selects only Omarchy; absent or corrupt Omarchy assets produce
  one visible failure and no Alpine/Node/BusyBox request. Attack `guest`, `boot`,
  `persist=1`, `keep`, `noSnapshot`, root-shell bootargs and backend overrides.
  Confirm same-owner joins and competing helper calls cannot replace the worker.
- Manifest sabotage: valid JSON with a changed chunk hash, whitespace-only byte
  change, invalid digest, HTML, bad UTF-8, and HTTP failure. An alternating fetch
  fixture serves approved bytes first and substituted bytes second: assert one
  fetch and that the constructor receives exactly the approved text. Repeat for
  the kernel manifest. Missing SHA in the Omarchy descriptor is an error.
- Correct manifests with altered same-length kernel or first-demand chunk fail
  through the real loader/wasm integrity path; no worker replacement, mapped
  desktop claim or legacy request. Stop the attack after the expected failure,
  not another complete cold boot. Keep browser failure expected and narrowly
  matched; do not waive such errors in the success run.
- Pre-existing legacy storage names/content cannot influence this boot. Spy on
  disk IndexedDB opens, storage persistence, overlay seeding and snapshot
  restoration: none is invoked. Same-origin unrelated data remains intact.
- OSC3008 longer than 300 bytes and split across callbacks still permits the
  observed non-root prompt; a command echo/marker or mere worker creation cannot
  report desktop readiness. Error state remains visible with the serial pane
  resized or tools collapsed.
- Default Demo, explicit roadmap/docs hashes, embed, tools toggle and both
  viewport sizes work. Canvas receives Shift+Digit5, Shift+Period, Slash, uppercase,
  Enter, release-on-blur and capture-off; serial receives only serial typing.
  Roadmap search must not steal canvas Slash; script-driven serial diagnostic
  bytes must not grow evdev frames. Verify the suite remains user-accessible.
- Harness self-tests retain unrelated-Quickshell-path/impostor-namespace attacks,
  keyboard mapping/fence tests, divider rejection and actual-demo identity option
  mismatch. A mocked display cannot satisfy guest process/nonce evidence.

Commands after implementing those files, **not run for this plan**:

```sh
node --check web/main.js
node --check web/loader.js
node --check tools/verify/omarchy-browser-session.mjs
node --test web/tests/omarchy-boot.test.mjs web/tests/keymap.test.mjs web/tests/keyboard-bridge.test.mjs web/tests/capture-policy.test.mjs web/tests/held-keys.test.mjs web/tests/modifier-lock-reconciliation.test.mjs web/tests/e4-t32-worker-protocol.test.mjs web/tests/e5-t06d-presentation.test.mjs web/tests/e5-t22b-viewport.test.mjs
node tools/verify/omarchy-browser-session.mjs --self-test
node tools/verify/omarchy-browser-session.mjs --smoke-test
```

From `web/`, run `npx playwright test tests/omarchy-demo.spec.js --project=chromium`
for bounded fixture/UI checks. Adapt existing `e4-t32-whole-worker.spec.js`
default-selection cases to explicit legacy diagnostics, and preserve the live
assertions from `e5.5-t02a-page-memory.spec.js` in the actual-demo acceptance;
do not use stale `web-ux.spec.js` missing-button assumptions as the new gate.

Add `make verify-E5.5-T04a` invoking the actual-demo harness with mandatory auto
keyboard and suite checks against the **already built, identity-checked** dist.
It must fail if dist/inputs are absent or stale, not rebuild while evidence runs.
Proposed invocation, using the final accepted identities rather than overrides:

```sh
OMARCHY_IMAGE=/absolute/accepted.ext4 \
OMARCHY_IMAGE_SHA256=<accepted-image-sha> \
OMARCHY_CHUNKS=/absolute/accepted-chunks \
OMARCHY_MANIFEST_SHA256=<accepted-manifest-sha> \
OMARCHY_OUTPUT_DIR=/absolute/new-t04a-evidence-dir \
make verify-E5.5-T04a
```

The target passes `--actual-demo --keyboard auto --timeout-ms 1800000`, serves
the built app on an allocated local port and records the URL. It does not pass a
special boot-policy override or substitute HTML. Record timeouts as failures,
never readiness. Full accepted build/harness/manifest/kernel hashes, serial
offsets, nonce ownership, screenshots, controller digest and suite totals are
required for the fresh verifier; planning and fixtures are not acceptance.

## 6. Build freeze, dirty dist and explicit staging workflow

Observed user dirt: `web/dist/artifacts.json` and
`web/dist/artifacts-node-alpine.json` have kernel SHA/size changed to af7 while
retaining legacy snapshot/overlay declarations. They are **not** Omarchy release
manifests. Preserve their exact bytes and staged/unstaged state; do not normalize,
revert or sweep them into T04a. Other unrelated worktree dirt is also out of scope.

Important existing behavior:

- `Makefile:141–160` (`web-build`) rebuilds wasm, runs npm ci, copies artifacts
  and calls `gen-web-manifest.sh`, which may include an old BusyBox snapshot.
- `tools/build-web-dist.sh:16–21` calls that build and deletes/recreates the
  entire dist. Its top-level copy includes a new `artifacts-omarchy.json`;
  `artifacts-alpine.json` is deliberately excluded. It copies `src`/wasm/vendor
  assets, moves source app `index.html` to dist `app.html` (`89–103`) and stamps
  the shell SW from the built bytes (`121–131`). Do not hand-edit only dist.
- `tools/git-hooks/pre-commit:9–10,18–30,49–51` rebuilds and broadly stages
  `web/dist` for staged web inputs, unless `SKIP_WEB_BUILD=1`. That default hook
  would capture the user dirt and invalidate a frozen run.

After T03a verification and release of the current freeze, the owner should:

1. Record tracked/staged changes and hashes of both dirty manifests; preserve
   their patch and exact bytes outside the build tree. Prefer building the
   approved source set in an isolated scratch checkout/worktree so this shared
   checkout's dirty dist is never deleted. Do not use broad stash/reset/checkout
   operations or relocate a live server's inputs.
2. Implement only the scoped integration, tests and Makefile target. Generate
   the kernel-only manifest, calculate its exact digest and pin it in source.
   Refresh roadmap task data only through the normal authorized owner lifecycle,
   not to pre-label T04a verified. Inventory all runtime assets for the build.
3. Run one explicit `make web-dist` in that approved isolated build tree. Audit
   generated `artifacts.json` separately; it remains a legacy diagnostic manifest,
   never the default. Confirm source/dist module equality, vendor URLs,
   `/app.html` root swap, SW version and the new manifest digest. Record a
   content-hash inventory of the complete tested runtime, not just Git HEAD.
4. Freeze that build; run narrow gates and the single actual built-page cold
   proof. Do not silently edit or rebuild served inputs mid-run. Review the
   generated diff before any selective promotion back to the shared checkout;
   leave both user-owned dist manifests untouched unless their owner explicitly
   reconciles them. Re-audit the final assembled tree if promotion changes it.
5. Stage exact approved source/test/Makefile paths, the new dist manifest and
   reviewed generated runtime paths individually. Review
   `git diff --cached --name-status` and `git diff --cached --check`; inspect that
   the two dirty manifests and unrelated files are absent unless explicitly
   approved. Never `git add .`, `git add web`, or `git add web/dist` here.
6. Only when the main owner authorizes a commit, use
   `SKIP_WEB_BUILD=1 git commit ...` so the hook cannot rebuild or broaden the
   staging set. This skips the hook's build, not proof or explicit dist staging.
   Check the commit's staged-runtime hashes equal the recorded build inventory;
   a skipped build without matching tested dist is not acceptable.

T04b owns copying the exact accepted chunks/kernel into the public staging tree,
file-count/size validation, any changes to `deploy-cloudflare.sh`'s current R2
rewrites and production publication. Do not run that script during T04a planning
or use it as a local build helper: it mutates dist and publishes. No original VM,
private source disk, warm snapshot or previous writable image enters either
release. No commit, task activation, build or deployment is part of this sidecar.
