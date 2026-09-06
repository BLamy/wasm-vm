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

Deployment is deferred until the user's Epic 5 merge and Omarchy milestones.
