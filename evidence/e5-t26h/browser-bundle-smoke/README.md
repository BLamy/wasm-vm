# Corrected sound runtime: built demo handoff

Source/runtime: `e8850241b686fd497c4ff1589fd31b6ffd0c7cc4`.
Recorded bundle/metadata head: `bd2ca26721a21d3ba8be5a58b7347cea40990421`.
WASM SHA-256: `95d1f68df359850d23b4c1b27a76baae393f89efe2cca99b68c2bfa23251c3e3`.

After `make web-dist`, one local built-page load passed:

```sh
E5_DEMO_TASK=E5-T26h E5_DEMO_VERIFIED=1 E5_DEMO_OUT=evidence/e5-t26h/browser-bundle-smoke node tools/verify/e5-t18e-demo-smoke.mjs
```

Chromium: 126 passed, 0 failed; zero console/page/HTTP errors; visible E5-T26h
VERIFIED. The screenshot was inspected. JSON SHA-256:
`95501911a0d9421b8c5edb645d37b4e4032ba1e541851351061a9d3bbce6e1fc`;
PNG SHA-256: `262d9cb7c27b90c402b58e2492b21a6d24e9987b89d02099e9e1b2bfb5962934`.

An earlier smoke reached 126/0 but timed out finding the absent E5-T26f entry in
stale generated task metadata. Regenerating `web/tasks.json` from current task files
and rebuilding the bundle fixed that tooling/data failure; no runtime change was
needed. This result proves the built demo/roadmap handoff, not T26f desktop restore
or production deployment. All merges and production publishing remain at the
user-requested Epic 5 / Omarchy milestone.
