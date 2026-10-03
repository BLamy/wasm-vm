# Cold desktop request observation — proof gap, no runtime refutation

At the first repaired-head cold run (`fbceeb4d`), the actual desktop boot and canvas
completed, but the prescribed gate exited 2. This original failure must remain
visible, not be relabeled a pass.

- `cold-clone/report.json` SHA-256 `d5fc461b9ad597b5bc7745b3beacf7ddc31a67324a363d16e16323be7758e794` records exact head, empty before/after status, unchanged explicit fixture inputs and failed acceptance.
- `cold-clone/acceptance/desktop/report.json` SHA-256 `6ae3ab605ff580880fdf1dc97d92dfd3e918bd2965d7ca3da07f3991d410d847` contains a single failed kernel request; console/page/http/server/presentation errors are absent and actual guest frames exist.
- `desktop/browser.jsonl:26–28`: the kernel was served at 07:19:58.873Z, reported `net::ERR_ABORTED` at .882Z, and the manifest was served at .882Z. The served kernel is 24,208,896 bytes with SHA-256 `af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce`.
- Frozen `web/dist/loader.js:72–96` reads the stream until `done`; :389 awaits the kernel before the manifest, and :456–459 rejects a kernel digest mismatch before boot. This route has no deliberate size probe or `reader.cancel`. Successful boot is evidence of application consumption, but the initial network recording lacks request identity/terminal byte detail needed to attribute the failed notification.

The independent review read [Playwright issue 42742](https://github.com/microsoft/playwright/issues/42742), an upstream issue report describing streamed `no-store` bodies reaching EOF while requestfailed reports ERR_ABORTED; its `no-cache` control finishes normally. This is corroborating context, not proof that the local event has the same cause. Its reporter explicitly leaves the upstream implementation cause unresolved.

Demand: retain the original failure and record a bounded same-browser/same-kernel
fetch comparison with application byte count/SHA, unique request identity,
response metadata and terminal event. If attributed, a narrowly scoped harness
header/metadata repair may be tested without changing the runtime; keep strict
request-failure rejection. The final exact-head clean gate must then pass. Do not
filter arbitrary aborted kernel requests or infer a passing gate from the boot
alone. Runtime and completed independent results remain HELD across an unchanged
runtime/dependency boundary.

## Attribution now HELD; final cold rerun still required

`audit-network.py` independently binds the exact loader function, same kernel,
request IDs/response cache headers/server finished events, application byte count
and SHA. `network-audit.json` records 12/12 exact consumers, 4 no-store terminal
failures (2 in workers), and zero no-cache failures. This supports a local
streaming/no-store browser notification mismatch; it does not attribute the
underlying Chromium implementation. The harness-only repair at
`85962c4956bad75c7703767650b49763fb0e5945` changes only the immutable kernel to
`no-cache` and records request/response/terminal identity and timing. Fresh context,
CDP cache disabling, source hashes and strict rejection of every request failure
remain. The rerun is an environment/browser-harness isolation correction, not a
rerun of a refuted renderer, and is stored separately in `cold-clone-final`.

## Final exact-head proof — HELD

The separate final clone at `85962c4956bad75c7703767650b49763fb0e5945`
passes the entire acceptance command. `cold-clone-final/report.json` has SHA-256
`d99c7d98cd1dee7e34b70c38b7ff480c8718806f5787c98ec96b76bb32f0da3e`;
its receipt is `84c6d8af8e691fc82f0d0778ab6e9a3e73b98750ef74c1d004c8075747552352`.
The actual desktop reaches readiness after 215,521ms with 28 drawn frames.
Its report SHA-256 is
`04c04d4ac2335cbac2592542e493ab6526ecdfccdf8cfa15966a12a769b2cada`.
All browser console/page/HTTP/request-failure/server error arrays are empty. The
one kernel request records the intended no-cache header and a matched normal
requestfinished event. Git status is empty before and after; external fixture
inputs are unchanged. `audit.json` rehashes these files, source provenance and
served chunks independently. The actual final desktop screenshot was viewed.

S21 is now HELD. This closes the specific browser/harness isolation proof gap;
it does not relabel the first cold run or erase the initial receipt failure.
