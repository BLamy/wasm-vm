# E9-T11 corrected verifier evidence

VERDICT: verified

Runtime: `e14e4312b9ee8df73b93646c944bf64a2f0db875`. Worker submission:
`9abe576db62c7a8f691cc2224fb507df4a384b58`. The verifier made no runtime edits.
`predictions.md` and `orientation.json` precede inspection of corrected results.

The corrected actual-Wasmtime budget 1/6 matrix has 36 ordered RTC polls at
transitions 384 through 419, including the second sample at 385. All worker and
independent cold initial/final frames and tapes match byte for byte. The final
position is 420/420 with source cursor 36 and zero live replay RTC calls.
`armed.observations.jsonl:2` is the corrected counterpart to the historical failure.
The armed tape SHA-256 is
`a7bc8890064f0f33aff0b68b91c1398720fc0fe3494784a32cc103e916046dae`.

The disarmed guest-read matrix preserves actual compiled compute and interpreter
MMIO fallback: exactly four reads at 390, 398, 406, and 414, native end 416/416,
source cursor 4, identical frames and zero live replay calls. The tape SHA-256 is
`f171dbc3561b2bb1575401e81ab93e3fbc87f958dbf8f29fd5ce1475c02f0346`.

The independent firing-edge harness uses RTC values 123, 124, and 125 with alarm
125. Every record/replay pair of budgets 1, 6, and 7 has exactly three polls at
384, 385, and 386, then stops polling and resumes compiled execution. The final
position is 468/468, source cursor 3, RTC armed=false and fired=true. Its nine raw
initial, record, replay frames and observation tapes are retained in
`boundary-cadence/`. The tape SHA-256 is
`1474ed96f23150d5774705d8af541796abe61c6913a989c7fa8248d97f68874c`.
The final frame SHA-256 is
`525d65ccf3f3fc5ff9690f3dc32472c82d8303c4d2b4a2953a5cfc003d339476`.
The same harness proves the disarmed capture still executes four compiled blocks
and ordinary uncaptured armed execution retains six polls and six compiled blocks.

`jit-frame-critic.py` uses Python struct decoding and SHA-256, without the emulator
codec, to check CPU arithmetic, RTC flags, CLINT phase and native session/source
positions. Re-run it from the repository root with an output in ignored scratch:

```sh
python3 evidence/e9-t11/verifier-corrected-final/jit-frame-critic.py --mode boundary --directory evidence/e9-t11/verifier-corrected-final/boundary-cadence --output target/e9-t11-boundary-critic.json
python3 evidence/e9-t11/verifier-corrected-final/jit-frame-critic.py --mode jit --directory target/evidence/e9-t11-worker-corrected-final/native --output target/e9-t11-jit-critic.json
```

`worker-identity.json`, the cold identity/origin audits, and `public-identity.json`
authenticate every indexed artifact and all 51 frozen source digests. Worker and
cold selected gates each pass 696 native tests, 81 Node tests, and the 127/0 browser
suite with no console errors. Public proof authenticates all 18 source and 58 GPU
assets against frozen dist, both direct/whole-worker 413-event terminal journals,
real CSPRNG failure replay, source/clock oracles, and actual GPU retirement/draw.
`production-rtc-critic.py` independently reconstructs all four UART RTC words from
authenticated durable events and rejects a one-bit sample corruption. Re-run with
`--directory target/evidence/e9-t11-public-corrected-final/browser --output
target/e9-t11-production-rtc.json --sabotage`.

`held-ledger.json` is an exact copy of the earlier scoped HELD ledger. The old
runtime failure and its receipt remain in `../verifier-refutation/`; that failure
is historical evidence, not corrected proof. Unchanged results and the existing
224-hunk coverage classifications carry forward. The new runtime hunk and its
armed/disarmed/inactive edges are classified in `incremental-coverage-ledger.md`.

Permanent regressions were promoted in verifier commit
`efddcc0a261056933b562b70f74c4742dc640465`: the two actual-JIT source tests in
`e9_event_clock_critic` and the 3 MiB byte-budget test in `e9_time_entropy`.
They run automatically in `make verify-E9-T11`. The old red recording proves the
JIT regression detects the missing dispatch guard; the corrected selected runs
pass it. This final incremental commit changes only verifier evidence and task
metadata. Full software/Linux replay remains gated by T12–T14.

Both old and corrected cold-clone provenance audits are complete. Their exact RAM
source/compiler directories named in `cold-origin-final-audit.json` are disposable
after this verdict. Independent persistent Git metadata passes connectivity fsck
without alternates; retain it, all original recordings, and committed capsules.
This verifier did not delete or detach anything.
