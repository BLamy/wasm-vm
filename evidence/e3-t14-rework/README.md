# E3-T14 final worker evidence (2026-07-15)

Both authoritative acceptance runs used the committed kernel and a fresh copy of
`releases/rootfs/alpine-rootfs.ext4` (SHA-256
`8e57a0bce7d275c1ab6cc8c9ebb7a0ddbf342681949876b6099937cc21bb2475`).
The host fixtures ran outside the filesystem sandbox so the emulator and relay
could reach their real loopback sockets:

```text
python3 -m http.server 8083 --bind 127.0.0.1 --directory web
python3 -c 'UDP echo socket bound to 127.0.0.1:9090'
WVRELAY_HOST_MAP=192.0.2.1=127.0.0.1 target/release/wvrelay 127.0.0.1:8082
```

`wvrelay` deliberately uses `WVRELAY_HOST_MAP`; the native CLI uses the distinct
`WASM_VM_SLIRP_HOST_MAP` variable below. The HTTP fixture was `web/file`, 112
bytes, SHA-256
`a8aa13fc1f45fd3401d649871ad303e662d7c202254fb8ea7e558fde11f766a2`.

Before the browser boot, a production-protocol smoke connected to
`ws://127.0.0.1:8082`, exchanged HELLO, opened `192.0.2.1:8083`, received
OPEN_OK and WINDOW, sent an HTTP request, and received the expected fixture
body. This caught and excluded a stale launch using the native CLI's env name.

## Native recording

Command (wrapped by `/usr/bin/script` to produce
`native-alpine-v3.typescript`):

```text
WASM_VM_SLIRP_HOST_MAP=192.0.2.1=127.0.0.1 target/release/wasm-vm boot \
  --kernel releases/kernel/6.6.63/Image \
  --drive file=/tmp/wasm-vm-e3-t14-final-v3.ext4 \
  --net-slirp \
  --evidence evidence/e3-t14-rework/native-alpine-v3.evidence \
  --append 'root=/dev/vda rw console=ttyS0 earlycon=sbi' \
  --max-instrs 60000000000
```

The transcript proves DHCP (`10.0.2.15`), the default route, a 3/3 gateway
ping, the 112-byte TCP `wget` with the expected digest, and two distinct UDP
datagrams returned byte-exact. `nc -z` observes the intentionally optimistic
local SYN handshake; the data-phase closed-port probe then returns `rc=1`, zero
bytes, and `elapsed=0s`. A normal Alpine poweroff completed and the compact
recorder sealed:

```text
trace fnv64=630ba49220f08bcb
trace retired=4654237747
state sha256=a9105ded112afbcf1b3e77edf03dff56523dee7e2978baaedb0b58fb8fa2f318
outcome=Exited(0)
```

## Browser recording

Playwright launched a fresh Chrome context, which is a cold origin with empty
storage and cache, then loaded the built page exactly once:

```text
http://127.0.0.1:8123/?slirpRelay=ws://127.0.0.1:8082&final=5
```

`e3-t14-rework-browser-v3-terminal.txt` is the decoded full xterm buffer. It
proves the same DHCP, route, 3/3 ping, TCP byte count/digest, and two byte-exact
UDP datagrams through the production WebSocket relay. The closed-port
data-phase `wget` records `Connection reset by peer`, `rc=1`, and `elapsed=0s`.
After the pass marker the guest used `poweroff -f` (the native run above carries
the full OpenRC shutdown proof) and the browser machine sealed:

```text
state sha256=91a58999dfcccd4312f12e109535f1a1b3fd132b7b277f9a4dd9f3272e13d7ad
machine halted (exited:0)
```

On that same cold page, the browser suite completed `126 passed, 0 failed` in
14.3 seconds. The E3-T14 roadmap item had a `verified` pip, and 12
suite-bound capabilities were promoted to `live`. Both post-boot and
post-suite console-error captures report zero errors. The terminal, suite, and
roadmap screenshots visibly carry those assertions.

## Expiry, isolation, and stress evidence

The recorded browser/native acceptance is supplemented by deterministic tests
that execute every rework path:

- Exact TCP idle expiry at `TCP_IDLE_MS` aborts and polls the smoltcp socket,
  refreshes the guest ARP neighbor, delivers RST (not FIN/silence), and drops
  both async and synchronous connectors with zero live flows.
- TCP and UDP use disjoint low/high u32 stream partitions, one combined
  `MAX_STREAMS` cap, wrap safely, and a real production relay rejects a TCP
  collision without damaging the live UDP flow.
- A real WebSocket stream survives an exact 60-second stalled relay with a
  bounded 256 KiB queue, keeps the same stream id, and resumes 512 KiB
  byte-exact in under 30 seconds.
- The synchronous connector transfers 100 MiB in each direction while
  delivering at most one byte per connector read, keeps staging bounded to
  128 KiB, preserves identity and half-close, and completes under the 180
  second contention-safe ceiling (121.40 seconds in the authoritative suite).

## Artifact SHA-256

```text
752d2f8341fa98448caca42f5cb1c98590504c8ba2213b3f55aaa73969fd9bde  e3-t14-rework-browser-v3-console-errors.txt
752d2f8341fa98448caca42f5cb1c98590504c8ba2213b3f55aaa73969fd9bde  e3-t14-rework-browser-v3-final-console-errors.txt
1df0d7ae4b65ac60c9d780ced4fef117d49c75a62b02cca79770534425108991  e3-t14-rework-browser-v3-roadmap.png
adf24505683fc5d76e5d80d176ed8298d1bf571dd4c48113dc59f17f5361ecce  e3-t14-rework-browser-v3-suite.png
a25e79d531ee3439ebeea379ab148be389ca9416d5a8c76476c034571a892740  e3-t14-rework-browser-v3-summary.json
d2996e2c541558d638af6b5572f87e7e9091aa4306ac82d82c8f49f7b9c3de22  e3-t14-rework-browser-v3-terminal.png
1f957db56fe04e0a6515de01bceb5784392175d301269d0c60515bc49804ab76  e3-t14-rework-browser-v3-terminal.txt
afefb738797f36c19e50e52dbb731c2b5f471891b3bb7ed9496c2bf2ed75d329  native-alpine-v3.evidence
518b311e3cba0da2139c9a1d740e87d31919079b4467e068c0fafaa982669d61  native-alpine-v3.typescript
```
