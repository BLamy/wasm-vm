---
id: E3-T15
epic: 3
title: Internal DHCP server and DNS forwarder in the slirp stack
priority: 315
status: pending
depends_on: [E3-T14]
estimate: M
capstone: false
---

## Goal
Zero-config guest networking: Alpine's stock `udhcpc` gets a lease from our in-slirp DHCP
server (10.0.2.15, gateway 10.0.2.2, DNS 10.0.2.3), and DNS queries to 10.0.2.3 are answered
by a forwarder that resolves names through the transport layer. `rc-service networking
start` (or the boot default) just works.

## Context
DHCP: implement DISCOVER/OFFER/REQUEST/ACK (+ NAK on wrong-address REQUEST, and RENEW
half-time unicast renewals) over the slirp UDP path on 67/68 — single static lease is fine,
but the state machine must be correct because udhcpc retries and renews for the tab's
lifetime. Options served: subnet mask, router, DNS, lease time (86400), MTU (see slirp doc —
if transports impose an effective MTU, advertise it here rather than discovering fragmentation
bugs later). DNS forwarder on 10.0.2.3:53 (UDP first; TCP fallback for truncated answers is
in scope): parse queries (A/AAAA/CNAME minimum), resolve via a `Resolver` trait — browser
impl uses DoH (`fetch` to a JSON/wireformat DoH endpoint, e.g. cloudflare-dns.com, endpoint
configurable) since raw UDP/53 is impossible from a page; native impl uses the OS resolver.
Cache answers respecting TTL with a cap (300 s) and a floor (5 s); return SERVFAIL on
resolver failure, never hang. AAAA policy: answer honestly but note the stack is IPv4-only,
so consider returning empty AAAA (document the choice — broken IPv6 answers make guests
slow via happy-eyeballs timeouts).

## Deliverables
- DHCP server module in the slirp crate with a real state machine + unit tests against
  captured udhcpc exchanges (pcap fixtures from T13's PcapBackend).
- DNS forwarder module + `Resolver` trait; DoH resolver (wasm), OS resolver (native);
  TTL cache; the documented AAAA policy.
- Config surface: DoH endpoint URL, lease parameters.
- Native + browser boot tests: unmodified Alpine acquires its lease and resolves names.

## Acceptance criteria
- [ ] Cold boot with stock `/etc/network/interfaces` DHCP config: `ip addr` shows
      10.0.2.15/24, default route via 10.0.2.2, `/etc/resolv.conf` contains 10.0.2.3 —
      no guest-side manual commands.
- [ ] `nslookup dl-cdn.alpinelinux.org` in the guest returns addresses (browser build,
      via DoH; native build via OS resolver).
- [ ] udhcpc renewal at T1 succeeds (shorten lease to 60 s in a test config and observe a
      RENEW→ACK in the pcap capture without connectivity loss).
- [ ] A query for a nonexistent domain returns NXDOMAIN to the guest within 5 s; DoH
      endpoint unreachable returns SERVFAIL within the timeout, and `wget` fails fast with
      a name-resolution error rather than hanging.
- [ ] DNS cache: two back-to-back queries for the same name produce one upstream DoH fetch
      (instrumented counter).

## Adversarial verification
Fuzz both servers with malformed packets: DHCP with truncated options / missing message-type
option / bogus siaddr; DNS with compression-pointer loops, zero-QD queries, oversized names —
any panic or malformed reply (validate with a parser, e.g. `dig`-style checks on the pcap)
refutes. Send a DHCPREQUEST for 10.0.2.99 — must NAK, and udhcpc must recover to a correct
lease. Kill the DoH endpoint mid-boot and verify boot still completes (networking degraded,
not hung). Query a name with a 1 s TTL twice, 2 s apart — a stale cached answer past TTL+
floor refutes. Confirm truncated (TC=1) UDP answers trigger the guest's TCP retry and that
path works.

## Verification log
(empty)
