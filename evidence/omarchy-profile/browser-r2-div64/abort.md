# Coordinator-stopped diagnostic, not acceptance

The splash-enabled divider-64 diagnostic used frozen harness `95927a1d` (source
SHA-256 `4761ea45dea5432dee64f867808e83d2e42e18cff3226a03ec75ac219d436417`).
Its source is also retained as `../frozen-harness-95927a1d.mjs`; the already-loaded
process was unaffected by the later harness edit for the separate no-splash run.

The recorded guest reached UID 1000 and its user manager, but no Hyprland process
was observed through probe 11. Serial output showed Plymouth quit/wait starting,
without completing or starting SDDM. Package units establish that SDDM is ordered
after plymouth-quit, whose timeout is 20 guest-seconds. This does not prove the
run would never reach the desktop; it motivates the supported no-splash trial.

The coordinator identified Chrome PID 82120 as a direct child of this diagnostic's
Node PID 82042, then requested its orderly termination. The resulting closed-page
error/failed capture is a deliberate host abort, not a newly discovered emulator
fault. No image, package, or guest state is published from this run. The separate
`browser-r2-div64-nosplash` cold proof continues with `plymouth.enable=0`.
