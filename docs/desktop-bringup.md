# Desktop bring-up playbook

This is the operating record for E5-T18a–e on the local Apple Silicon Mac.
The selected guest is Alpine riscv64, Weston 12.0.4's DRM backend and pixman
renderer, desktop-shell's Terminal launcher, and foot. It is not yet Omarchy.
WebKit, independent machines, `ssh dev`, and rr are outside this delivery's scope.

## Rebuild and prove the published image

Prerequisites: the repository's Rust/wasm-pack/Zig toolchains, Node, Google Chrome,
and local Docker/Colima. Put the checkout below a Colima-shared directory such as
`/Users/blamy/Documents/Codex`; `/private/tmp` is not shared by this installation.
The kernel and baseline bundle inputs are the committed `releases/` artifacts.
No guest image from a previous working directory is needed by the command:

```sh
make verify-E5-T18e
```

The command removes inherited Rust/Cargo overrides from child build environments,
creates a new output directory, supplies the committed full package and custom-file
locks in `tools/image/e5-t18e/`, and invokes the existing image builder with
`E5_T18B_INTERACTIVE=1 E5_T18D_RECOVERY=1`. It builds the native chunk tool and browser
WASM from source. Both manifests, the complete ext4, and all reconstructed served
chunks must match `tools/image/e5-t18d-desktop-image.json`; drift is an error, not a
request to refresh the lock automatically. No filesystem hand edits are permitted.

The image SHA-256 is
`e75b04caadd9616915b323497c92df1d5a9d11d55c877afcc95d208dde302416`.
The image has 8192 128-KiB chunk positions, 823 unique objects, and 190 packages.
The four installed recovery scripts are separately content-locked.

The final proof runs 25 fresh cache-disabled, service-worker-blocked Chromium
contexts with nonpersistent overlays. Every context must show the patterned
wallpaper, dark panel and launcher, and the independently sourced 94-pixel guest
cursor at the requested hotspot. A cache-enabled prime/reload pair measures warm
HTTP-cache behavior; it still boots a new guest, not a snapshot. Cold/warm durations,
concurrency, browser version, fetch statistics, framebuffer hashes, guest-state
digests, console errors and screenshots are recorded rather than inferred.

The default parallelism is 13 cold contexts plus the warm timing pair. These are
repeatability timings under the recorded load, not an isolated performance claim.
`E5_T18E_CONCURRENCY=1` serializes the cold-boot stream without reducing the
25-boot gate; the warm pair still runs concurrently with that stream.
Do not compare them to an isolated run without accounting for that configuration.
The report is `evidence/e5-t18e/desktop-bringup.json`; each completed boot also has
its own JSON, PNG and UART log so a later failure cannot erase earlier observations.

Cold contexts use Playwright context routing to disable HTTP caching in both the
page and dedicated workers. Page-only CDP cache settings do not cover worker
fetches, and the legacy `cacheHits` field counts page events only. Before booting,
a real-worker calibration must show network transfers for cold requests and byte
reuse for the warm reload. Each actual boot also records all completed worker
chunk ResourceTiming entries: cold boots require zero cached chunks, and the warm
reload requires at least one. A missing timing record is not accepted as a miss.

The initial run in `evidence/e5-t18e/initial/` completed all desktop/launcher cases
but exposed that page-only cache-control gap. Its clean rebuild remains valid;
its success marker is **not** the final cache-disabled verdict. For this specific
evidence-only correction, the following retains that recorded build while repeating
browser proof:

```sh
E5_T18E_REUSE_BUILD=/absolute/path/to/initial/checkout make verify-E5-T18e
```

The command accepts only the committed initial publication, rehashes its sources,
runtime, image and chunks, and rejects any changed build/runtime input. Without
that variable, the ordinary command still performs a complete clean rebuild.

## Debug channels and access boundaries

- The host's browser console, `__desktopTerminal.state()`, and
  `__desktopController.schedulerStats()` distinguish a stalled observer from a
  guest that is still retiring instructions. Frame counts alone do not prove a
  usable desktop; inspect the framebuffer.
- `/home/desktop/.local/state/wasm-vm/desktop.log` records timestamped attempt,
  start, ready, exit, restart and fallback events. `weston.log` contains the
  compositor's diagnostics. Readiness binds an attempt number to its actual PID.
- `/run/user/1000` must be a real directory owned by UID 1000 with mode 0700;
  `/run/seatd.sock` must be a socket, and `/dev/dri/card0` a character device.
