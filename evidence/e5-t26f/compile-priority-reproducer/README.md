# Compile-priority source-level reproducer

One native run completed with exit 0 on 2026-09-08 at repository head
`690e23245b4b376c55c0b830f7690c8a0f72059e`. **The frozen-priority phenomenon
reproduced.** This is F investigation, not desktop performance evidence, an E4
acceptance-criterion violation claim, or a runtime-policy recommendation.

The standalone crate depends on the actual local `wasm-vm-core` library. It
uses public `BlockDiscovery`, `CompileQueue`, `CompileJob`, and `MicroOp`, with
`jal x0, 0` decoded by the real decoder. Discovery threshold 64 and compile
queue cap 256 remain at their defaults. It composes the staging API calls used
by `Machine::pump_jit_translations`; it does **not** invoke that private function,
execute a guest, instantiate an executor, or reproduce a browser schedule.

Both candidates were staged with hotness 64. After 1,000 additional discovery
entries for the later candidate, the actual values were:

| Candidate | Physical PC | Stored priority at pop | Live hotness at pop | Pop order |
| --- | --- | ---: | ---: | ---: |
| Earlier | `0x80001000` | 64 | 64 | 1 |
| Later | `0x80002000` | 64 | 1064 | 2 |

Discovery reported two nominations and 1,000 deduplicated entries. Generation
stayed 1. Neither overflow, backpressure nor stale cancellation occurred; both
requests passed actual generation/byte `install_check`. The stored tie retained
insertion order despite the later candidate's increased live hotness.

Source anchors at the pinned head: `crates/core/src/dispatch.rs:618` increases
queued hits, `:732` reads current hotness; `crates/core/src/lib.rs:4108` samples
hotness once while staging; `crates/core/src/compile_queue.rs:55` stores it and
`:159` compares stored priorities when popping. Source inspection plus this
composition establishes the mechanism, **not its frequency or causal relevance
to F's observed latency**.

## Exact recording and replay

From the repository root, the one recording invocation was:

```sh
node evidence/e5-t26f/compile-priority-reproducer/record.mjs
```

It ran exactly:

```sh
cargo run --offline --manifest-path evidence/e5-t26f/compile-priority-reproducer/Cargo.toml --target-dir evidence/e5-t26f/compile-priority-reproducer/target
```

The recorder refuses to overwrite retained output. To replay only the native
program, use the cargo command above with `--locked` to retain the standalone
crate's recorded dependency resolution. Its Cargo.lock is separate from the
unchanged repository lock; build outputs are isolated in the ignored local
`target/` directory. No runtime files, served bytes, tests, gates or policies
were modified or run beyond this single native reproducer invocation.

- `run.log`: separately labelled raw stdout/stderr, exact command and cwd;
  SHA-256 `8a331da2c715d27b6b9ac41f60fa1e0abfe3b1a566dfc4ad918d7815d107bf93`.
- `provenance.json`: command, toolchain, timestamps, exit status, source SHA-256
  pins checked unchanged before/after, and local Cargo.lock digest;
  SHA-256 `becf8e4dbdea1739c1291edeaefb2fc0c3ded3703bf0ff82b1cadc8549bfb21b`.
