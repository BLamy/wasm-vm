# E5-T26j — explicit deterministic timer divider

This task proves an opt-in configuration boundary and an honest comparison, not
F's two-second acceptance, a wall-clock synchronization claim, or a new default.
The default remains ten. The user waived rr, WebKit, and independent machines;
all evidence here is local native/WASM/Chromium evidence with a fresh Daybreak
critic. No production deployment is part of this task.

## Frozen source and carried gates

- Runtime and built WASM: `d2eda6857a2d17d19f8c64b037239a675901f2e6`.
- Final tests/collector: `cb283f9b3204f99d0bbc9ad44121c4f5da7b8b6a`.
- Final task metadata: `054bb87f93b490645d5af921207f97af08629113`.
  The metadata delta contains no emulator, loader, or WASM semantic change.
- Built WASM SHA-256:
  `8df0e82c87aa25d39988517b045b42712f8c94d1bec4f0d1db5ed2ab772f0e3a`.
- Guest-clock JS SHA-256:
  `7381e6869674f1fc92880ad6757ffc831f7a37a0e06e192cc4bb085ecdec9133`.

The components of `make verify-E5-T26j` were recorded separately so unchanged
runtime gates are not rerun merely for metadata/evidence changes:

```sh
make verify-E5-T26j-runtime
PATH="/Users/blamy/Library/Caches/.wasm-pack/wasm-bindgen-cargo-install-0.2.126:$PATH" \
  wasm-pack test --mode no-install --node crates/wasm \
  --test icount_divider --test guest_clock -- --nocapture
make tasks-json
make web-dist
E5_DEMO_TASK=E5-T26j E5_DEMO_OUT=evidence/e5-t26j/demo-054bb87f \
  node tools/verify/e5-t18e-demo-smoke.mjs
E5_T26J_REQUIRE_HEAD=054bb87f93b490645d5af921207f97af08629113 \
  E5_T26J_OUT=evidence/e5-t26j/browser-054bb87f \
  node tools/verify/e5-t26j-browser-clock.mjs
```

The runtime log records 35 native and 175 JavaScript tests, formatting, Clippy,
and the no-default-feature wasm32 build, all passing. The WASM log records 16
passing tests. Native/WASM divider tests agree on guest trace digest
`4ddc392297ebe1dc` and RAM digest
`c7d032c22b596d220102600fedf6e5de9e0f7e38487e0367eb4b8a7d4b51f7c4`.
The phase oracle covers 2,176 small phase/ratio combinations plus extreme prior
dividers, IRQ/device identity, invalid-state atomicity, next-tick and resume cases.
The JIT churn proof records 52,800 monotonic samples with 24,598 evictions.

`worker-d2eda685/guest-rdtime.json` and `worker-d2eda685.log` record the actual
built-loader test (`node tools/verify/e5-t26j-clock-worker.mjs`) at the runtime
head: direct/worker times omitted/10/1, all six cases passing. The guest executes
real `rdtime` instructions and compiled JIT code; mtime matches actual retired
instructions divided by the selected divider, and paused state does not advance.
The source and built runtime bytes exercised there are unchanged at the final
metadata head. This tiny program is not a desktop performance measurement.

The first demo transcript `demo-cb283f9b.log` is a retained failure: the suite
assertion passed but generated task data omitted J. After normal regeneration,
`demo-054bb87f/demo-suite.json` records 126 passed, zero failed, zero browser/HTTP
errors, and the visible in-progress J task. Its PNG is the screenshot of record.
The unrelated local dist artifact-manifest edits were preserved byte-for-byte
and excluded from every scoped commit.

## Restored-desktop comparison

The collector requires one new head-bound cold seal, then four independent
profile copies in fixed 10/1/1/10 order. Every arm keeps `sh /tmp/a`, 5-ms physical
key pacing, JIT/repack-off/cap-24/chaining, image, kernel, and original restore T0.
The before-clock RPC is charged to that interval. The after-clock RPC follows the
already frozen interaction end. Raw records include actual stored/selected clock
receipts, live clock/JIT counters, real mapped cursor, 20 physical key transitions,
conditional terminal output, attached fresh PCM, and browser/HTTP error arrays.

Only the exact original two-second cap failure may be retained as a completed
negative comparison. Any other failure stops the collector with its raw record.
No diagnostic result sets F verified or promotes a default.

The collector completed successfully at `054bb87f`; all four children retained
the exact original cap failure. Measured intervals in ABBA order were:

| Divider | Interaction ms | New guest retirements | New JIT retirements |
| --- | ---: | ---: | ---: |
| 10 | 5168.225 | 59,471,941 | 21,859,366 |
| 1 | 9530.715 | 99,054,144 | 25,750,829 |
| 1 | 9371.235 | 98,021,519 | 26,678,453 |
| 10 | 5098.315 | 58,972,558 | 22,913,894 |

The faster guest timer is a negative result, not a promoted optimization. All
four actual selections preserve stored mtime, keep JIT/chaining active, restore
the same CRC without a boot, deliver the 20 physical key events, show conditional
terminal success, and produce attached fresh non-silent PCM. Error arrays are
empty. Screenshots show recovered ALSA underruns in arms 1, 2, and 4 (0.062,
2.420, and 1.733 ms respectively); this is not a zero-XRUN claim.

The authenticated cold seal is retained at
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26j-clock-q33jA9`.
Its runtime binding is
`43106f3e04a1c814a3d16994f1328755f8c10999a3ca6bc1818874e8812eb5c7`;
the paused desktop snapshot is SHA-256
`82edb9b2f0203a5fa756d565dbbfc3fd7466544952e9b8a9ccca036f0212248a`,
CRC `23f83a92`, overlay generation 626. The collector report is
`browser-054bb87f/comparison.json`, SHA-256
`1a58e7dfd6f5e04754d98cc42bde22d15477c32060917f9f8bcb6b9e910e9d35`;
the full transcript is `browser-054bb87f.log`, SHA-256
`483284eceed610b83652b6c12dddde6ebc934fde1e2a15e99465c3d052c2fb05`.
Each raw JSON, screenshot, and server/child log is retained beside the report.

## Independent verification

`critic.md` owns the independent predictions and verdict. The same pristine
scrubbed clone carries the unchanged runtime gates through the metadata-only
head. Raw verifier records are retained under `verifier/`. Previously HELD
I/H/T19a and F functionality are carried forward only across unchanged boundaries.
