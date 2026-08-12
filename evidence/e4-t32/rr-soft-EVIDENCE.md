# E4-T32 host-layer rr-soft evidence

- Frozen source head: `aca44846c85ea1e07c9c6d7534203fbab3f3b9f5`
- Host: `ip-172-31-10-9`, x86_64 Linux `6.17.0-1019-aws`
- Recorder/replayer: rr-soft `5.9.0`, always invoked with `-W`
- Toolchain: rustc/cargo `1.97.1`; Node `v22.23.1`
- Remote exact-source directory: `/home/ubuntu/e4-t32-rr-aca4484`
- Selected tracked-source manifest: 403 files, local and remote SHA-256
  `b3fcf438fe0a3869ab946837537afbea33532a78d1900ddbe5dccbe75baab34e`

All three runs used `rr record -W --chaos`, were packed with `rr pack`, and then completed a
non-interactive `rr replay -W -a` with byte-identical test output.

## Recordings

### `e4-t32-core-budget-chaos`

Command (after building only the named integration-test binary):

```sh
rr record -W --chaos -o rr-traces/e4-t32-core-budget-chaos \
  /home/ubuntu/wasm-vm/target/debug/deps/async_compile_pipeline-c70b0910e911558e \
  run_compile_budget_preserves_backlog_and_eventually_drains --exact --test-threads=1
```

Result: 1 passed, 0 failed. Marked replay cites the test pass at event 495, summary at event 511,
and trace exit at event 521. At event 459, a breakpoint at `crates/core/src/lib.rs:2745`
observed `jit_run_attempt_remaining=8`, `jit_run_staging_remaining=32`,
`jit_run_staged_nominations=32`, `reqs.len=8`, and `valid.len=8`. A conditional breakpoint at
`crates/core/src/lib.rs:2351` on the JIT-enabled machine observed outcome `MaxInstrs`, aggregate
attempts 8, staged nominations 32, final pumps 0, and remaining attempt budget 0. This anchors the
shared per-cooperative-run compile ceiling in the replay, while the test asserts backlog preservation,
eventual drain, and interpreter-identical architectural state.

Manifest: `e4-t32-core-budget-chaos.sha256` (12 packed files), manifest SHA-256
`dd06f5027d7feade2708cc0c8caece8ee48614278f0e4442866f465813334e33`.

### `e4-t32-core-terminal-chaos`

```sh
rr record -W --chaos -o rr-traces/e4-t32-core-terminal-chaos \
  /home/ubuntu/wasm-vm/target/debug/deps/async_compile_pipeline-c70b0910e911558e \
  terminal_outer_scope_skips_final_pump_and_preserves_backlog --exact --test-threads=1
```

Result: 1 passed, 0 failed. Marked replay cites the pass at event 493, summary at event 509, and
trace exit at event 519. At event 459, a conditional breakpoint at
`crates/core/src/lib.rs:2351` observed outcome `Exited(0)`, aggregate attempts 0 and final pumps 0;
the preserved budgets were still 64 attempts / 256 staging nominations before scope teardown.
The test then proves the backlog installs on the next non-terminal host quantum without changing
architectural state.

Manifest: `e4-t32-core-terminal-chaos.sha256` (12 packed files), manifest SHA-256
`be2da7c99e0e5ae5d7046a22ae985e6671d3cb33ba6d08457163c1cc82db3119`.

### `e4-t32-protocol-lifecycle-chaos`

```sh
rr record -W --chaos -o rr-traces/e4-t32-protocol-lifecycle-chaos \
  /usr/bin/node --test --test-concurrency=1 web/tests/e4-t32-worker-protocol.test.mjs
```

Result: 22 passed, 0 failed. Replay anchors include task-quiescence join/closed admission at events
4678/4682, explicit FIFO/transfer/stop order at 4709/4713, natural-completion serialization at
6104/6122, fatal-wins cleanup at 6135/6139, bounded stuck dependency cleanup at 6227/6231, and
fail-closed live-pump timeout at 6289/6293. The final TAP totals are anchored at events 6779-6796;
the trace exits at event 7021.

Manifest: `e4-t32-protocol-lifecycle-chaos.sha256` (15 packed files), manifest SHA-256
`1b7050b104b8d39a3ad09021d91b414ca12f90af9232dbacbffe0bc7815e6c8a`.

## Replay

Replay must use the rr-soft binary and `-W`, for example:

```sh
/home/ubuntu/.local/bin/rr replay -W -g 459 \
  /home/ubuntu/e4-t32-rr-aca4484/rr-traces/e4-t32-core-budget-chaos
```

The packed local copies and adjacent manifests were re-hashed after `scp`; every listed file passed
`shasum -a 256 -c`.
