# E5-T43f verifier predictions (written before running anything or opening the worker's result files)

Verifier session 2026-11-28, head d2cdbd5c8 (claim head 6a50ebd0f). Only the task file, AGENTS.md,
the diff 32f121302..HEAD and the acceptance script source were read before writing this.

P1 online/Chrome: on the committed bundle (8125) with networking on, the page's `/token` GET is
   answered 200 from the network, one WebSocket to wss://wasm-vm-relay.brett-lamy.workers.dev/ws
   opens, and a DOM-typed https://example.com in the guest's Chrome makes sway's window title
   `Example Domain - Chromium` within 5 minutes of typing.
P2 online/node: the DOM-typed node fetch prints `E5T43F_<nonce> 200` (within the script's 10 min).
P3 online/no errors: zero console errors except the favicon 404.
P4 ?net=0: zero requests to wasm-vm-relay.brett-lamy.workers.dev (any path), zero WebSockets, no
   banner, dataset replayNetwork="disabled"; and the guest still has its snapshot lease address on
   eth0 but no traffic leaves (no slirp backend). Also: no DoH request to cloudflare-dns.com.
P5 relay-down (/token aborted): state "off", banner "Network off: ...", no WebSocket, desktop smoke
   page title "Replay RISC-V PASS".
P6 relay answers 200 with garbage (novel variant, routed body `{"token":"","ws":"ws://evil"}` and
   `not json`): state "off", banner shown, no WebSocket opened to any host.
P7 relay answers 503: state "off", banner contains "503", no WebSocket.
P8 sw: with the service worker allowed, two loads each issue exactly one /token, each answered from
   the network (fromServiceWorker false), and the two token strings differ. web/sw.js does not
   intercept cross-origin requests (source check).
P9 token from another origin: the relay's /token is origin-bound (E5-T43a); a token minted for an
   Origin other than the page's is refused by the relay's /ws upgrade from this page's origin
   (bounded check: curl /token with Origin: https://evil.example -> refused or token bound to that
   origin; then a WS upgrade carrying it with Origin http://127.0.0.1:8125 is refused). If the relay
   does not bind tokens to origin, that is E5-T43a's boundary, not this task's diff.
P10 NOVEL — persistence: after an online load, neither localStorage, sessionStorage, IndexedDB names,
   Cache Storage keys nor the IDE's network UI inputs (#network-relay-token etc.) contain the token
   string; the token appears only in memory and in the WS URL/handshake.
P11 other guests unchanged: the diff's only change outside bootReplayDesktop is
   `opts.slirpRelayToken ?? networkRelayTokenEl?.value`; no other guest's boot options set
   slirpRelayToken, so for alpine/node-alpine/omarchy the fallback path is byte-identical in behavior.
   (source check: grep every caller of runLinuxBoot for slirpRelayToken).
P12 Warm resume: tools/verify/e5-t34e-replay-desktop-warm.mjs warm PASSes on 8125.
P13 Latency: click, key echo, node -e on (net on) within the generation-3 offline numbers' noise
   (net-on medians no more than ~5% slower than ?net=0 on the same bundle, interleaved); idle in run
   slices within 2 points.
P14 Coverage: every changed hunk of web/main.js executes in online/off/relay-down runs except the
   TimeoutError branch (needs-evidence or waived as defensive) and the malformed-body branch (covered
   by P6 if I run it).
P15 Mock hunt: the script's assertions discriminate — the Chrome assertion reads sway's tree (a real
   guest title, not a page string), the node nonce is random, the relay-down route aborts only /token.
   Weak point predicted: sw mode never asserts the "different tokens" its header promises.
P16 web/dist at this head serves the same main.js as web/ (hash match), and the manifest's snapshot
   and image files exist under releases/ with the declared sha256.
