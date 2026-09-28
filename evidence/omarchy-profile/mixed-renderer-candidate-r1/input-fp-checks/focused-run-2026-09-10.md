# Focused input/FP run

Bounded diagnostic run only. No runtime or test-source edits, no core input tests, predecode tests,
browser run, WASM build, or `make ci`.

## Read-only inputDeviceStats getter/protocol coverage

Command:

```text
node --test tools/verify/omarchy-input-diagnostic.test.mjs
```

Exit: `0`

```text
8 passed; 0 failed
diagnostic stats expose the read-only keyboard device counters: passed
```

This exercises the existing static protocol/helper coverage for the WASM export, loader getter,
worker allow-list, and diagnostic stats collection. It does not claim a new generated-WASM or live
RPC run.

## Mixed FP/integer JIT verdict comparison

Command:

```text
cargo test -q -p wasm-vm-jit-runtime --test jit_execution \
  fp_suites_verdict_identical_under_jit -- --nocapture
```

Exit: `0`

```text
FP suites verdict-identical under JIT: 11 rv64uf + 12 rv64ud ELFs Pass
test result: ok; 1 passed; 0 failed; 0 ignored; 0 measured; 19 filtered out
```

## Existing translator FP admission check

Command:

```text
cargo test -q -p wasm-vm-jit-translate --test differential \
  fp_ops_are_unsupported -- --nocapture
```

Exit: `0`

```text
test result: ok; 1 passed; 0 failed; 0 ignored; 0 measured; 11 filtered out
```

These results are narrow test evidence only; they do not mark T03b verified.
