# Narrow input/FP checks

Read-only support evidence for the mixed-renderer candidate. This note is diagnostic evidence,
not a verification status change and not a browser or native Omarchy acceptance claim.

## Commands and results

```text
cargo test -q -p wasm-vm-core input:: --lib
EXIT=101
BLOCKED before selected input tests ran: crates/core/src/dev/virtio/gpu/mod.rs:2390
calls missing GpuState::cursorq_commands(). This is an unrelated existing GPU test compile
failure; this task did not modify or bypass it.

cargo test -q -p wasm-vm-jit-runtime --test mixed_fp_regions -- --nocapture
EXIT=0
running 2 tests
..
test result: ok; 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out

cargo test -q -p wasm-vm-jit-runtime --test jit_execution \
  fp_suites_verdict_identical_under_jit -- --nocapture
EXIT=0
FP suites verdict-identical under JIT: 11 rv64uf + 12 rv64ud ELFs Pass
test result: ok; 1 passed; 0 failed; 0 ignored; 0 measured; 19 filtered out

node --test tools/verify/omarchy-input-diagnostic.test.mjs
EXIT=0
8 passed; 0 failed
```

The T03b-specific `mixed_fp_regions` test covers the 12-line mixed F/D/integer partition: the
interpreter and Wasmtime JIT architectural snapshots match, both integer regions compile and
retire through JIT, the FP region remains interpreter-only, and the FP-off trap agrees. The
focused compliance comparison independently reports identical interpreter/JIT verdicts for 11 F
and 12 D ELFs, all Pass.

## Getter coverage boundary

The helper test statically covers the new `inputDeviceStats` WASM export, loader getter, worker
protocol allow-list, and diagnostic `stats` collection. The export returns `null` when no keyboard
device is attached and otherwise exposes the actual pending budget/events/frames plus dropped,
served-status, and rejected-event counters without mutation.

No WASM build or browser run was performed here, so this does not exercise the generated binding,
worker RPC transport, or live valid/absent-device values. The core input/snapshot tests could not
be reached because of the pre-existing GPU test compile error above. No additional JS protocol test
was needed: the existing helper test is the narrow test for this diagnostic surface.

No core/JIT source or worker-owned test files were changed. No full `make ci`, predecode test, web
build, browser run, commit, or verification status update was performed.
