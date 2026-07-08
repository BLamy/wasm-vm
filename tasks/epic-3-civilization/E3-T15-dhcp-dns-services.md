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

**2026-07-07 — pass 1a: DHCP server state machine (`dhcp.rs`).** The pure wire layer: parse a DHCP
message off the UDP:67 payload and produce the reply bytes (wiring it into the slirp UDP path is a
later slice; DNS forwarder is a separate slice). `DhcpServer::handle(&[u8]) -> Option<Vec<u8>>`, a
single static lease (guest always `net::GUEST` 10.0.2.15). State machine: DISCOVER→OFFER, REQUEST→ACK
when the wanted address (option 50, else ciaddr for unicast RENEW) is ours / NAK when it's wrong (so
`udhcpc` restarts cleanly); a SELECTING REQUEST (option 54) naming a different server is ignored (not
NAK'd — it's another server's lease); RELEASE/DECLINE/INFORM and `op=BOOTREPLY` get no reply. OFFER/ACK
options: message-type, server-id (10.0.2.2), lease-time (86400, configurable), subnet mask (/24 →
255.255.255.0), router (10.0.2.2), DNS (10.0.2.3), and link MTU (option 26, default 1500, configurable
for transports that impose a smaller one). Parsing is defensively bounds-checked — truncated header, no
magic cookie, missing message-type, or an option whose length runs past the buffer all yield `None`,
never a panic. No tokio/async → compiles into the browser build too. Tests (11): correct OFFER (echoes
xid/chaddr, all options), ACK for our address, RENEW-via-ciaddr ACK, wrong-address NAK (no yiaddr, no
lease), server-id selection (other→ignored, us→ACK), short-lease + custom-MTU reflected, non-request
types silent, and a fuzz sweep (every truncation + every single-byte corruption of a valid DISCOVER,
plus hand-built malformed messages) asserting no panic. 55 slirp tests. fmt + clippy green under BOTH
`--all-features` and `--no-default-features`. Remaining for T15: wire DHCP into the slirp UDP path, the
DNS forwarder (`Resolver` trait + DoH/OS impls + TTL cache + AAAA policy), and booted-guest acceptance
(env-gated).

**Adversarial cold-clone critic on pass 1a: NO defect found (first clean slice in the series).** After a
deep pass the critic could not produce a panic, overrun, malformed reply, or a state-machine bug that
would wedge/mislead a real `udhcpc`. Verified SOUND (with evidence): (1) parser bounds-safe — **5,000,000
fuzz inputs** (3M random, 1M valid-header+random-options, 1M mutated/truncated/bitflipped) through
`handle` with backtraces on: ZERO panics; `BOOTP_LEN=236` confirmed correct; every header index guarded by
the `len < 240` gate, options walk fully fallible. (2) Reply wire format RFC-2131 correct on every produced
reply — op=2/htype=1/hlen=6, magic at 236, yiaddr(16..20)=GUEST for OFFER/ACK & 0 for NAK, flags a
byte-exact echo, chaddr 6 bytes + zero pad, per-option lengths all correct. (3) State machine correct
across **all 400 REQUEST combinations** (msg-type × req-ip × ciaddr × server-id) — every path a real
busybox `udhcpc` traverses yields the right reply. (4) Endianness/encoding correct. (5) Test honesty
confirmed — the critic planted a shifted-yiaddr bug and an unchecked index and both were caught by the
in-tree validator/fuzzer. Minor non-defects noted (not fixed, none reachable from a conformant client):
a REQUEST with neither option 50 nor a non-zero ciaddr NAKs (unreachable from udhcpc); reply not padded to
the 300-byte BOOTP minimum (irrelevant for relay-less slirp); `siaddr`=gateway (legal, ignored).

**2026-07-07 — pass 1b: DNS forwarder wire layer (`dns.rs`).** The pure, synchronous DNS message layer:
`parse_query(&[u8]) -> Option<Query>` (id, lowercased name, qtype, qclass, RD; single-question only —
zero-QD / multi-QD / QR=1 → `None`) and `build_response(query, rcode, answers)` (echoes the question
verbatim; each answer's NAME is a compression pointer to the question at 0x0c; sets QR=1/RA=1, echoes RD).
Convenience: `Answer::a(ip, ttl)`, `empty_aaaa` (the documented AAAA policy — the stack is IPv4-only, so
AAAA gets an HONEST empty NOERROR, never SERVFAIL/NXDOMAIN/bogus-record, to avoid happy-eyeballs stalls),
`servfail`, `nxdomain`. Name parsing is compression-loop-PROOF: a pointer must jump STRICTLY backward
(so each jump decreases the offset → the walk always terminates) plus a 128-jump budget and a 255-byte
name cap; any malformed encoding (loop, forward/self pointer, oversized, truncated) yields `None`, never
a hang or panic. No tokio/async → browser-safe. Tests (9): parse an A query, case-insensitive
lowercasing, A response bytes (id echoed, QR/RA/RD flags, pointer-to-question, TYPE/CLASS/TTL/RDLENGTH/
RDATA), empty-AAAA NOERROR, NXDOMAIN/SERVFAIL rcodes, reject non-queries/bad-QD-counts, compression
pointer safety (backward resolves; self/forward/mutual-loop rejected — direct `parse_name` cases),
oversized-name reject, and a fuzz sweep (every truncation + bitflip of a valid query + 20k structured-
random inputs) asserting no panic. 64 slirp tests. fmt + clippy green under BOTH `--all-features` and
`--no-default-features`. Remaining for T15: the async `Resolver` trait (DoH/OS) + TTL cache, wire DHCP
+ DNS into the slirp UDP path, booted-guest acceptance (env-gated).

**2026-07-07 — pass 1c: DNS forwarder control layer — `Resolver` trait + TTL cache + `DnsForwarder`
(`resolver.rs`).** Ties the wire layer (pass 1b) to a pluggable upstream. `Resolver` trait: async
`resolve(name) -> Resolution` (`Resolved{ips,ttl}` / `NxDomain` / `Failed`) — `impl Future + Send`, NO
tokio (mirrors `OutboundConnector`), so it's browser-safe; the DoH (wasm) and OS (native) impls are a
later slice. `TtlCache`: bounded, TTL-respecting positive cache, DETERMINISTIC (every op takes
`now_ms`) — clamps TTL to [5 s floor, 300 s cap] (a `ttl=0` can't defeat caching; a huge TTL can't pin
a stale answer), returns the REMAINING TTL so answers count down, evicts the soonest-to-expire when
full (reclaiming expired first). `DnsForwarder<R>::handle(msg, now_ms)`: parse → AAAA→empty NOERROR
(never touches upstream) → non-A→SERVFAIL → cache hit→answer (no upstream fetch) → else resolver →
cache positive + build A response / NXDOMAIN / SERVFAIL; malformed→drop. Tests (8, deterministic, mock
resolver counting upstream calls): TTL clamp floor/cap, remaining-countdown + expiry, bounded eviction
(soonest-expiry), A-resolve+cache then **second query is a cache hit (upstream called ONCE — the
acceptance criterion)**, re-resolve after TTL expiry, empty-AAAA without touching the resolver,
NXDOMAIN + SERVFAIL forwarded (failures NOT cached), unsupported-qtype→SERVFAIL, malformed→None. 73
slirp tests. fmt + clippy green under BOTH `--all-features` and `--no-default-features`. Remaining for
T15: the concrete resolvers (browser DoH `fetch`, native OS) + TCP-fallback for truncated answers, wire
DHCP+DNS into the slirp UDP path, booted-guest acceptance (env-gated).

**Adversarial cold-clone critic on pass 1c: SOUND cache/eviction, one MAJOR + one MINOR fixed.** The
critic verified SOUND (with repros): the TTL countdown/boundary math (fresh-resolve TTL and a 0-ms-later
cache hit agree; sub-second rounds to a ≥1 floor, never 0-while-live; no overflow), eviction/bounding
(cap-1 works, same-expiry bursts stay bounded, re-put of an existing key can't grow past max, expired
reclaimed before evicting a live one), no cross-qtype cache poisoning (only A populates/reads the cache),
and test honesty (mutating `get`→None breaks the cache-hit test). It found ONE **MAJOR**: an empty
positive `Resolved{ips: []}` was cached and floor-clamped, pinning "no A records" for ≥5 s and overriding
a `ttl=0` don't-cache hint — starving retries. Fix: answer an honest empty NOERROR but do NOT cache an
empty result (re-resolve next time). And one **MINOR**: qclass was never validated, so a non-IN (e.g.
CHAOS) A query got answered with IN data (class-mismatched reply). Fix: non-IN → SERVFAIL before the A
path. Regressions: `empty_a_result_is_not_cached_and_re_resolves` (cache_len 0, second query re-resolves)
+ `non_in_class_gets_servfail_without_touching_the_resolver`. 10 resolver tests; fmt + clippy green both
feature configs. (Not a bug: CNAME→SERVFAIL is this pass's intended policy per the pass-1b spec.)

**2026-07-07 — pass 1d: UDP service dispatch (`udp.rs`).** The composition seam that ties the DHCP
server + DNS forwarder into one router: `UdpServices<R>::handle(dst_ip, dst_port, payload, now_ms)
-> Option<UdpReply>` claims a guest UDP datagram for the internal service that owns `(dst_ip,
dst_port)` and returns the response payload + the source port to reply from. Routing policy: DHCP —
port 67 to the broadcast (DISCOVER/rebind) OR the gateway (unicast RENEW), since we're the sole server
on the link → `DhcpServer`, reply from :67; DNS — ONLY `10.0.2.3:53` → `DnsForwarder`, reply from :53;
everything else (an external UDP flow, INCLUDING DNS to some OTHER server's :53) is NOT claimed → left
to the NAT/outbound path (no transparent-DNS surprise). Pure control logic (no smoltcp); the caller
parses the datagram off the wire and frames the reply. Tests (6): DHCP DISCOVER (broadcast:67) → OFFER
from :67; DHCP RENEW (gateway:67) → ACK; DNS to 10.0.2.3:53 → QR-set response with an A answer from
:53; DNS to an EXTERNAL host:53 → None (left to NAT); other ports/hosts (gateway:123 NTP, external:67,
external:4433) → None. 80 slirp tests. fmt + clippy green under BOTH `--all-features` and
`--no-default-features`. Remaining for T15: the concrete resolvers (browser DoH / native OS) +
TCP-fallback, wire `UdpServices` into the SlirpStack UDP path (smoltcp UDP socket on the gateway/DNS
addrs), booted-guest acceptance (env-gated).

**Adversarial cold-clone critic on pass 1d: essentially CLEAN, one MINOR API-smell folded in.** The
critic mutation-verified the routing guards are real (dropping the DNS ip-check fails the external-DNS
test; dropping the DHCP ip-check fails the external:67 test), confirmed the DHCP unicast-RENEW routing
is consistent with `dhcp.rs`'s server-id/siaddr = gateway, and found no misroute / external-leak /
panic. One MINOR: the reply's old `src_port` field was redundant (always == the `dst_port` just passed)
and the struct omitted the field a caller needs to ADDRESS a DNS reply (the query's ephemeral source
port). Folded in: `handle` now takes the guest `src_port` and `UdpReply` carries explicit `from_port`
(67/53) + `to_port` (68 for DHCP, the query's source port for DNS) — the reply is now fully addressable
with no out-of-band caller state. Tests assert both ports (DNS reply → 45123, DHCP → 68). 80 slirp
tests; fmt + clippy green both configs.

**Adversarial cold-clone critic on pass 1e: essentially CLEAN, one MINOR caveat documented.** The critic
attacked crafted names, the timeout, empty-ips composition, dedup, and CI-determinism with repros — none
hung/panicked/misresolved. Verified SOUND: crafted names (`example.com.`, `a:b:c`, `[::1]`, `evil:22`,
300-char label, NUL) all → `Failed`/`Resolved{empty}` within the deadline (and the wire path can't even
inject a trailing dot — `parse_name` strips it); the timeout genuinely bounds it (1 ms-timeout resolve →
`Failed` in 2.7 ms on both current- and multi-thread runtimes); empty-ips composes correctly with the
forwarder's un-cached-empty-NOERROR branch (ttl:60 harmlessly dropped); no duplicate A records
(getaddrinfo with SOCK_STREAM); CI-determinism is fine (ubuntu-latest, not a minimal container — glibc/musl
have the RFC-6761 `localhost→127.0.0.1` built-in fallback plus `/etc/hosts`); mutation-checked
(`resolve→Failed` fails the localhost test). One **MINOR** (inherent to `lookup_host`, not a coding error,
not a live bug here — no concurrent dispatch is wired yet): `tokio::time::timeout` returns `Failed` on
schedule but only DROPS the future — the blocking getaddrinfo thread stays pinned until the OS resolver
returns, so a future concurrent-dispatch path against a black-holed resolver could pin tokio blocking
threads. Folded in as an in-code CAVEAT so the wiring slice bounds resolve concurrency (or uses a raw async
resolver). Two NITs (harmless, noted): v4-mapped-IPv6 filtered as empty; the `::1` test's Failed escape
hatch is loose (but the v4-only assertion in the localhost test covers the filter deterministically). No
correctness change. 84 slirp tests; fmt + clippy + no-default build green.

**2026-07-08 — pass 1f: DNS response parser (`dns::parse_response`).** The pure, browser-safe core the
DoH resolver will use: `parse_response(&[u8]) -> Option<ResponseInfo{ rcode, a_records: Vec<(Ipv4Addr,
u32)> }>` distills a DNS RESPONSE (from a DoH endpoint / upstream) into its RCODE + every IPv4 A record
`(address, ttl)`. Rejects a query (QR=0). Skips the question section (qdcount names + 4 bytes each) and
walks the answer RRs (NAME + type/class/ttl/rdlen/rdata), collecting only A/IN/rdlen=4 records — a CNAME
chain is skipped and the trailing A still collected; AAAA/other RRs ignored. Reuses `parse_name` for
name-skipping, so it's compression-loop-proof (backward-only jumps); every field access is bounds-checked
(`get`/`checked_add`), so a short header, an ancount that lies, an RDLENGTH that overruns, a compression
loop, or any truncation/bitflip yields `None` — never a panic (the caller treats `None` as SERVFAIL). No
tokio/async → compiles into the browser build. Tests (6): multi-A + RCODE extraction, CNAME-then-A
(CNAME skipped, A kept), AAAA ignored, NXDOMAIN/SERVFAIL rcodes surfaced, a query rejected as a response,
and a malformed sweep (short header, lying ancount, overrun RDLENGTH, + every truncation & single-byte
corruption of a valid response) asserting no panic. 90 slirp tests. fmt + clippy green under BOTH
`--all-features` and `--no-default-features`. Remaining for T15: the DoH resolver wiring this parser to a
`fetch` transport (browser) — the transport is injectable so its response-mapping is testable natively;
TCP-fallback; wire `UdpServices` into the SlirpStack UDP path; booted-guest acceptance (env-gated).

**Adversarial cold-clone critic on pass 1f: CLEAN, no defect (400k-iteration fuzz).** The critic read
`parse_response` + the full `parse_name` and ran a 400,000-iteration fuzz plus every crafted case: NO
panic; name-ends-exactly-at-EOF with truncated fields → `None` (every one of the 10 RR-header bytes uses
`*msg.get(after+k)?`, no raw index); a forward pointer in an answer name → `None`; NO zero-advance spin
(`pos` strictly grows ≥ 11 bytes/RR, so the ancount loop always terminates); compressed-RDATA (a CNAME
whose rdata is a 2-byte pointer) is skipped by raw rdlen with the trailing A found at the exact next
offset (no off-by-one); `ancount=65535` in a 12-byte buffer → `None` in < 100 ms (no spin/alloc); rcode
= low nibble + QR-check correct; `checked_add` guards the one overflow-capable add. Two MINOR notes (no
code defect): no answer-name validation (acceptable — the DoH/OS resolver trusts its endpoint and knows
what it asked; TXID/transport is a separate layer) and bounded-but-uncapped `a_records` (≤ 65535, not a
DoS). Folded a doc acknowledgement of both onto `parse_response` so the future untrusted-transport path
cross-checks the answer name. No correctness change. 90 slirp tests; fmt + clippy + no-default green.

**2026-07-08 — pass 1g: DoH resolver (`doh.rs`) + `dns::build_query`.** The browser's `Resolver`,
transport-injected so it's pure/browser-safe and natively testable. `DohResolver<T: DohTransport>`
resolves a name by building a DNS query (`dns::build_query(0, name, A)` — id=0 per RFC 8484, round-trips
`parse_query`), POSTing it via the transport (browser: `fetch` to a DoH endpoint w/
`application/dns-message`; the concrete `web_sys` transport lands in the wasm crate later), and mapping
`parse_response` → `Resolution`: NXDOMAIN→NxDomain; NOERROR→Resolved{A-record ips, ttl = the SMALLEST
record TTL floored at 1}; transport failure / malformed response / SERVFAIL/other rcode → Failed
(fail-fast, never trusts garbage). `DohTransport` is `-> impl Future + Send` (no tokio), mirroring
`OutboundConnector`. Tests (6, mock transport, no network): posts a well-formed A/IN id=0 query +
maps two A records with the min TTL (120); NXDOMAIN→NxDomain; SERVFAIL→Failed; transport-failure→Failed;
malformed-bytes→Failed; NOERROR-with-only-AAAA→empty Resolved. Plus `dns::build_query` round-trips
through `parse_query`. 97 slirp tests. fmt + clippy + no-default-features BUILD green (the resolver is
pure/generic → compiles into the browser build). Remaining for T15: the concrete `fetch` DohTransport
(wasm crate), TCP-fallback for truncated answers, wire `UdpServices` into the SlirpStack UDP path,
booted-guest acceptance (env-gated). Both resolver impls (native OS + DoH) now exist behind the one
`Resolver` trait the forwarder consumes.

**Adversarial cold-clone critic on pass 1g: CLEAN, no defect (one unreachable NIT).** The critic
verified SOUND (with mutations/repros): the empty-ips TTL composition end-to-end — `DohResolver` returns
`Resolved{ips:[], ttl:1}` for a NOERROR/AAAA-only response, but `DnsForwarder` matches the empty-ips arm
and emits an un-cached empty NOERROR (dropping the ttl), so nothing caches an empty answer and the `ttl:1`
is dead/harmless; the min-TTL mapping (mutation `min→max` FAILS the ttl==120 assertion — non-vacuous);
full rcode coverage (NXDOMAIN→NxDomain, NOERROR→Resolved, transport-None/parse-None/SERVFAIL/REFUSED/
other→Failed); the `Send` bound is real+minimal (`T: DohTransport + Sync` makes `&self` Send across the
await); the `--no-default-features` build compiles (pure/generic → browser-safe). One NIT (unreachable,
not fixed): `build_query`'s `label.len() as u8` would corrupt a >63-byte label, but 64+ byte labels are
ILLEGAL DNS and `parse_name` bounds the guest's name to ≤63/label, and the only caller passes that parsed
name — so no legal/guest-reachable path hits it (the doc already states this). No code change. 97 slirp
tests; fmt + clippy + no-default build green.

**2026-07-08 — pass 1h: services integration test (`udp_integration_tests.rs`).** The per-module tests
exercise each control-plane piece in isolation; this proves they COMPOSE through `UdpServices` as one
guest session. (1) `full_guest_session_lease_then_resolve_with_cache_reuse` — DISCOVER→OFFER (yiaddr =
guest, reply to :68), REQUEST→ACK, then TWO DNS queries through the SAME dispatcher: the first resolves
via a counting upstream (answer back to the query's ephemeral port), the second (same name, 4 s later)
is served from the forwarder's TTL cache — **upstream consulted exactly ONCE across the whole session**
(the cache persists across dispatch calls, the task's DNS-cache acceptance criterion, proven at the
composed level). (2) `real_native_resolver_composes_through_the_dispatcher` — the SAME session but with
the REAL `NativeResolver`: `localhost` resolves to 127.0.0.1 end-to-end through UdpServices → DnsForwarder
→ NativeResolver (offline, `/etc/hosts`, no network) — proving the production resolver composes, not just
a mock. test+native-gated. 99 slirp tests. fmt + clippy + no-default build green. This closes out the
natively-verifiable control layer; the boot/browser-gated legs remain: concrete `fetch` DohTransport
(wasm crate), TCP-fallback, wiring `UdpServices` into the SlirpStack UDP path, booted-guest acceptance.

**2026-07-08 — pass 1i: UDP datagram framing (`udp_frame.rs`).** The pure, browser-safe glue between
the frame-level stack and the payload-level `UdpServices` — the architecture-independent building block
the UDP stack-wiring needs regardless of how DHCP/DNS are ultimately hooked in. `parse_udp(frame) ->
Option<GuestUdp{ src_mac, src_ip, src_port, dst_ip, dst_port, payload }>` pulls the fields dispatch needs
plus what's needed to ADDRESS a reply out of a guest ethernet frame (`None` on non-IPv4 / non-UDP /
malformed — never panics, leaving the frame to the TCP/ICMP/NAT paths). `build_udp_frame(src_mac,
dst_mac, from_ip, from_port, to_ip, to_port, payload)` frames an Ethernet+IPv4+UDP reply with correct
checksums (via smoltcp wire types) — handles both a DHCP broadcast reply (to the ff:ff MAC / 255.255…
IP) and a DNS unicast (to the guest MAC/IP/port). No tokio → browser build. Tests (5): build↔parse
round-trip (all fields), a guest DHCP DISCOVER (0.0.0.0:68 → 255.255.255.255:67) parses, empty-payload
round-trip, non-UDP/non-IPv4 rejection (ARP + a TCP-protocol IPv4 packet → None), and a malformed sweep
(short/no-room + every truncation & single-byte corruption of a valid frame) asserting no panic. 104
slirp tests. fmt + clippy green under BOTH `--all-features` and `--no-default-features`. (Local gate
caught 6 useless-conversion clippy warnings — smoltcp's `Ipv4Address` IS `std::net::Ipv4Addr` in this
version — fixed before push.) Remaining for T15: wire `parse_udp`→`UdpServices`→`build_udp_frame` into
the SlirpStack (accept UDP to our service endpoints, dispatch, egress the reply; the DNS async path needs
the same sync/async bridge as the pump), TCP-fallback, booted-guest acceptance (env-gated).

**Adversarial cold-clone critic on pass 1i: SOUND parse, one latent MINOR (overflow panic) fixed + a
test gap closed.** The critic read smoltcp-0.13 source and ran hand-corrupted frames — `parse_udp` is
CLEAN against every lying-length case: IP total_length > buffer → None (check_len rejects); UDP length >
IP payload → None; UDP length < 8 → None; UDP length == 8 → correct empty payload; trailing bytes after
the datagram are EXCLUDED by both `Ipv4Packet::payload()` (bounded by total_length) and
`UdpPacket::payload()` (bounded by the UDP length) — junk does NOT leak; IPv4 options (IHL=6) → ports
parse at the right offset (no misparse); all boundary/truncation/bitflip cases → no panic; the TCP-flip
test is honest (the None genuinely comes from the next_header check). It found one real latent MINOR:
`build_udp_frame` PANICKED for payloads ≥ 65508 bytes — the IPv4 total_length is a u16, so `20 + 8 +
len` overflowed, then `copy_from_slice` length-mismatched. No caller trips it yet, but a service
reframing a large answer would crash. Fix: `build_udp_frame` now returns `Option`, rejecting a payload >
`MAX_UDP_PAYLOAD` (65507) — the largest legal UDP-over-IPv4 payload. Also closed the critic's test-gap
(the round-trip was checksum-blind since `new_checked` validates lengths only): a new test asserts the
built frame's IP + UDP checksums `verify_checksum()` for empty/1/27-byte payloads (a real guest accepts
them), and a regression frames exactly `MAX_UDP_PAYLOAD` while rejecting +1. 106 slirp tests; fmt +
clippy + no-default build green.

**2026-07-08 — pass 1j: stack-level UDP service diversion (`stack.rs`).** The first actual integration of
the internal services into the real `SlirpStack` — architecture-neutral (the caller dispatches, sync for
DHCP now, async for DNS later, so it doesn't prejudge the sync/async bridge). `inject` now checks
`parse_udp` + `is_service_udp(dst_ip, dst_port)` (DHCP :67 to broadcast/gateway; DNS :53 to `net::DNS` —
matching the `UdpServices` routing exactly) and DIVERTS a service-bound datagram into a `service_udp`
queue instead of the smoltcp path (which drops UDP anyway) — strictly additive, no TCP/ICMP/ARP behavior
changes. `take_service_udp() -> Vec<GuestUdp>` drains the queue for the caller; `push_egress(frame)`
injects a caller-framed reply so it appears in `take_egress` alongside smoltcp's output. Tests (3,
frame-injection, no boot): a DHCP DISCOVER broadcast frame is DIVERTED (not dropped, and smoltcp never
sees it — no auto-reply on poll); DNS to 10.0.2.3:53 is diverted while DNS to an EXTERNAL 8.8.8.8:53 is
NOT (left to NAT, and the stack doesn't answer it); and the **full DHCP path through the real stack** —
inject a DISCOVER frame → `take_service_udp` → the real `DhcpServer` → `build_udp_frame` the OFFER →
`push_egress` → `take_egress` yields exactly one frame that parses as UDP :67→:68 carrying a DHCP OFFER
with yiaddr = the guest address. 109 slirp tests. fmt + clippy green under BOTH `--all-features` and
`--no-default-features`. Remaining for T15: the sync/async servicing loop that drives `UdpServices` from
this diversion (DHCP sync + DNS async, like the pump's bridge), TCP-fallback, booted-guest acceptance.

**Adversarial cold-clone critic on pass 1j: production code SOUND, one test-honesty MINOR fixed.** The
critic verified (with mutations) the divert is genuinely additive + safe: `is_service_udp` matches
`UdpServices` routing EXACTLY (no cross-match; gateway:53/dns:67 fall through), NO reflection/spoof
vector (in slirp the only sender reaching `inject` is the guest), the `any_ip` bypass isn't exploitable
(diverted frames would otherwise be dropped/noise), no legit frame wrongly diverted (ARP/ICMP/TCP →
`parse_udp` None → fall through unchanged; mutation `is_service_udp→false` fails all 3 divert tests), and
the external-DNS assertion is load-bearing (divert-on-port-only is caught). One MINOR (test honesty): the
tests didn't cover the ONE case where `inject`'s divert-`return` is observable — a unicast DHCP RENEW to
`gateway:67`, where without the return smoltcp (owning 10.0.2.2, no UDP:67 socket) emits a spurious ICMP
port-unreachable; that mutation survived the suite. Fixed: `unicast_renew_to_gateway_is_diverted_not_
double_handled` asserts the RENEW is diverted AND smoltcp never sees it — mutation-verified (FAILS with
the `return` removed, PASSES with it). Two lower notes (not fixed, consistent with existing design):
`service_udp` is unbounded (so are `device.rx`/`tx` — not a new DoS surface), and diverted frames bypass
smoltcp's checksum validation (harmless — the guest's own frame, `dhcp.rs` parses defensively, UDP
checksums are optional and DHCP often sends 0). 110 slirp tests; fmt + clippy + no-default green.

**2026-07-08 — pass 1k: synchronous DHCP servicing (`SlirpStack::run_dhcp`).** The DHCP path is now
closed in PRODUCTION code (not just a test): `run_dhcp(&DhcpServer) -> usize` drains every diverted DHCP
datagram (dst :67), dispatches it to the real `DhcpServer`, frames each reply, egresses it, and returns
the count. DHCP is fully SYNCHRONOUS (no resolver), so it's serviced end-to-end here; DNS datagrams
(dst :53) are LEFT in the service queue for the async layer (the loop partitions: keep dst_port != 67).
Reply addressing (RFC 2131): the client is acquiring its lease and has no IP yet, so the reply is sent
with a BROADCAST L3 destination (255.255.255.255:68) from the gateway server (10.0.2.2:67), unicast at
L2 back to the requesting guest's MAC (it accepts a broadcast-IP frame to its own MAC without flooding).
Tests (3, frame-injection, no boot): a full DISCOVER→OFFER→REQUEST→ACK handshake through `run_dhcp` (the
OFFER frame is UDP :67→:68, L3 broadcast, from the gateway MAC, yiaddr = guest; the REQUEST for our
address → ACK); a wrong-address REQUEST → NAK; and a mixed queue where the DHCP frame is serviced while
the DNS datagram stays queued untouched for the async loop. 113 slirp tests. fmt + clippy green under
BOTH `--all-features` and `--no-default-features`. Remaining for T15: the ASYNC DNS servicing loop
(drive `DnsForwarder`/`UdpServices` from the diverted :53 datagrams + `push_egress` the framed answer,
like the pump's bridge), the concrete `fetch` DohTransport, TCP-fallback, booted-guest acceptance.
