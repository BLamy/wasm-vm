---
id: E2-T26
epic: 2
title: "Capstone: unmodified Alpine riscv64 boots to a login shell in the browser"
priority: 226
status: pending
depends_on: [E2-T19, E2-T20, E2-T22, E2-T23, E2-T24, E2-T25]
estimate: L
capstone: true
---

## Goal
The Level 2 threshold, demonstrated end-to-end. First the minimal-platform proof: the
browser tab boots **xv6-riscv** to its `$` shell (Layer A + minimal Layer B). Then the full
milestone: the same page loads the WASM machine, fetches the pinned Linux kernel and Alpine
ext4 image, boots unmodified Linux from virtio-blk to a `login:` prompt in xterm.js; a human
logs in, uses `vi`, `top`, and shell scripts, and runs `poweroff` to a clean, UI-acknowledged
halt. Real OS kernels — tiny and full — in the tab.

## Context
Integration of everything in this epic: T21's loader feeds T10's MemBackend and boots the
T12 kernel against the T18 rootfs over T08/T09/T11 virtio-blk, on the T02 DTB with
T04–T06 SBI, consoled through T07+T22 xterm.js, timed by T05+T16+T23, shut down via T17,
watched by T20, at the speed T25 measured. Expected gaps to close here: the wasm build of
the full device stack (anything `cfg`-gated wrongly shows up now), the T17 ExitReason
event surfacing as a "machine halted — reload to boot again" UI state, and a browser
subset of T24's battery. Per the capstone protocol (tasks/README.md), the demo must run
from a cold start: fresh clone, `tools/build-all.sh` (or documented artifact download),
fresh browser profile, no dev-server state. Record the demo (screen capture) and check in
the script that reproduces it. This is the "demoable to anyone" moment from the roadmap —
a public URL is not required, `tools/serve-dev.sh` is.

## Deliverables
- The working page: load → progress → boot log streaming in xterm.js → `login:` →
  interactive session → poweroff → halted state UI.
- `tools/demo-capstone.sh`: builds/fetches artifacts, serves, prints the URL and the
  demo script (login, vi, top, script, poweroff).
- Playwright end-to-end test automating the entire capstone flow headless, kept green in
  CI; demo recording checked into `docs/media/`.
- Updated `README.md` top-level: how to run Level 2 in your own browser.

## Acceptance criteria
- [ ] Fresh clone + documented commands → the browser boots xv6-riscv to `$` and runs `ls`.
- [ ] Fresh clone + documented commands → browser shows Alpine `login:`; root login works.
- [ ] In the browser: `vi /root/hello.sh` — write a 3-line script with a loop, save;
      `sh /root/hello.sh` produces correct output; `top` renders and updates live; ^C
      exits it cleanly.
- [ ] `poweroff` runs OpenRC shutdown, kernel prints "Power down", the page shows a
      distinct halted state, and a subsequent externally-run `fsck.ext4 -f -n` on the
      served image's post-session state (native re-check of the same flow) is clean.
- [ ] Boot to login: measured time recorded and within 2x of the T25 browser baseline.
- [ ] Playwright capstone test passes 3/3 consecutive runs with fresh browser contexts.
- [ ] Storm detector (T20) reports zero anomalies across the full demo session.

## Adversarial verification
Cold-start rule is absolute: verify on a machine/profile that has never run the project
(or a pristine container + fresh Chromium profile); any undocumented dependency or
leftover-state reliance refutes. Run the full demo 3x with fresh contexts; then adversarial
variations: Slow-3G throttled load; background the tab for 2 min mid-boot and after login
(T23 claims under fire); paste a 100 KB script into vi; run `dd if=/dev/zero of=/x bs=1M
count=128` then `md5sum` read-back in-browser; attempt login with a wrong password first.
Any hang, storm dump, dropped input, corrupted file, or dirty post-poweroff journal
refutes. Compare the session subjectively and objectively (boot time, `top` refresh
smoothness, ^C latency) against webvm.io/alpine.html and record the comparison in the log
— parity is not required at Level 2, but the delta must be measured and stated. Finally,
confirm the kernel and rootfs artifacts' sha256 match `releases/` manifests — any locally
patched artifact refutes "unmodified".

## Verification log
(empty)
