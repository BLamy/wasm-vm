---
id: E5-T43c
epic: 5
title: Replay desktop image — the guest brings up eth0 with DHCP and resolves names
priority: 0.387662
status: verified
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

### 2026-11-27 — worker — claim (head `8f72805bf`)

Code: `32c5e4072` (rcS, `usr/local/share/udhcpc/default.script`, `assemble.py`'s
`/etc/resolv.conf → /run/resolv.conf` link); `8f72805bf` adds the acceptance script
`tools/verify/e5-t43c-guest-dhcp.mjs` and a `net` option to `tools/replay-desktop/native-shell.mjs`
(default `--net`, so the existing acceptances boot the same machine as before). The image was built at
`32c5e4072` (`bash tools/build-replay-desktop-image.sh target/e5-t43c/image`; `evidence/e5-t43c/image-build.json`
names the head; ext4 sha256 `2a6e727e346b…`); nothing under the image's sources changed after it. Release
CLI rebuilt at this head.

A note on the flag: the native CLI's `--net` is a loopback NIC with no DHCP server; the slirp stack (DHCP,
DNS, NAT) is `--net-slirp`. The acceptance's "with `--net`" is therefore run as `--mode slirp`
(`--net-slirp`), and `--net` is the "no DHCP answer" attack.

Baselines: generation 2 (`target/e5-t41a/image`, sha `20f03da7c51d…`) booted the same three machines with
`--ready-only`: READY 5.29 s (slirp), 5.29 s (loopback), 5.30 s (no NIC), `evidence/e5-t43c/baseline-gen2-*`.

Recorded runs, all on the new image, all passing (`evidence/e5-t43c/<run>/result.json`, console in `console.log`):

| Run | Command | READY | result.json sha256 |
|---|---|---|---|
| slirp | `node tools/verify/e5-t43c-guest-dhcp.mjs --image target/e5-t43c/image/replay-desktop.ext4 --out evidence/e5-t43c/slirp --mode slirp --baseline-ready 5.29` | 5.43 s (+0.14) | `2e7e13758d55…` |
| loopback (no DHCP answer) | same, `--mode loopback --baseline-ready 5.29` | 5.34 s (+0.05) | `e44bd37be1f1…` |
| no NIC | same, `--mode none --baseline-ready 5.3` | 5.32 s (+0.02) | `91c0d05c81bd…` |
| E5-T41a | `node tools/verify/e5-t41a-node-snapshot.mjs --image … --out evidence/e5-t43c/e5-t41a --baseline-ready 5.29` | 5.33 s | `731e1fd7048f…` |
| E5-T36b | `node tools/verify/e5-t36b-hardware-cursor.mjs --image … --out evidence/e5-t43c/e5-t36b` | — | `4d36d52b2598…` |

What the slirp run shows: `REPLAY_NETWORK bound ip=10.0.2.15 router=10.0.2.2 dns=10.0.2.3` on the console
before READY; eth0 holds exactly `10.0.2.15/24`; `default via 10.0.2.2 dev eth0`; `/etc/resolv.conf` →
`/run/resolv.conf` = `nameserver 10.0.2.3`; Node's `dns.lookup("example.com")` returns an IPv4 address;
`fetch("http://example.com")` and `fetch("https://example.com")` print `STATUS 200`. Renewal (`kill -USR1`
udhcpc): `REPLAY_NETWORK renew ip=10.0.2.15 …`, udhcpc logs "sending renew to server 10.0.2.2" then the
lease again; 219 samples of eth0's addresses taken across it are all exactly `10.0.2.15/24` (the hook
never removes the lease's own address); a fetch after it is still 200.

Without a DHCP server (`--net`): READY within 0.05 s; after 24 guest seconds eth0 has no address, no
default route, `/etc/resolv.conf` dangles, no `REPLAY_NETWORK` line, udhcpc is still running (it keeps
broadcasting discover), and `node` runs. With no NIC: no eth0, no udhcpc, the same otherwise.

Limits: the warm snapshot (E5-T43d) must be captured with the slirp NIC so the lease is in it; a resume
on another network would keep the old lease until udhcpc renews (12 h of a 24 h lease) — E5-T43d's concern,
as the attack list says. Offline with a NIC, udhcpc wakes every few seconds to broadcast; E5-T43d measures
idle with networking on, the page's offline mode is unchanged by this task.

### 2026-11-27 — verifier — VERDICT: verified

Fresh session, head `358f23b67` (claim on `8f72805bf`). Predictions written first:
`evidence/e5-t43c/verifier/predictions.md`. Image `target/e5-t43c/image/replay-desktop.ext4` sha256
`2a6e727e346b…` (`build.json` head `32c5e4072`; `git diff 32c5e4072..HEAD` touches no image source).
Two verifier boots on it, `--net-slirp --net-slirp-lease-secs 30` (`verifier/cli-lease30.sh`):
`verifier/attack/` and `verifier/attack2/` (result.json sha256 `a6b8c769ea82…`, `368a4f61fae0…`).

