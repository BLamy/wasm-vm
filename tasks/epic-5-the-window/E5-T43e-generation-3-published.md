---
id: E5-T43e
epic: 5
title: Generation 3 published — E5-T43c's image and a warm snapshot captured with the DHCP lease
priority: 0.3876631
status: in-progress
depends_on: [E5-T43c]
estimate: S
risk: medium
capstone: false
---

## Boundary

`tools/build-replay-desktop-snapshot.sh` boots the capture with the slirp NIC (`--net-slirp`) so the
guest holds its lease when the snapshot is taken; generation 3 (E5-T43c's image with a quieter
Chrome, and that snapshot) published: `web/artifacts-replay-desktop.json`, the release files, the roadmap
row, deploy. The page stays offline (`slirpNet: false`); E5-T43f turns networking on.

Revised 2026-11-27, before the claim. The first capture with the slirp NIC was 2.5 MB larger than the
same image captured with the loopback NIC (136.70 vs 134.19 MB). Its guest held Chrome's TCP
connections to Google: the net log shows `accounts.google.com/ListAccounts`, a preconnect to
`www.google.com`, the intermediate-certificate fetches from `i.pki.goog` that follow, and an mDNS
socket (`evidence/e5-t43e/probe/`). Online, every desktop would carry that traffic through the relay,
and a snapshot would hold connections its peers do not know. So the image changes:
`replay-chromium` gains the usual quiet-Chrome flags (no network time, Media Router, Translate,
optimization hints, pings, sign-in endpoint pointed at a closed local port) and
`/etc/chromium/policies/managed/replay-desktop.json` turns off sign-in, network prediction and
search suggestions. The capture refuses to snapshot a guest holding an ESTABLISHED TCP connection.

## Deterministic acceptance

- The capture's console shows `REPLAY_NETWORK bound` before the compaction trigger, the guest holds
  no TCP connection at capture, and the snapshot is no larger than generation 2's plus 2 MB (134.1 MB).
- Online (native `--net-slirp`), after the capture's settle, Chrome has contacted no host; E5-T43c's
  acceptance (`tools/verify/e5-t43c-guest-dhcp.mjs`, three machines) and the E5-T41a and E5-T36b
  acceptances pass on the new image.
- Committed bundle and the live site: warm resume passes; click, key echo and `node -e` not slower
  than generation 2 on the same bundle (tools/perf measurements, same method as E5-T41b); idle
  worker time within 2 points of generation 2's (1.2 %).

## Adversarial verification

Medium risk (deployment claim). Attack list: the resumed guest's lease is the capture's (from the
native slirp stack); the browser's slirp stack must offer the same address, router and DNS server,
or the guest must re-lease — show which, from both stacks' sources (E5-T43c's verifier carried this
"stale lease on resume" attack here). Offline, the resumed guest's lease points at a gateway the
loopback NIC echoes: show the desktop is unaffected (idle, no storm of frames).

## Verification log