- A localhost-only recovery boot exposes the fixed `status`, `log`, `tty`,
  `crash`, and `config-fail` verbs. It is not a root shell. Start a server with
  the rebuilt chunk directory from `publication.chunkDir` in the report, using
  the command below, then open `/desktop-recovery.html?recoveryTest=1`.
  `recoveryFault=config` adds
  a cold-boot config fault to that disposable overlay. The controls are disabled
  on production hosts. Normal boots execute the original serial getty.
- `tty` reads actual `/dev/vcs1` bytes and getty command lines; a printed claim
  that getty was started is not the fallback proof. The visible canvas must also
  contain the banner and login prompt.
- For authorized shell-based debugging in a disposable guest, use `dmesg`,
  `WAYLAND_DEBUG=1`, `libinput debug-events`, `ls -l /dev/dri/card0 /dev/input`,
  `id desktop`, and `stat -c '%u %g %a' /run/user/1000`. These are diagnostic
  channels, not instructions to add a password or root shell to the shipped image.
  Native GPU/input trace switches can separate device delivery from compositor
  behavior; use the CLI's `boot --help` for the current trace switches.

From the checkout that ran the rebuild, start the recovery server with its recorded
publication, not a historical task's output directory:

```sh
E5_T18D_DESKTOP_ASSET_DIR="$(node -p 'require("./evidence/e5-t18e/publication.json").publication.chunkDir')" \
  bash tools/serve-dev.sh 8000
```

## Symptom, diagnosis, fix

| Symptom | Distinguishing check | Committed fix / expected outcome |
|---|---|---|
| Compositor cannot open DRM or seat | Check `card0`, `id desktop`, udev rules, seatd socket and Weston log; inspect `desktop.log` | OpenRC orders runtime setup after seatd/udev. Keep the image's video/input/seat permissions. Missing video yields `video-device-missing`; no silent retry loop. |
| seatd starts late | Delay its fixture by 500 ms; observe socket followed by `event=ready` | Wait at most 30 polls for the socket. Never infer root process liveness with unprivileged `pidof`. A never-ready seat produces `seatd-not-ready`. |
| Immediate compositor exit / missing runtime directory | Inspect `/run/user/1000` type, UID and mode; read the fallback reason | OpenRC creates UID 1000 / 0700 once per boot. The launcher does not recreate missing initialization. Expect `runtime-directory-missing` or `runtime-directory-permissions`. |
| GL renderer fails or leaves a black surface | Check requested renderer and Weston stderr, not merely frame count | Explicit DRM + pixman. A forced `WLR_RENDERER=gles2` is rejected with `unsupported-renderer`. |
| Guest tty text exists but canvas is black | Compare `tty` text, framebuffer bytes and worker frame `format` | T18d preserves XRGB format in both worker message directions. XRGB padding is not alpha; the presentation path makes it opaque. |
| Desktop looks healthy but observer times out | Inspect screenshot: this wallpaper is neutral gray, not colorful | Use wallpaper brightness plus contrasting panel and launcher. Reject black, flat gray and sparse text; don't require colored wallpaper pixels. |
| No Terminal launcher / launcher opens nothing | Check desktop-shell launcher entry and executable `/usr/bin/weston-terminal` | T18b's interactive profile supplies the Terminal entry and wrapper that starts foot. Do not use the older cold-boot-only image for the input claim. |
| Pointer moves but launcher or window controls ignore clicks | Inspect ordered tablet coordinates and mouse BTN_LEFT events | Send absolute tablet motion first; Weston activates buttons through the mouse seat. Await worker RPCs in order. |
| Keys reach evdev but foot has no text | Check XKB data/root, evdev rules, pc105/us selection and content focus | Ship xkeyboard-config; set the XKB environment in the launcher. Focus the actual terminal client before typing. The accepted key stream has exact make/break ordering. |
| Long typed command loses characters | Compare physical DOM codes to virtio frames and guest instruction progress | Keep the interactive input budget and deterministic 10-ms key cadence from T18b. A visual marker alone cannot replace exact frame-sequence checks. |
| DPR 2 clicks miss controls | Inspect CSS origin/size and guest/tablet coordinate conversion | T18c uses CSS-to-guest mapping independently of DPR and half-open control bounds. Do not multiply already converted guest coordinates by DPR again. |
| Second window or cursor changes inferred window geometry | Inspect client-body edges below the top panel; compare cursor bitmap | Use dominant body edges, not extrema contaminated by the arrow. The second titlebar may be clipped under the 32-pixel panel. |
| A supposed close merely minimizes | Try Super+Tab with the matched guest-instruction budget | T18c's positive minimize/restore control distinguishes close from hide; do not accept disappearance alone. |
| Crash causes stale readiness or endless autologin | Match attempt, PID, exit and restart log entries | Remove stale readiness/socket state each attempt. Persist the at-most-three-attempt budget across getty reentry; reset only once at boot. |
| Third crash or broken config | Use `status`, `tty`, and the visible canvas together | Latched fallback clears PID/readiness and execs real tty1 getty with `desktop-fallback.issue`. A cold-boot config fault has zero started/ready events; removing config after readiness preserves that earlier attempt in the log before fallback. Rebuild corrected configuration and reboot. |
| Init or diagnostic read hangs on persisted state | Run the FIFO/symlink regressions; distinguish user-controlled nodes from regular files | Root diagnostics drop to UID 1000, reject links/special files, and bound reads. Init is bounded at 30 seconds and must not follow user-owned state as root. |
| BusyBox watchdog fires but caller never returns | Inspect the blocked pipe holder and UID after the timeout | Put timeout after `runuser`, then directly exec `head`/`tail`. Killing `runuser` itself orphaned the FIFO reader holding the substitution pipe. |
| Watcher never sees a serial marker that is visibly printed | Compare raw UART CRLF to the search string | Normalize CRLF only for parsing. Preserve the raw recording byte-for-byte. |
| Async Playwright wait appears to pass immediately | Check that the predicate returns a boolean, not a Promise | Pinned Playwright 1.49 needs Node-side awaited polling for async worker RPCs. An unresolved Promise is not guest progress. |
| Cache-enabled worker shows zero page cache hits, or a supposedly cold worker reuses bytes | Inspect worker ResourceTiming transfer/encoded body sizes, not page-only CDP counters | Configure cold context routing before creating the worker; calibrate with a real worker, then check every completed chunk request. Page-only cache disabling does not propagate to dedicated workers. |
| Docker fixture sees an empty checkout | Check the bind mount inside the container | Use a Colima-shared checkout below `/Users/blamy/Documents/Codex`, not `/private/tmp`. This is an environment failure, not guest evidence. |
| Built demo reports `artifacts-alpine.json` 404 | Inspect the missing URL before classifying console errors | Stage the manifest exactly as the Cloudflare deploy script does. Only favicon 404 is tolerated; no blanket error suppression. |

