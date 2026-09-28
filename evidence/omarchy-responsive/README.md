# Omarchy responsive desktop: evidence

Keypress-to-visible-response of the Omarchy desktop in the real browser build, before and after
the responsive profile, plus the measurements that located the cost. All browser numbers below
come from `tools/verify/omarchy-responsive-latency.mjs` driving the built page (`web/dist`, WASM
sha256 `f09e0251…`, the same emulator build for every run) in headless Chrome at 1280x800, with
trusted DOM key events on the display canvas. The command typed is
`echo <12-hex nonce> | tee /tmp/wvm-resp-<hex>` (50 keys at ~10 keys/s, then Enter); the nonce
file is read back over the serial console afterwards, so the pixels are tied to the command having
actually run. Every run is in `browser/runs.json`.

Timing is on a shared, loaded machine (another ~6 builds running; load average in `runs.json`).
Guest speed is reported separately as guest MIPS (retired instructions per host second, sampled
from the worker) so emulator-core speedups can be attributed separately.

## Result

| pair (boot snapshot sha256) | runs | text echoed, after the last key | output line, after Enter | torn/stale frames | guest MIPS idle / typing |
|---|---|---|---|---|---|
| shipped today (`2231a21e`, stock kernel) | 3 | never (900 s deadline) | never; the command never ran (nonce file absent) | n/a | 22.6 / 11.5 |
| T03ar input-kernel pair (`265551f8`, evdev 1024) | 2 | 291 s, 377 s | 291 s, 376 s | not checked (v2) | 26.0 / 25.1 |
| responsive r3, LP_NUM_THREADS=1 (`ce0aa733`) | 3 (v3) | 20.7-21.8 s | 21.7-40.8 s (median 40.1) | 0 in v3 runs; 4 of 7 v2 runs showed torn milestone frames, 2 left a torn final screen | 18.2 / 16.0 |
| **responsive r6, LP_NUM_THREADS=0 (`a604fc36`)** | **6** | **4.8-7.5 s (median 5.4)** | **4.7-7.4 s (median 5.9)** | **0 of 28 frames** | 18.2 / 18.2 |
| **responsive r7, same recipe in one step (`0c34dc93`, publish candidate)** | **2** | **4.3, 4.6 s** | **4.2, 4.5 s** | **0 of 8 frames** | 19.0 / 19.9 |

"Echoed" is the first frame whose whole command row is glyph-verified (v3 harness, below). Typing
itself takes ~5.2 s; for r6 the first coherent frame showing typed text arrives 6.2-10.2 s after
the first key (median 7.9 s over 6 runs), i.e. while typing is still in progress or just after. Screenshots of
one r6 run's milestones: `browser/r6-a1-03-before-typing.png` → `-04-first-echo` →
`-05-full-echo` → `-06-output` → `-08-page` (page screenshot after the nonce readback). The shipped
pair after 815 s of waiting: `browser/shipped-v3-b1-page-after-815s.png` (empty prompt).

Idle: the shipped desktop never idles; the responsive desktop does (native CLI, restored pair, guest
`/proc/stat` over 10 guest seconds with nothing typed, `native/idle-*.json`):

