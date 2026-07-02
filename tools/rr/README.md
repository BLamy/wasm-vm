# rr for wasm-vm

[rr](https://rr-project.org) records a program's execution — every syscall result, every
thread interleaving — so the run can be replayed *deterministically* under gdb, forwards
and **backwards**, as many times as you want. The recording, not the terminal output, is
the evidence unit in this repo's worker/verifier loop (see `AGENTS.md`).

Why it fits an emulator project unusually well:

- **"Who corrupted this?" is a two-command answer.** Guest state lives in plain Rust
  memory. Set `watch -l` on the corrupted register/CSR/RAM cell, `reverse-continue`, and
  you are *at the line that wrote it* — no matter how many million instructions earlier.
- **Chaos mode is a concurrency attack tool.** `rr record --chaos` randomizes scheduling to
  surface races; when one fires, you don't get a flaky log — you get a recording of the
  race, replayable forever. This is the verifier's weapon for atomics (E1-T04), the JIT
  cache (E4), workers and SMP (E4/E6).
- **Traces are transferable.** `rr pack` makes a trace directory self-contained; the worker
  records once, the verifier interrogates the *same execution* on another machine.

## Platform reality (read this first)

rr needs **Linux** and **hardware performance counters (PMU)**.

| Environment | rr? | Notes |
|---|---|---|
| Linux bare metal (x86_64 or aarch64) | ✅ | needs `perf_event_paranoid ≤ 1` |
| Docker on a **Linux host** | ✅ | `--cap-add=SYS_PTRACE --security-opt seccomp=unconfined`, host paranoid knob still applies |
| GitHub Actions Linux runners | ⚠️ usually | run `tools/rr/preflight.sh` as the job's first step; skip-with-noise if it fails |
| Cloud VMs | ⚠️ | only with vPMU (e.g. `*.metal` instances); preflight first |
| **macOS (this dev machine)** | ❌ | no rr, period |
| Docker Desktop / UTM / any VM on Apple Silicon | ❌ | PMU is not virtualized |

So on this Mac: guest-layer evidence (instruction traces, digests, Spike diffs — see
`AGENTS.md` "Evidence") is the native currency, and rr recording happens on a Linux box or
in CI. Both *recording and replay* need Linux+PMU; replay also wants a CPU compatible with
the recording (same architecture, compatible feature set), so keep record/replay pairs on
the same class of machine.

## Setup (Linux)

```sh
# install: rr is in most package managers, or grab a release
sudo apt install rr          # debian/ubuntu
sudo dnf install rr          # fedora

# kernel knobs (per boot):
echo 1 | sudo tee /proc/sys/kernel/perf_event_paranoid
sudo cpupower frequency-set -g performance   # optional: steadier counters

# sanity check the whole stack:
tools/rr/preflight.sh
```

Debug symbols are already on in every cargo profile (`.cargo/config.toml`, `debug = 2`) —
a trace without symbols is evidence nobody can interrogate. For readable Rust values in
gdb, rustup ships `rust-gdb`; rr uses it if you set `RR_GDB=rust-gdb` or pass
`rr replay -d rust-gdb`.

## Recording

Use the wrapper — don't `rr record cargo test` directly (that records rustc and the whole
build; enormous trace, useless evidence):

```sh
tools/rr/record-test.sh -p vm-core hart_step          # record matching tests in a crate
tools/rr/record-test.sh -p vm-core lr_sc --chaos      # chaos scheduling (run several!)
tools/rr/record-test.sh -o e0-t07-final -p vm-core '' # name the trace for the claim
```

The script builds the test binary (`cargo test --no-run`), records only test binaries that
actually contain matching tests, forces `--test-threads=1`, records into
`rr-traces/<name>`, and `rr pack`s the result so the directory can be handed to a verifier.
If you can't lower `perf_event_paranoid` (locked-down CI), `rr record -n` disables the
syscall buffer and sometimes gets you through — slower, same fidelity.

## Replaying (the verifier's side)

```sh
rr replay rr-traces/e0-t07-final          # opens gdb at the start of the recorded run
rr replay -g 48123 rr-traces/e0-t07-final # jump straight to a cited event number
```

Inside the session, `source tools/rr/verifier.gdb` loads the helpers (`whowrote`,
`whoread`, `cite`).

### Cheatsheet

| forward | key | backward | key |
|---|---|---|---|
| step into | `s` | reverse step | `rs` |
| step over | `n` | reverse next | `rn` |
| finish fn | `fin` | reverse finish | `reverse-finish` |
| continue | `c` | reverse continue | `rc` |

- `info locals` / `p expr` / `p cpu.regs[5]` — inspect anything at the paused point
- `list module::function` then `b <line>` — breakpoints; `b bus.rs:141 if addr & 7 != 0`
  — conditional breakpoints (attack tool: break only on the misaligned path)
- `watch -l <lvalue>` / `awatch -l <lvalue>` — hardware write/access watchpoints; combine
  with `rc` for last-writer queries. **This is the single highest-value move in the whole
  toolbox**: `whowrote cpu.csrs.mstatus` answers in seconds what printf-debugging answers
  in hours.
- `when` — current event number. **Every verifier finding must cite one**; it's this
  repo's equivalent of a Replay "point link" — anyone can re-open the exact moment with
  `rr replay -g <event>`.
- `dprintf file.rs:123, "x=%ld\n", x` — retroactive logging: add "logpoints" to a run
  that already happened, then `c` to stream them.
- TUI mode: `Ctrl-x Ctrl-a`.

## Handing off evidence

Worker: record, `rr pack` (the script does it), then reference `rr-traces/<name>` plus the
key event numbers in the task's Verification log. `rr-traces/` is gitignored — traces move
via artifact upload (CI) or direct copy, not git.

Verifier: never accept a summary in place of the trace. If the claim cites no trace and no
guest-trace digest, the verdict is `needs-evidence` before you read a line of code.
