# E5-T18e final desktop bring-up evidence

The root `desktop-bringup.json` is the corrected v2 recording: 25 cache-disabled
boots and a warm prime/reload, all with real cursor and Terminal checks. It was
recorded at `5506f2a514a6a7b90d83eafe8cf39e6d3ff4fd1b`; its SHA-256 is
`e056f3ef0f3e0a4c682eb6e40138f8f2c4e30cceb56bcd19fc0a6d6ad9aacd31`.
Every cold worker response used the network, and the warm reload demonstrably
reused bytes. Legacy page-only `cacheHits` fields are not the cache authority.

Each case includes its JSON, raw serial log, desktop PNG and Terminal PNG. The
JSON records screenshot/framebuffer hashes, guest-state digests, scheduler state,
and the complete worker cache observations. Publication/source/runtime bindings
and the full acceptance/console logs accompany the cases. Recordings were copied
byte-for-byte from the frozen proof clone; no screenshots were edited.

`initial/` preserves the original clean rebuild and first functional run at
`9ed9e0d1c57daf64f6362193bc30b79482dd3258`. That rebuild produced exactly the
locked image; its original browser observer did not prove worker-cache disabling.
The corrected browser run therefore reused the hash-checked unchanged build,
without accepting the initial run as the final cold-cache proof.

`guard-unit-tests.log` records 30 passing regressions at proof-only guard head
`0d966c1fb8ef31e05c2bca52e1a191d9de235af3`. `verifier/` preserves independent
predictions, attacks, historical findings, incremental guard repairs, and the
final verdict when issued. The task log distinguishes those heads explicitly.

This proves the selected Alpine/Weston/pixman desktop. It does not claim Omarchy
or Epic 5 completion, and it does not authorize an early merge or deployment.
