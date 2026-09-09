# Browser display modes

## Host hotplug boundary (E5-T22a)

The active guest exposes asynchronous `wvmDemo.setDisplay(width, height)` and
`wvmDemo.displayStats()`. Both the main-thread and module-worker controllers
use the same WasmLinux methods. Dimensions must be JavaScript numbers, finite
integers from 1 through 4095 inclusive. Both values are validated before any
device mutation; strings and coercible objects are not accepted.

`setDisplay` requests the preferred mode through the existing virtio-gpu
display-info/EDID and coalesced EVENT_DISPLAY boundary. It **does not** resize a
resource, force SET_SCANOUT, or mean that a compositor adopted the mode.

Stats separate `advertisedWidth/Height` and copied 128-byte `edid` from
`scanoutResource/Width/Height`. The latter describe the actual bound resource,
or null when none exists. `resourceCount` and `resourceBytes` come directly
from the GPU resource map, not browser presentation counters. `pendingEvents`
is the non-destructive guest-visible event bitfield. Reading stats does not ACK.

Without a GPU, the Wasm API returns false/null. A stopped direct controller also
returns false/null; a terminated worker rejects further RPCs. Reentrant access
returns an error without panicking. The main demo returns false/null before boot.

Open `display-hotplug.html` for a visible real-device diagnostic. Its
hash-checked eight-byte RISC-V fixture is intentionally paused; it is **not** a
Linux desktop or a compositor-resize demonstration.

## Remaining resize slices

T22b owns container/DPR observation, a 250 ms trailing debounce, minimum-size
policy and native-pixel stale-frame letterboxing. T22c owns actual in-place
Weston/DRM mode adoption; T22d owns the complete storm/lifetime/reload matrix.
Until those pass, a requested mode is not a verified end-to-end resize.

## Viewport policy (E5-T22b)

The main display and `display-resize.html` observe a dedicated viewport wrapper,
not the canvas they resize. CSS width/height times device-pixel ratio are rounded
to the nearest integer, then clamped to at least **320x240** and at most
**4095x4095**. A hidden zero-size wrapper does not request a mode. DPR is observed
with a rearmed resolution media query even if CSS dimensions do not change.
One bounded 250 ms scalar DPR check covers scale changes that update the browser
value without delivering the media-query event (observed in Chrome emulation).
It does not resize or touch the GPU while the value is unchanged and is cancelled
on disposal. The event-driven path follows the
[documented resolution-query pattern](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio#monitoring_screen_resolution_or_zoom_level_changes).
Requests use a **250 ms trailing debounce**; only an explicitly supplied
`testDebounceMs: 0` constructor option bypasses it. No production URL enables it.

The backing canvas follows the current viewport immediately. Its CSS size is
backing pixels divided by DPR, so neither resizing nor a minimum/maximum clamp
stretches guest pixels. If the target is clamped, the wrapper clips overflowing
native pixels or supplies a black background; it does not scale them to fit.

An old-size frame retains its own row stride. During the mismatch the sink
clips its top-left native pixels or pads the right/bottom edges with opaque black.
It retains only the established latest resource, with one bounded target-sized
temporary fit buffer (at most 4095x4095x4 bytes). A matching resource replaces the
whole visible image on its first frame, including when that frame's damage is
partial. That full repaint is decided when the backend actually paints, so
coalesced partial frames cannot discard it. Subsequent matching frames keep the
normal damage fast path; the mismatch diagnostic clears only after a paint.
WebGL context-loss replacement uses the same retained resource and fit policy.

Pointer mapping uses the guest resource's native CSS extent, not a stretched
target rectangle. Points in padding clamp to the old guest's edge. The diagnostic
page exercises this through the actual tablet controller; input ownership on the
main app's existing serial terminal remains unchanged.

`accepted` in viewport diagnostics means **host GPU request accepted**, not
guest compositor adoption. fbcon commonly ignores hotplug: **resize takes effect
at next mode set**. The display labels an old-size frame as waiting for the guest
mode set; the real compositor round trip and its two-second limit remain T22c-d.
Stopping/replacing a controller cannot apply an old response to a new viewport.
Disposal removes ResizeObserver, timer and DPR listener, including pending RPCs.

The resizable diagnostic uses an explicitly labeled synthetic pixel fixture and
a paused real GPU. “Match frame” supplies a synthetic matching-size frame; it
never purports to be Linux repainting. Fixed-size T18 evidence pages retain their
existing resource-following presentation policy.

## Reproduce the host proof

From a clean checkout with the pinned Rust/wasm-pack toolchain and local Chrome:

```sh
npm --prefix web ci --no-audit --no-fund
make verify-E5-T22a
```

The command runs the actual WasmLinux validation/reentrancy/resource tests,
the existing native config-event tests, worker protocol regression tests, two
real browser controllers with 1,003 updates each, and one built-demo 126/0 pass.
The guest instruction trace reads events_read through MMIO after a host request.
The browser JSON binds the source and deployed wasm digests. The built bundle
is committed; rebuild it with `make web-dist` after changing runtime sources.
The local evidence server supplies the committed Alpine artifact manifest using
the same staging input as `deploy-cloudflare.sh`; an untracked dist copy is not
a prerequisite.

Deployment is deferred until the user's Epic 5 merge and Omarchy milestones.
