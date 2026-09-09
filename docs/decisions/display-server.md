# Display-server decision

## Decision

Select **Weston with its DRM/Pixman renderer**, `foot` as the terminal, and `wl-clipboard` as the clipboard tool for E5-T17. The decision is based on the exact inside-emulator captures below: Weston has the lower idle instruction ratio, lower peak RSS, and fewer idle wakeups, while both candidates remain below the 2% idle-cost budget. Weston’s cold start is slightly slower and its 100-character typing path uploads more damage bytes; those are recorded trade-offs, not extrapolations.

Labwc is not selected because its capture reports no cursorq traffic and explicitly classifies that as a capability gap. The Weston choice therefore does not rely on an unobserved hardware cursor path; it uses the verified DRM/Pixman path and keeps cursor-plane acceleration a documented revisit trigger.

## Finalist comparison

All values are from the native riscv64 emulator and the shared T16a six-phase workload. “Typing damage” is independently recomputed from the raw T09 uploadedBytes counter points for the type-100 phase.

| Metric | labwc / Pixman | Weston / Pixman |
|---|---:|---:|
| Cold start (guest wall time) | 491094.899541 ms | 506129.576666 ms |
| Total retired guest instructions | 4,246,036,068 instructions | 5,332,024,187 instructions |
| Idle instructions (1 s phase) | 19,396,639 instructions | 19,396,638 instructions |
| Idle instruction ratio | 0.4568% | 0.3638% |
| 100-character typing damage | 0 bytes | 36,864,000 bytes |
| Peak guest RSS | 20,512,768 bytes | 18,612,224 bytes |
| Idle wakeups | 437 wakeups | 427 wakeups |
| Idle wakeups per second | 156.107006 wakeups/s | 149.663437 wakeups/s |
| Cursorq use | 0 events; capability gap | 0 events; capability gap |
| Workload outcome | passed | passed |

Both rows passed cold start, idle, terminal open, 100-character typing, 300 px drag, and close. The labwc capture is [evidence/e5-t16b/labwc-capture.json](../../evidence/e5-t16b/labwc-capture.json); the Weston capture is [evidence/e5-t16c/weston-capture.json](../../evidence/e5-t16c/weston-capture.json). Renderer provenance is WLR_BACKENDS=drm WLR_RENDERER=pixman for labwc and weston --backend=drm --renderer=pixman plus Using Pixman renderer for Weston.

## Damage recomputation

The independent calculation is exactly phases[type-100].end.uploadedBytes - phases[type-100].start.uploadedBytes from each raw capture, not the summary field:

- labwc / Pixman: **0 bytes** for 100 characters.
- Weston / Pixman: **36,864,000 bytes** for 100 characters.

The zero-byte labwc result is retained as observed counter data and is not treated as a cursorq or rendering success claim.

## Winner variance

The baseline idle-ratio margin is labwc minus Weston: **0.0930%** (0.0930 percentage points). Two fresh Weston cold replays were made from separate copies of the same clean T16e image:

| Replay | Cold start | Idle instructions | Idle ratio | Typing damage | Peak RSS | Idle wakeups | Outcome |
|---|---:|---:|---:|---:|---:|---:|---|
| weston-rerun-1 | 491808.906000 ms | 19,396,611 | 0.3646% | 36,864,000 | 18,612,224 | 437 | passed |
| weston-rerun-2 | 491001.875042 ms | 19,396,628 | 0.3646% | 36,864,000 | 18,743,296 | 438 | passed |

Using the declared method of maximum absolute deviation from the two-run mean, the fresh-run variance is **0.0000%**, with spread **0.0000%**. It is below the **0.0930%** winning margin, so this decision is published. Any future rerun whose maximum deviation exceeds that margin should fail this gate and reopen the decision.

## T17 handoff

Use the exact signed package set below against the v3.20 riscv64 main and community repositories. The full dependency closure, signatures, search output, install output, and package-info records are in [evidence/e5-t16d/package-audit.json](../../evidence/e5-t16d/package-audit.json) and [evidence/e5-t16d/package-audit-verification.json](../../evidence/e5-t16d/package-audit-verification.json).

Repositories:

- https://dl-cdn.alpinelinux.org/alpine/v3.20/main
- https://dl-cdn.alpinelinux.org/alpine/v3.20/community

| Requested package | Installed version |
|---|---|
| `weston` | `weston-12.0.4-r0` |
| `weston-backend-drm` | `weston-backend-drm-12.0.4-r0` |
| `weston-shell-desktop` | `weston-shell-desktop-12.0.4-r0` |
| `foot` | `foot-1.17.2-r0` |
| `seatd` | `seatd-0.8.0-r0` |
| `eudev` | `eudev-3.2.14-r2` |
| `udev-init-scripts` | `udev-init-scripts-35-r1` |
| `pixman` | `pixman-0.43.2-r0` |
| `xkeyboard-config` | `xkeyboard-config-2.41-r0` |
| `wl-clipboard` | `wl-clipboard-2.2.0-r1` |
| `font-dejavu` | `font-dejavu-2.37-r5` |

Configuration sketch for T17:

1. Start Weston as desktop with weston --backend=drm --renderer=pixman.
2. Keep seatd in the default runlevel; retain eudev and udev-init-scripts for device discovery.
3. Set XDG_RUNTIME_DIR=/run/user/1000 (0700, owned by desktop) and WAYLAND_DISPLAY=wayland-0 before launching Weston and foot.
4. Launch foot inside the Weston session; use wl-clipboard for the Wayland clipboard path.
5. Preserve the T16c launcher/file manifest inputs, including /usr/local/bin/e5-t16c-start-weston and /usr/local/bin/e5-t16c-open-terminal, while T17 gives them production names.

## Revisit triggers

- Re-run the two-candidate decision if a riscv64 package version, Weston DRM/Pixman behavior, or the selected dependency closure changes.
- Re-run if virgl, WebGPU, or another hardware-accelerated renderer becomes available in the guest; the current choice is specifically for the measured Pixman path.
- Reopen if Weston’s idle instruction ratio exceeds 2%, if its fresh-run variance exceeds the baseline margin, or if a later T15 cursor-plane implementation produces reliable cursorq traffic and changes the damage/RSS trade-off.
- Keep the no-GL/no-fbdev substitution rule: a production image must preserve the recorded DRM/Pixman launch unless a new measured decision replaces it.

## Evidence identity

- Fresh rerun source commit: 64abae1b813ea9eda66a3dee5887d5e93ec33d1e; clean source image SHA-256: 27bbdc06f63fd611fbb2c071d56b5ec1bbfd696a8d9180c81c33a45e5ed5ed95.
- T16d package audit: [evidence/e5-t16d/package-audit.json](../../evidence/e5-t16d/package-audit.json).
- Fresh winner reruns: [evidence/e5-t16e/winner-reruns.json](../../evidence/e5-t16e/winner-reruns.json).
- Machine-readable decision: [evidence/e5-t16e/display-server-decision.json](../../evidence/e5-t16e/display-server-decision.json).
- Scope is native emulator/guest evidence only; independent-machine, WebKit, and host-rr legs are waived for this decision.