- P1 READY not delayed — HELD. `readyUptime` slirp 5.43 / loopback 5.34 / none 5.32 against measured gen-2
  baselines 5.29 / 5.29 / 5.30 (`baseline-gen2-*/result.json`, image `20f03da7c51d…`); my boots 5.36
  (`attack/console.log:27`) and 5.32 (`attack2/console.log:29`).
- P2 lease, route, resolver, fetch — HELD. `slirp/result.json` checks: addresses `["10.0.2.15/24"]`,
  `default via 10.0.2.2 dev eth0`, resolvConf `["nameserver 10.0.2.3"]`, lookup `ADDR 104.20.23.154`,
  fetchHttp/fetchHttps `STATUS 200`; bound line at `slirp/console.log:20`, before READY at :27.
- P3 no DHCP answer (`--net`) — HELD. `loopback/result.json`: no address, no default route,
  resolvConfExists `no`, udhcpc pid 76 still broadcasting, no REPLAY_NETWORK line, `NODE_OK`, READY +0.05 s.
- P4 no NIC — HELD. `none/result.json`: eth0 `absent`, udhcpc `none`.
- P5 regressions — HELD. `e5-t41a/result.json` and `e5-t36b/result.json` pass:true on imageSha256 `2a6e727e…`.
- P6 image == tree — HELD. In-guest sha256 of the hook `be821526…` and rcS `63419e63…` equal the repo files
  (`attack/result.json` checks.p6); udhcpc cmdline is rcS's.
- P7 renewal, novel attack — HELD. Real T1 renewals (30 s lease, no USR1) plus one USR1, hook traced with
  `sh -x` through a bind mount: 3 hook runs at guest 15.87 / 30.90 / 40.78 s, each `ip -4 addr replace
  10.0.2.15/24` and `route replace default via 10.0.2.2`, zero `addr del`, zero `flush`
  (`attack2/result.json` checks.p7.xtrace/summary); after them eth0 is `10.0.2.15/24` alone, resolv.conf
  unchanged, and a fetch is 200 (`attack/result.json` checks.p7.fetch). The first boot's `ip` PATH wrapper
  never ran (busybox ash runs its `ip` applet directly; `command -v ip` → `ip`): its iplog is void, the
  `sh -x` trace replaces it.
- P8 mock hunt, does the worker's renewal sampler discriminate — HELD as predicted (weak). The worker's exact
  sampler against a run-time flush+re-add hook: boot 1 caught 2 of 5; boot 2, with the window and the flush
  timestamped, the flush fell inside the window in 8 of 8 and the sampler still missed it in 3 (trials 6-8,
  `attack2/result.json` checks.p8). The renewal assertion in `tools/verify/e5-t43c-guest-dhcp.mjs` is
  probabilistic and would pass a flushing hook about 4 runs in 10; it is not what proves "the hook never
  removes the address" — the deterministic `sh -x` trace above is. Not a refutation: the product claim
  stands on P7; the sampler is a weak check, not a self-licking one.
- P9 snapshot timing — HELD (belongs to E5-T43d). E5-T43c has no snapshot in its boundary; capture is
  E5-T43d's ("a warm snapshot captured with the DHCP lease logic in place"). E5-T43d's own attack list does
  not yet name the stale-lease resume; its worker should carry this task's third attack across.
- P10 coverage. Executed: rcS hunk (all NIC runs; the `[ -d eth0 ]` false branch in `none`), hook bound/renew
  (every line on the true path, `attack2` xtrace), assemble.py link (`resolvLink` in every run),
  native-shell `net` (all three values), the script's three modes. Waived: hook `deconfig` (udhcpc runs it at
  start on an address-less eth0, no observable effect, not traced), `search $domain` true side (slirp sends no
  domain; the false test is traced). Redundant: rcS's new `ip link set lo up` repeats rcS line 15 (harmless
  no-op; delete when next touched).
- P11 flag mapping — HELD. `crates/cli/src/boot.rs:402-410`: `--net` is the loopback echo backend with no
  DHCP; only `--net-slirp` can satisfy "gets an address"; running the acceptance as `--mode slirp` and using
  `--net` as the no-answer attack is correct.

SUITE: discard — the deterministic check (P7) needs a guest-side `sh -x` bind mount; the scripts stay in
`evidence/e5-t43c/verifier/` (`attack2.mjs`) for whoever next touches the hook. Not checked: idle cost of
udhcpc's offline discover loop (no budget stated), browser path (E5-T43d), a lease change of address (slirp
always offers 10.0.2.15).
Commands: `node evidence/e5-t43c/verifier/attack.mjs`; `node evidence/e5-t43c/verifier/attack2.mjs`.
