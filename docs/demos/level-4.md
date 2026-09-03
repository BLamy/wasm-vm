# Level-4 capstone procedure (E4-T28f)

This is the reproducible hand-off for the Level-4 acceleration slices. The capstone is a
single-build report assembled from the four workload records, the E4-T26 compliance record, and
the E4-T25 lockstep record. A child record carries its own exact source commit and artifact
identity; the final report compares those commits instead of silently treating historical results
as same-head measurements.

## Cold checkout and fresh browser profile

From a new checkout, install the repository's documented Rust, wasm-pack, Node, and Chromium
prerequisites. Build the deployable page locally, then run the identity self-test:

```sh
make web-dist
bash tools/capstone_e4.sh --self-test
```

For a complete fresh browser replay, use a new Playwright context for every child. The four exact
Chromium commands are:

```sh
cd web
PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8133 PLAYWRIGHT_REUSE_SERVER=1 \
  npx playwright test tests/e4-t28-node-interactive.spec.js --project=chromium
PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8133 PLAYWRIGHT_REUSE_SERVER=1 \
  npx playwright test tests/e4-t28-coremark.spec.js --project=chromium
PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8133 PLAYWRIGHT_REUSE_SERVER=1 \
  npx playwright test tests/e4-t28-cold-boot.spec.js --project=chromium
PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8133 PLAYWRIGHT_REUSE_SERVER=1 \
  npx playwright test tests/e4-t28-gcc-interactive.spec.js --project=chromium
cd ..
```

The child specs write their records under `evidence/e4-t28b` through `evidence/e4-t28e`. The
ordinary final command consumes those committed records and produces one aggregate report:

```sh
bash tools/capstone_e4.sh --final
```

To replay all four long browser workloads as part of the final command, set the explicit opt-in
flag in a clean checkout:

```sh
CAPSTONE_E4_RUN_CHILDREN=1 bash tools/capstone_e4.sh --final
```

The final report is written to `evidence/e4-t28/capstone-2026-09-03.json`. It exits zero when the
report is complete, even when a measured gate is recorded as `gap`; set `CAPSTONE_E4_STRICT=1` to
make any gap fail the command. This distinction keeps an evidence hand-off reproducible without
turning an unavailable browser workload into a false pass.

## What the report must show

The report carries the exact candidate head, build controls, baseline contract, served/deploy
manifest hashes, required COOP/COEP headers, all four child evidence hashes, and the following
gate rows:

- Node REPL echo p95 `< 100 ms`, generated-code/FENCE.I markers, and the guest-computed HTTP ratio.
- CoreMark validation, guest score, host/guest clock comparison, and the immutable baseline row
  when one exists.
- First guest console byte → real Alpine `login:` median from three fresh contexts, with no restore
  or whole-image shortcut.
- In-guest `gcc -O2 -c miniz.c`, object identity, and independently injected terminal probes.
- E4-T26 compliance and E4-T25 lockstep summaries, each tied to the same candidate head.
- Bun result or an explicit non-gating unavailable gap.

WebKit and independent-machine results are outside this directed proof. Host rr is waived by the
repository evidence policy. A result with a missing child, mismatched commit, warmed profile, or
unreported request/console error is recorded as a gap (or rejected in strict mode), never promoted
to a passing benchmark.

The existing demo screenshots are retained as visual records in
`evidence/e4-t32/browser/whole-worker-demo.png` and
`evidence/e4-t32/browser/e4-t32-compliance-126-of-126.png`.
