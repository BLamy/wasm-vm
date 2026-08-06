---
id: E3-T22c
epic: 3
title: Guest image clipboard conveniences — vim OSC52 yank, tmux set-clipboard
priority: 322.3
status: verification-debt
depends_on: [E3-T22a]
estimate: S
risk: low
capstone: false
---

## Goal
The served guest image makes clipboard workflows work out of the box: a vim yank emits OSC 52 (so it
lands on the host clipboard), and tmux `set -s set-clipboard on` routes copies through OSC 52.

## Context
Split from **E3-T22**. Depends on the OSC 52 copy path (E3-T22a) actually landing text on the host
clipboard. Image/rootfs work (coordinates with the E3-T11 image pipeline).

## Deliverables
- vim config in the image with an OSC52 yank provider (or a `yank`-to-OSC52 helper).
- tmux config with `set -s set-clipboard on`.

## Acceptance criteria
- [ ] In guest vim (image defaults), yanking a line emits an OSC 52 sequence that reaches the host
  clipboard via the E3-T22a handler.
- [ ] tmux copy-mode yank routes through OSC 52.

## Verification log
- 2026-08-03 — **helper deterministically verified + wired into the image; the vim/tmux-in-image AC is
  boot-gated debt.** Delivered the ticket's "yank-to-OSC52 helper" branch with NO new packages (busybox
  base64+printf), so it works in the default image:
  - `tools/rootfs/osc52-copy` — pipe stdin to the host clipboard via `ESC]52;c;<base64>BEL`; the browser
    terminal's E3-T22a handler decodes it. `make verify-E3-T22c` (4 node --test cases, green) execs the
    helper under `/bin/sh` and asserts the exact byte sequence, UTF-8 round-trip, single-line payload
    (base64 wrap newlines stripped so the OSC can't self-terminate), and empty-input clipboard-clear.
  - Wired into the rootfs build: `tools/build-rootfs.sh` bind-mount + `tools/rootfs-inner.sh` installs
    `/usr/local/bin/osc52-copy` and drops `/root/.vimrc` (TextYankPost → osc52-copy, guarded by
    `executable('osc52-copy')`) + `/root/.tmux.conf` (`set-clipboard on`). The configs are INERT unless
    vim/tmux are added, so they add config, not image size. Added all three to the rootfs drift-gate
    manifest. Shell syntax validated.
  - REMAINING (boot-gated + a product decision): the AC "in guest vim, yanking a line emits OSC 52"
    needs full `vim` (busybox `vi` has no clipboard hooks) — i.e. `apk add vim tmux` (~30 MB), a served
    image-size call — plus an Alpine-boot proof on a host that can sustain it (browser Alpine reaps here;
    see [[browser-alpine-boot-reaped-on-mac]]). The helper + configs make that a config-flip once the
    packages are added.
