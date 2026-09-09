# Independent non-listener checks

At exact publication head `0da96f6a5c7f323b986fe41b6f6bfb2508eec834`:

```text
node --check web/bench/desktop-perf-hooks.js
node --check web/src/sink/presentation.js
node --check web/main.js
node --test web/tests/e5-t25a-perf-hooks.test.mjs web/tests/e5-t06d-presentation.test.mjs
node tools/verify/e5-t25a-release-audit.mjs
cmp -s web/bench/desktop-perf-hooks.js web/bench/desktop-perf-hooks.ts
cmp -s web/src/sink/presentation.js web/dist/src/sink/presentation.js
cmp -s web/main.js web/dist/main.js
```

All commands exited 0. Node reported 8 tests, 8 passed, 0 failed, 0 skipped,
0 cancelled, and 0 todo. The release audit printed:

```json
{"productionImport":false,"productionPageSurface":false,"hookVersion":"e5-t25a-v1"}
```

`node evidence/e5-t25a/verifier-r2/independent-attacks.mjs` deliberately exits 1:
154 falsifiable checks ran, 153 held, and exactly the null-sampler prediction failed.
The full and compact machine-readable observations are retained beside this file.