## Bounded failure drills for the fresh verifier

The following command is safe only in its disposable Linux container. It does not
alter the Mac's devices or the published image and finishes in under five minutes:

```sh
docker run --rm --network none -v "$PWD:/repo:ro" \
  wasm-vm-kernel-build:local python3 /repo/tools/verify/e5-t18d-local-fixtures.py
```

Its named cases remove the video device, remove runtime initialization, force
gles2, inject the 500-ms seat delay, and trigger three crashes. Match each result
to the table before reading the test's success count. It also exercises early
exit, startup timeout, stubborn shutdown, config removal, and getty reentry.
These are cheap shell/process fault drills; they do not replace the real guest
recovery evidence in `evidence/e5-t18d/` or T18e's rebuilt-image boots.

The promoted state-boundary regressions run separately:

```sh
docker run --rm --network none --cap-add SYS_PTRACE -v "$PWD:/repo:ro" \
  wasm-vm-kernel-build:local python3 \
  /repo/tools/verify/e5-t18d-state-boundaries.py --disposable
```

Publication integrity is independently rerunnable without starting a guest:

```sh
node tools/verify/e5-t18e-desktop-bringup.mjs --check-publication \
  target/e5-t18e/run-XXXXXX/image target/e5-t18e/run-XXXXXX/chunks
```

Use the exact paths from the report. The publication tests include byte, manifest,
missing-object and dimension mutants. The fresh verifier can copy a publication
into a scratch directory, change one byte there, and rerun this command: nonzero
exit is required. Never mutate the recorded image or refresh a lock to conceal drift.

## Historical timing and completion boundary

T18a's ten isolated cold boots took 505.829–513.291 seconds (mean 508.946); its
cache-enabled prime/reload took 514.956/515.739 seconds. Those results bind the older
T17 image, not the current interactive recovery image. T18e's report supplies the
new exact-artifact distribution; warm cache is not promised to speed guest execution.
Every script timeout is a host-time safety bound unless explicitly labeled guest
time. Do not mistake guest log timestamps for host elapsed time.

Finish the remaining Epic 5 resize, performance, snapshot, multi-display and
capstone work before merging the complete open PR chain. Only then reuse Claude's
prepared Omarchy filesystem, prove it running and deploy production. Stop before
Epic 6. Neither this playbook nor a green proof is early merge authorization.