| pair | guest idle share | top thread over 10.1 guest s |
|---|---|---|
| shipped | 0.00 | llvmpipe-0 1015 ticks (100% of the hart, recompositing) |
| responsive r3 | 0.994, 0.991 | none above 1 tick |
| responsive r4 (r6's session) | 0.993, 0.991 | none above 1 tick |

In the browser the shipped pair presents 0 frames in a 20 s idle window (each full-screen
recomposite takes longer than that); the responsive pairs present only the bar clock and cursor.

## Where the guest instructions went

1. **Continuous full-screen recomposite (shipped).** Per-thread `/proc` ticks and Hyprland damage
   logging on a restored shipped desktop (`attribution/01-03`): Quickshell's `omarchy.background`
   layer re-commits every frame and Hyprland damages a layer's whole geometry per commit, so
   llvmpipe recomposited 1280x800 back to back (~87% of the hart in llvmpipe-0). Its `.webp`
   wallpaper is not decodable in this image, so the layer drew nothing visible. With the plugin
   disabled the hart idles (`attribution/03`).
2. **Full-window damage per keystroke.** Foot 1.28 always binds `ext-background-effect`, and
   Hyprland 0.56 damages the whole window on each commit of such a surface (`attribution/04`);
   a Foot whose interface-name string is renamed (same length, nothing else changed) damages
   only the glyph cells (`attribution/05`). Hyprland options that did not help:
   `attribution/06`. Native, per typed command (`native/typing-instructions.json`, instructions
   from the first key): package desktop 8.0e9 to first echo; r3 4.9e8 to full echo, 3.4e8
   from Enter to output; r4 (LP0) 1.9e8 and 4.3e7.
3. **Torn and stale frames (LP_NUM_THREADS=1).** The v3 harness (below) found frames cut at
   screen y=64 (the llvmpipe 64x64 tile row) and whole stale buffers, and in 2 of 7 r3 runs the
   final screen stayed half drawn (`browser/r3-lp1-v2-a2-torn-final-frame.png`,
   `browser/r3-lp1-v2-a1-torn-echo-frame.png`). Cause: on virtio-gpu Hyprland 0.56 reports no
   explicit sync ("Explicit sync: missing" in
   `evidence/omarchy-profile/softpipe-r1/renderer-label-inspection/diagnostic.json`), and its software-renderer check reads the
   DRM driver name (`virtio_gpu`), so `endRender()` only `glFlush()`es before the atomic commit;
   the commit's TRANSFER_TO_HOST_2D can then copy a buffer the llvmpipe-0 thread is still
   rasterizing. LP_NUM_THREADS=0 rasterizes inside the flush on the compositor thread (on one hart
   the extra thread buys nothing). Full-screen repaints cost the same with either setting
   (`native/full-repaint-frame-costs.txt`, 4-9e8 instructions per frame). The variable is read
   when Hyprland starts and restarting the compositor unit ends the sddm session (tried), so the
   pair had to come from a fresh, cold-booted session.
4. **First real pointer event in a fresh session.** The first cold-booted LP0 pairs (r4, r5)
   took ~80 s to show typed text in the browser. Per-thread ticks after one action
   (`browser/first-click-diagnostic.txt`): the browser's click costs ~1.5-1.7e9 instructions on
   Hyprland's main thread the first time a session sees a real pointer device event, ~0.3 s of
   CPU the second time, and focus + key without a click is cheap; cursor settings and compositor
   warps (`hl.dsp.cursor.move`) do not pay or avoid it. The preparer now has the CLI inject one
   virtio-tablet click before capture (`WASM_VM_PREP_TABLET_CLICK`), which is r6.

## Harness (v3)

v2 scored milestones by pixel extent, which also accepted torn frames and, for "output", the
cursor block moving to row 1 alone (r3 v2 runs reported ~21 s where verified output was ~40 s).
v3 classifies every typed/echoed cell against the prompt's own glyphs (Foot draws a monospace
glyph identically in any cell) and counts a milestone only on a coherent frame; it reports
incoherent-frame counts and requires the final frame to show the full command and output. The
v2 pixel milestones are kept in `pixelMilestonesS` for comparison.

## Runtime defaults (web/main.js Omarchy: jitResidency repack-off, decodedCacheEntries 4096)

Interleaved on r6, same build (`browser/runs.json`, `r6-*`):

| setting | runs | echo after last key | output after Enter | idle MIPS | JIT share | JIT code |
|---|---|---|---|---|---|---|
| default (repack-off, 4096) | 5 | median 5.6 s | median 5.9 s | 17.8 | 0.25 | 1.4-1.7 MiB |
| jitResidency=cap-256 | 2 | 4.4, 6.7 s | 4.3, 6.6 s | 18.1 | 0.43 | 15-16 MiB |
| jitResidency=cap-1024 | 2 | 2.3, 5.7 s | 2.8, 6.4 s | 23.1 | 0.56 | 57-58 MiB |
| decodedCacheEntries=16384 | 2 | 6.2, 8.3 s | 6.7, 8.2 s | 17.0 | 0.25 | 1.4-1.6 MiB |

cap-1024 raises guest MIPS ~25% on this workload, but its compiled code (57 MiB) exceeds the
32 MiB budget E4-T38 documented for the browser (it measured 36 MiB there and kept repack-off).
cap-256 stays inside the budget but its latency gain is within run-to-run noise at n=2, and 16384
decoded entries shows no gain. The defaults are left unchanged; cap-1024 is a candidate only with
an explicit decision on the code-memory budget.

## Artifacts to publish

The responsive pair keeps the published 4 GiB image and chunk manifest
(`chunked-omarchy/manifest-5f6a0809….json`, base id `5f6a0809…`, unchanged); only three files
change. The candidate is r7, built in one step by the committed preparer with this branch's release
CLI (`prepare-receipt-r7.json`), in the worktree's gitignored `target/omarchy-responsive-pair-r7/`
(not in the main checkout). r6 (`target/omarchy-responsive-pair-r6/`, same configuration, built in
two steps) is an equivalent fallback with more browser runs:

