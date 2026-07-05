---
id: E7-T04
epic: 7
title: Transparent x86_64 execution — binfmt_misc registration and PATH integration
priority: 704
status: pending
depends_on: [E7-T03]
estimate: S
capstone: false
---

## Goal
Make running x86_64 binaries *transparent*: typing `./some-x86_64-app` (or an app the desktop
launches) Just Works, with the kernel's `binfmt_misc` handing x86_64 ELFs to box64
automatically — no explicit `box64` prefix. This is what turns "box64 can run a binary" into
"the machine runs x86_64 software."

## Context
Register box64 as the `binfmt_misc` interpreter for the x86_64 ELF magic
(`/proc/sys/fs/binfmt_misc/register`) at boot, with the `F` (fix-binary) flag so it survives
mount-namespace transitions. Ensure `CONFIG_BINFMT_MISC` is in the E5 kernel config (coordinate
if a rebuild is needed). Also wire PATH/desktop `.desktop` launchers so GUI file managers and
menus can start x86_64 apps. Verify interaction with the E5 desktop's session so launched apps
inherit the right environment (DISPLAY/WAYLAND_DISPLAY, box64 config).

## Deliverables
- A boot-time init script (OpenRC service) registering box64 in binfmt_misc with documented
  flags; kernel-config note if `CONFIG_BINFMT_MISC` had to be enabled.
- Verification that desktop launchers and shell PATH invocation both trigger box64 transparently.

## Acceptance criteria
- [ ] After boot, `./hello` (x86_64, chmod +x) runs with **no** `box64` prefix and prints
      the expected output; `cat /proc/sys/fs/binfmt_misc/box64` shows the registration.
- [ ] An x86_64 app launched from the desktop menu / file manager starts and runs.

## Adversarial verification
Unregister and re-register across a reboot — the service must restore it every boot (kill the
tab mid-session, reboot, confirm still registered). Launch an x86_64 binary from a different
mount namespace / after a `chroot`-like transition and confirm the `F` flag kept it working.
Confirm a riscv64 binary still runs natively (binfmt didn't hijack native execution) — a
native binary routed through box64 refutes.

## Verification log
(empty)
