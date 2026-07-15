# E3-T14 final worker evidence (2026-07-14)

Both acceptance runs used the committed kernel and a fresh copy of
`releases/rootfs/alpine-rootfs.ext4` (SHA-256
`8e57a0bce7d275c1ab6cc8c9ebb7a0ddbf342681949876b6099937cc21bb2475`).
The host fixtures were:

```text
python3 -m http.server 8080 --bind 127.0.0.1 --directory web
python3 -c 'UDP echo socket bound to 127.0.0.1:9090'
WASM_VM_SLIRP_HOST_MAP=192.0.2.1=127.0.0.1 target/release/wvrelay 127.0.0.1:8081
```

The HTTP fixture was `web/file`, 112 bytes, SHA-256
`a8aa13fc1f45fd3401d649871ad303e662d7c202254fb8ea7e558fde11f766a2`.

## Native recording

Command (wrapped by `/usr/bin/script` to produce `native-alpine.typescript`):

```text
WASM_VM_SLIRP_HOST_MAP=192.0.2.1=127.0.0.1 target/release/wasm-vm boot \
  --kernel releases/kernel/6.6.63/Image \
  --drive file=/tmp/wasm-vm-e3-t14-rework-final.ext4 \
  --net-slirp \
  --evidence evidence/e3-t14-rework/native-alpine.evidence \
  --append 'root=/dev/vda rw console=ttyS0 earlycon=sbi' \
  --max-instrs 60000000000
```

The transcript proves DHCP (`10.0.2.15`), the default route, a 3/3 gateway
ping, the 112-byte TCP `wget` with the expected digest, two distinct UDP
datagrams returned byte-exact, a closed TCP port refused in 0 seconds, and a
clean guest exit. The compact recorder sealed:

```text
trace fnv64=2fa1668cba2a743a
trace retired=4421704713
state sha256=94eadf4da3fd59bbc17cd3051754654bd2a163b8b1ce0b52d90dad0a4ce605d4
outcome=Exited(0)
```

## Browser recording

The Playwright page was loaded after clearing all origin storage and disabling
the browser cache:

```text
http://127.0.0.1:8123/?slirpRelay=ws://127.0.0.1:8081&final=4
```

`e3-t14-rework-browser-terminal.txt` is the decoded xterm buffer. It proves the
same DHCP, route, ping, TCP body, and two UDP datagrams through the production
WebSocket relay. `nc -z` sees the deliberately optimistic local SYN handshake;
the data-phase closed-port probe then records `Connection reset by peer`,
`rc=1`, and `elapsed=0s` when the relay's `OPEN_FAIL` reaches the guest. The
machine powered off with:

```text
state sha256=5e4eac5b69d67a23009f94330e6c51c40c85463f85ed798e972cf0966cc5c8a2
machine halted (exited:0)
```

On the same cold page, the browser suite completed `126 passed, 0 failed` in
12.5 seconds. The E3-T14 roadmap item had a `verified` pip. Both the post-boot
and post-suite console-error captures report zero errors.

## Artifact SHA-256

```text
471a531eeb3c5d469241fd98763ec127136b35a3b592120b9b2b132f369f50ee  e3-t14-rework-browser-console-errors.txt
471a531eeb3c5d469241fd98763ec127136b35a3b592120b9b2b132f369f50ee  e3-t14-rework-browser-final-console-errors.txt
9728de0c1971d876fb360878734becc7a956fbffbbf4f15ae3087802e7bead02  e3-t14-rework-browser-roadmap.png
de80e56eef6e3ce2618d043f79951b371fff5a8cc2566eb372b17d4dc8c89412  e3-t14-rework-browser-suite.png
42bfaeafbcbe4ceeaa0a2b0ef4c0202abbe20d73cd2b73fc38152ea96bb2e57e  e3-t14-rework-browser-terminal.png
215d7473cac43f2661c7e94fcf2a83ccc21ea9429bbc710364361b2193e19cc3  e3-t14-rework-browser-terminal.txt
6a5a6d09b28f264d12a65c1301dc4dd740a1966c99ca7deeacbf479683023c6f  native-alpine.evidence
4aef523350184bafa7a8d9f0a2a17129958f4bebf05e83bd252714e7ecff61b2  native-alpine.typescript
```
