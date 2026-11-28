---
id: E5-T43c
epic: 5
title: Replay desktop image — the guest brings up eth0 with DHCP and resolves names
priority: 0.387662
status: in-progress
depends_on: []
estimate: S
risk: medium
capstone: false
---

## Boundary

Guest image sources only (`tools/replay-desktop/rootfs/`): rcS brings up `lo` and `eth0` and
runs busybox `udhcpc` in the background with a script that sets the address, the default route
and `/run/resolv.conf` (the root is read-only; `/etc/resolv.conf` becomes a link to it). It must
not delay `REPLAY_DESKTOP_READY` and must be harmless with no network device or no DHCP server.
The image is local; E5-T43d publishes it.

## Deterministic acceptance

Native CLI with its network backend (`--net`): the guest gets an address, a default route and a
nameserver; `node -e 'fetch("http://example.com").then(r=>console.log(r.status))'` prints 200
in the guest; READY's guest uptime within 0.3 s of generation 2's; the E5-T36b and E5-T41a
acceptances still pass on the image. Without `--net`, READY is unchanged and nothing waits.

## Adversarial verification

Medium risk. Attack list: no DHCP answer (READY must not wait); a lease renewal; the warm
snapshot captured before or after the lease (E5-T43d must not resume with a stale address).

## Verification log
