# E5-T26k — bounded decoded-cache selection

Worker freeze: `a53e51a6caf6eb542e4fa2ef4c039f84298a5ec6`.
This is an explicit configuration experiment, not an F timing acceptance,
production default change, or claim that Omarchy has shipped.

## Implemented boundary

The actual core cache reports its slot count. WASM accepts only primitive numeric
4096/16384; URL/loader options also accept those two exact decimal strings.
Omission and same-capacity selection preserve live state. A real change delegates
to the existing coherent cache/discovery/executor reset. Selection follows all
initial restore candidates and precedes the first guest pump. No snapshot fields,
guest semantics, cache keys/probing/replacement, JIT policy or clocks changed.

## Recorded local gates

`gates/runtime.log` records `make verify-E5-T26k-runtime`: formatting, targeted
core/WASM Clippy, no-std WASM build, 7 new native tests, 16 affected integration
tests, and 228 JavaScript tests. All pass. The cache differential inside those
integration tests compares 127 vendored RISC-V ELFs with caching off, normal
capacity, and pathological one-entry capacity; it does not itself test 16384.
The new native tests cover both supported sizes, actual live cursors/discovery,
guest/device identity, restore, aliases, logged page writes, revoked PMP and SMC.
The hostile next-op patch retires 20 instructions with guest trace hash
`568b64d33599f3f5`, identical to legacy execution at both supported capacities,
including the final resume bytes.

`gates/wasm.log` records:

```sh
wasm-pack test --node crates/wasm --test decoded_cache_capacity --test icount_divider --test guest_clock
```

All 19 tests pass: 3 new real-WASM compiled-cache/strict-input/restore tests plus
16 unchanged clock/divider tests. A pre-existing `hart_ctrl` unused-import warning
and the tool's local wasm-bindgen installation fallback remain in the transcript.

`gates/web-dist.log` records the local release WASM/browser bundle build. Two
pre-existing unrelated dist manifest edits were preserved and excluded from the
commit. This is not a deployment or release-manifest validation claim.

## Browser measurement

The actual invocation is:

```sh
E5_T26K_OUT=evidence/e5-t26k/capacity-a53e51a6 node tools/verify/e5-t26k-browser-capacity.mjs
```

Browser: headless Chrome/152.0.7977.76 on the local Mac.
No checkpoint override is supplied: the driver creates a new runtime-bound cold
seal, then independent 4096/16384/16384/4096 copies. `invocation.json` retains the
source hashes and full settings; each child retains its raw JSON/PNG/server and
run logs. The original F restore T0, physical `play` at 5-ms edges, PCM/completion
and 2000-ms assertion stay intact. Before/after capacity/clock/counter RPCs are
sequential observations, not atomic or exactly the frozen interaction interval.
An exit-1 child is collectible only for the original timing-cap failure, with
all reached functional predicates intact. Output refuses existing evidence.

The complete cold/ABBA run exited 0 as a **measurement**, with all four children
exiting 1 at the original F timing assertion. All reached functional checks pass:
independent profile copies, restored CRC `f43155a5` without reboot, ten physical
key edges, fresh green completion, and 1440 fresh non-silent PCM frames per arm.
The four failure PNGs have identical SHA-256
`7d6a3d3b70a46898ec64763d087a753e1c291ef05452dead81f7683003180333`;
they show actual post-restore PID 999/start 29961, completed aplay and prompt.
This is not a later drag/coherence/second-restore or zero-XRUN proof.

| Order / entries | Original interval (ms) | Decoded builds | JIT retirement share | Retranslations / evictions |
| --- | ---: | ---: | ---: | ---: |
| 1 / 4096 | 4864.945 | 683942 | 36.99% | 270 / 105 |
| 2 / 16384 | 4687.215 | 140396 | 39.75% | 435 / 105 |
| 3 / 16384 | 4685.490 | 143014 | 40.20% | 422 / 105 |
| 4 / 4096 | 4885.200 | 690417 | 37.42% | 263 / 105 |

Means are 4875.0725 versus 4686.3525 ms: a local 188.72-ms/3.8711% difference,
not a general speedup claim or a passing deadline. Decoded builds fall roughly
80%, but compiled retranslation increases and the original timing still fails.
Cache capacity alone does not solve F. Default 4096 remains unchanged.
All intervals have zero bulk decoded flush/discard deltas. Before RPC requests
are T0+261.78–263.60 ms and replies T0+314.29–325.49 ms; after requests are
end+0.71–0.98 ms and replies end+80.66–92.58 ms. Thus counter deltas include
different guest work than the frozen interaction interval; no timer-based host
cost or exact first-PCM timestamp is inferred.

The new retained seal is
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26k-capacity-hQWMhT`.
It contains a 2807842-byte snapshot, generation 622, SHA-256
`73c991c15d48e68869109934104c335be38f0b44def134a7719316350acc7ddd`;
profile SHA-256 is `27697985b33306bf700fade238b7a684a72504ed79f6f0deab73edf002c6c92b`.
Runtime binding is `c62e2e6ef6f2efd301d78e9ca69bcb1eed2b2599fc3834172b8f688b415aa986`,
with WASM SHA-256 `041a86da41dbbd66b887dc480a93e25c60316c77030f6e1044cd46f4db31999f`.
The full report `capacity-a53e51a6/comparison.json` has SHA-256
`408f0e39bcdee9b7766b96557f615e8af49ea1e8fc5e652ca32159e8c7a214e4`;
`cold/diagnostic-checkpoint.json` has SHA-256
`e3118c2d988ea1c4a082e1e872de791b7608ef1639f80950b6452f070d96791a`.

The single built-demo smoke (`demo-a53e51a6/`) passes 126/126 with zero console
or HTTP errors and shows the K task in progress. Screenshot SHA-256:
`1b66363502e765295099bed0248a0b2578718c7ef4cb43ef7c191ee781855477`.
`browser-digests.txt` pins all 36 retained cold/arm/demo files and the full outer
transcript; check it with `shasum -a 256 -c browser-digests.txt` in this directory.

## Independent verification

Daybreak's predictions and source-only preflight are in `verifier/preflight.md`.
`verifier/native-wasm-results.md` closes the native/WASM boundary: one pristine
clone at the exact worker head passes the same gates with an initially absent
isolated target and scrubbed inherited build/task options. Its 12-case pending
code-patch attack passes, and removing executor invalidation in a separate scratch
copy makes the intended real-WASM regression fail (`compiledBlocks` 1 instead
of 0). Raw commands, logs, test/patch and digests are retained under `verifier/`.
All verifier compiles/tests ended at 12:02:46.996 UTC, before the four timing arms.
The final built-browser/cold-seal/ABBA review is pending. Unchanged
HELD results from the prior boundaries are carried only where source/dependency
and evidence bindings remain unchanged. The old F seal is not rebound to K.