| role | publish at | size (bytes) | sha256 |
|---|---|---|---|
| kernel (T03aq Image: EVDEV_MIN_BUFFER_SIZE 1024; the pair's RAM contains this kernel) | `releases/kernel/6.6.63-omarchy-evdev1024/Image` (new path: `releases/kernel/6.6.63/Image` stays the stock kernel that the Alpine/busybox manifests use) | 24208896 | `3cf8bed0d9a9941a6f2f81b7c8de86cefcba3e4e6bd5e5846bd395714a25642d` |
| RAM snapshot | `releases/boot-snapshot/omarchy-ready.snap.gz` (gitignored) | 198380324 | `0c34dc9389c52af167ed8e5f9e34c543b58c91205fc6b4e383bc3b0711ead256` |
| overlay delta | `releases/boot-snapshot/omarchy-overlay-delta.bin.gz` (tracked in git) | 2037489 | `b54280f45f5ca91aa01a4dcdc12e14b837b8d7918345067359707c955093c565` |

(r6 instead: RAM snapshot 198186826 bytes `a604fc368125e329cdccb3b06d381b03b340d235c0dafc47319dcc7f37cd712f`,
delta 2040210 bytes `4e9226913efd831997a0a85d3ad387f771614b957932f4f245d09902784e969c`.)

Source of the kernel: `target/omarchy-input-kernel-r3/Image` in the main checkout (built by T03aq).
`artifacts-omarchy.responsive.json` here is the manifest `tools/gen-omarchy-manifest.sh` generates
for exactly these files (`OMARCHY_KERNEL=releases/kernel/6.6.63-omarchy-evdev1024/Image`); it
passes `tools/validate-deploy-artifacts.py --reject-remote` against a staged copy. To publish:

```sh
cp <r7>/omarchy-ready.snap.gz <r7>/omarchy-overlay-delta.bin.gz releases/boot-snapshot/
mkdir -p releases/kernel/6.6.63-omarchy-evdev1024
cp target/omarchy-input-kernel-r3/Image releases/kernel/6.6.63-omarchy-evdev1024/Image
OMARCHY_KERNEL=releases/kernel/6.6.63-omarchy-evdev1024/Image bash tools/gen-omarchy-manifest.sh
git diff web/artifacts-omarchy.json   # must equal artifacts-omarchy.responsive.json
bash tools/deploy-cloudflare.sh
```

`tools/deploy-cloudflare.sh` stages manifests from `web/`, validates every local file against the
manifest's size and sha256, and then: the kernel (`releases/kernel/*`) goes to R2 under the
content-addressed key `sha256/3cf8bed0…/releases/kernel/6.6.63-omarchy-evdev1024/Image`; the RAM
snapshot is larger than the 25 MiB Pages limit, so it goes to R2 as
`sha256/0c34dc93…/releases/boot-snapshot/omarchy-ready.snap.gz`; the 2.0 MB delta ships on Pages
at `releases/boot-snapshot/omarchy-overlay-delta.bin.gz`. The manifest URLs are rewritten to the R2
public base. Nothing else (web code, chunks, other flavours) needs republishing; the web readiness
gate already accepts the bar-only shell (commit b94d11d5).

## Reproduce

```sh
# pair: cold boot from a source pair (profile + LP0 + one tablet click), same base/chunks
node tools/image/prepare-omarchy-responsive-cold.mjs --bin <wasm-vm with WASM_VM_PREP_TABLET_CLICK> \
  --kernel target/omarchy-input-kernel-r3/Image --pair <source pair> --base-image <ext4 of the chunks> \
  --chunks target/omarchy-profile-chunks-sdr-r3-256k --out <new dir>
# latency in the built page
node tools/verify/omarchy-responsive-latency.mjs <out> --pair <pair dir> \
  --kernel target/omarchy-input-kernel-r3/Image --chunks target/omarchy-profile-chunks-sdr-r3-256k
```

r7 is exactly that command (`prepare-receipt-r7.json`, 49 min of host time: restore + profile
0.6 min, cold boot to the serial prompt 11.1 min, whole cold phase 47.9 min). r6 was made in two steps: r4 = the cold
preparer before the tablet-click warm-up existed (`prepare-receipt-r4.json`), then `--warm-only`
on r4 (`prepare-receipt-r6.json`). A first one-step attempt failed closed when `hyprctl` timed out
on the still-busy fresh session; the preparer now waits for the session to settle and retries.
