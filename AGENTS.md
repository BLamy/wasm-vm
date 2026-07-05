# AGENTS.md — how agents drive this repo

Operating manual for any agent (or human) working in wasm-vm. `ROADMAP.md` says where we're
going. `tasks/QUEUE.md` says what's next. This file says how work gets done — and, more
importantly, how work gets **proven**.

## The one rule

An implementer being satisfied is a **claim**. A deterministic recording of the run that
satisfied them is **evidence**. No task reaches `verified` on claims: a separate,
adversarial verifier session must interrogate the evidence, hold it against the diff, and
fail to refute it. Every other rule in this file serves that one.

The pattern is the worker/critic replay loop from Replay-style web verification, ported to
native Rust: where a web critic interrogates a Replay browser recording, our critic
interrogates an **rr trace** of the emulator process (time-travel gdb: reverse execution,
watchpoints, retroactive breakpoints) and/or a **guest instruction trace** produced by the
emulator itself. Same doctrine either way: *not "trust me, I checked" — here is the session
where it worked, in full; interrogate it.*

## Roles

**Worker** — implements exactly one task from the top of the queue. Self-validates as much
as it likes (ephemeral runs, no limit), then submits three things: the diff, a claim, and
recorded evidence of the final happy run.

**Verifier (critic)** — a **fresh session**, never the one that implemented. It does not fix
code and does not trust the worker's summary. It attacks the claim from two directions:

1. **Falsification** — find one point in the evidence where the program contradicts the
   claim or the task's acceptance criteria.
2. **Sufficiency** — find changed code the evidence never exercised. Unexecuted diff is
   either unproven (demand a run that exercises it) or dead (demand deletion).

A worker can therefore fail two ways: the evidence contradicts the claim, or the evidence
doesn't cover the claim.

The same agent may play both roles on *different* tasks — never both roles on the same task.

## Task lifecycle

```
pending → in-progress → implemented → verified   (terminal; only the verifier sets this)
                              ↘ refuted → in-progress (worker reworks, re-records)
```

Statuses live in each task file's frontmatter. After any status change:
`python3 tools/build_queue.py` regenerates `tasks/QUEUE.md`, then commit. One task
in-flight at a time; a task's `depends_on` must all be `verified` before starting it.

## Worker protocol

1. **Pick work.** Top entry of "Next up" in `tasks/QUEUE.md`. Read the whole task file —
   the Adversarial verification section tells you how you'll be attacked; build for it.
2. Set `status: in-progress`, rebuild queue, commit.
3. **Implement.** Gates in ascending cost, any failure returns to the top:
   `cargo fmt --check` → `cargo clippy -- -D warnings` → native tests →
   `cargo build --target wasm32-unknown-unknown` (+ wasm tests where they exist).
3a. **Browser-impacting work ⇒ prove it in the browser, and show it on the demo.** If a change
   touches anything a user can reach through the demo (the wasm surface, a new ISA capability,
   an epic's completion, an MMIO device, the console/boot path), you MUST:
   (a) **Update `web/` to surface the new capability** so the demo page keeps proving the whole
       machine works. Add the new live riscv-tests binaries to `web/riscv-tests.js`, and update
       the roadmap panel manifest `web/roadmap.js` (flip a capability to `verified`, add a `group`/
       `filter` so it lights up **live** from the in-browser suite, or move an epic's status). The
       demo is the at-a-glance monitor — it must never silently fall behind what's landed.
   (b) **Playwright-verify the built page**: `make web-build`, serve `web/`, load it with the
       Playwright MCP, assert **zero console errors** (a favicon 404 is fine), the suite reaches
       `126 passed, 0 failed` (or the new total), and the roadmap pips you touched show
       `live`/`verified` — one screenshot for the record. Keep it to a single load-and-assert
       pass; don't rebuild the world. Cite the result in your Verification log entry.
   Non-browser work (pure tooling, compliance harness, docs) skips this gate.
4. **Self-validate freely.** Drive the code however you want — ad-hoc runs, printf, scratch
   binaries. This inner loop is yours; nothing here is evidence.
5. **Record the final happy run.** When satisfied, run the *same* validation one more time
   under recording (see Evidence below). Make the recorded run count: every behavior your
   diff changes should actually execute during it, because the verifier will hold the
   recording against the diff. Changed code the recording never ran is either unproven or
   dead, and the verifier gets to decide which.
6. **Write the claim** as a Verification log entry in the task file: commit hash, exact
   commands run, evidence paths (trace dirs, digest files, diff-vs-Spike results), and one
   paragraph stating what the recording demonstrates.
7. Set `status: implemented`, rebuild queue, commit.

Know that the verifier inspects the full runtime of your recording — memory, registers,
scheduling, every syscall — not just what your test printed. It is looking for any point
where behavior contradicts the task, and for any changed line your run never executed.

## Evidence: two layers of time travel

| Layer | Records | Tooling | Runs where |
|---|---|---|---|
| **Guest** (the machine we emulate) | every retired guest instruction, architectural state digests, diffs vs Spike/QEMU | trace infra (E0-T16), snapshot digests (E0-T17), differential harness (E0-T20) | everywhere — native, wasm, including this Mac |
| **Host** (the Rust process itself) | the entire emulator process: all threads, syscalls, memory — replayable in gdb with reverse execution | rr — see `tools/rr/README.md` | **Linux with PMU access only** (remote box or CI runner; *not* macOS, not Docker Desktop on Apple Silicon) |

- The guest layer answers *"did the machine do the right thing?"* It is the emulator being
  its own Replay browser, and it's mandatory evidence for every task once trace infra
  exists (E0-T16 onward).
- The host layer answers *"why did the Rust do what it did?"* — and gives the verifier the
  killer move: a hardware watchpoint on corrupted state plus `reverse-continue` lands on
  the exact line that wrote it. Mandatory for concurrency-touching tasks (RV64A atomics,
  JIT cache, worker threads, SMP — Epics 1/4/6), where `rr record --chaos` is the attack
  tool of record.
- Before guest trace infra exists (early Epic 0), evidence = deterministic test output +
  an rr trace of the test run where Linux is available.

Record with `tools/rr/record-test.sh` (builds the test binary first so the trace holds the
test, not the compiler; `rr pack`s the trace so it's a self-contained directory you can
hand to the verifier). Traces land in `rr-traces/` (gitignored).

## Verifier charter

You receive: the task file (claims, acceptance criteria, attack list), the diff
(`git diff` scoped to the task's commits), and the evidence paths from the Verification
log. Your goal is to refute. You do not edit implementation code; your writes are limited
to the Verification log, promoted tests, and the status field.

**ORIENT.** Read the task file and the diff before touching evidence. For rr traces:
`rr replay`, get the shape of the run (`info threads`, initial breakpoints on main paths).
For guest traces: check the digest matches the claimed one — a worker citing a stale trace
fails immediately. Cheap sweeps first: did the recorded run panic anywhere, any
`debug_assert` disabled, any test `#[ignore]`d in the diff?

**PREDICT, THEN VERIFY.** For each acceptance criterion, write a falsifiable prediction
about concrete program state at a specific point **before** inspecting that state. A
prediction made after looking is a caption, not a check. Then verify with the narrowest
tool that can falsify it, routing by layer:

- Claim about guest architectural state → trace lines, state digests, Spike differential.
  ("After the `addiw`, the trace shows x5 sign-extended from bit 31.")
- Claim about Rust internals → rr: `print`, conditional breakpoints, `watch -l` +
  `reverse-continue` (helpers in `tools/rr/verifier.gdb`, incl. `whowrote <lvalue>`).
- Claim about concurrency → N chaos-mode recordings (`--chaos`); any divergence or hang is
  a finding with its trace attached.
- Claim about performance → the benchmark harness's numbers against the task's stated
  budget. Never eyeballs.

**Every finding cites a point.** For rr: the event number from `when` (re-openable by
anyone via `rr replay -g <event>`). For guest traces: file + line number + digest. "The
atomics are wrong" is an opinion; "x7 holds the pre-CAS value at rr event 48123" is
evidence anyone can jump to.

**COVERAGE.** Hold the recording against the diff. For each changed hunk: did it execute
during the recorded run? (Breakpoints on the hunk during replay; hit-count is ground
truth.) Classify every unexecuted hunk: **needs-evidence** (behavior the task mentions —
name the exact run the worker must record), **dead** (demand deletion), or **waived**
(types, config, logging — one line of reasoning each). The diff isn't proven until every
changed line is executed, waived, or gone.

**MOCK & ENV HUNT.** Find every fixture the recorded run depended on: hardcoded golden
values computed by the code under test (self-licking test), magic constants, seeded RNG
defaults, `cfg(test)` behavior leaking semantics, environment the run inherited. Cold-clone
rule: acceptance commands must pass from a pristine clone in a scratch dir with scrubbed
env (`RUSTFLAGS`, `CARGO_*`, `RUST_LOG` unset). "Works on the implementer's machine" is a
refutation, not an excuse.

**RUN THE TASK'S OWN ATTACKS.** Execute every angle in the task's Adversarial verification
section — with your own seeds, never the worker's — and invent at least one attack the
section doesn't list. Sabotage-check the tests once per task: break the implementation in a
scratch branch and confirm the worker's tests actually go red.

**SUITE (only if correctness + coverage hold).** Judge what survives as a permanent
artifact — this is the duty that compounds:

- **Deterministic test** — exact assertions on stable behavior → committed unit/integration
  test asserting what *you* verified, not what the worker printed.
- **Golden trace** — the verified guest trace/digest checked in as a differential fixture.
- **Fuzz corpus entry** — inputs that reached interesting states → committed seeds.
- **Verify target** — recurring acceptance commands → a `make verify-*` recipe (E0-T25's
  machinery).
- Or **discard**, with one line of why.

**NO-FIRE LIST.** Do not raise: style nits, performance without a stated budget,
pre-existing warnings, requirements the task doesn't state, or anything you can't anchor to
an rr event, a trace line, or a diff line. Re-check every finding once before raising it.

**VERDICT.** First line: `VERDICT: verified | refuted | needs-evidence`. Then one bullet
per finding: prediction, observed value, citation, one-sentence demand. Append the entry to
the task's Verification log, flip `status` (`verified`, or back to `in-progress` with the
report as the worker's new context), rebuild the queue, commit.

Example log entry:

```
### 2026-07-02 — verifier — VERDICT: refuted
- P2 addiw sign-extension — FAILED. Predicted x5 = 0xffff_ffff_ffff_ff00 after
  `addiw x5, x6, -1`; observed 0x0000_0000_ffff_ff00 at trace line 91442 /
  rr event 48123 (`rr replay -g 48123` in rr-traces/e0-t07-final). Fix, re-record.
- COVERAGE misaligned-store path — INSUFFICIENT. src/bus.rs:141-158 (this diff) never
  executed in the recorded run. Record a run exercising a misaligned SD, or delete.
- SUITE: n/a until refutations clear.
Commands: tools/rr/record-test.sh -p core hart_step --chaos (x5); cargo test -p core
```

## The gauntlet

```
worker edits code
      │
      ▼
fmt + clippy                 seconds  · deterministic
      │
      ▼
tests (native + wasm32)      minutes  · deterministic
      │
      ▼
self-validation              minutes  · worker drives its own runs until satisfied
      │
      ▼
recorded final run           minutes  · rr trace (Linux) + guest trace/digests
      │
      ▼
adversarial verification     minutes  · fresh session falsifies the recording,
      │                                 audits the diff, promotes tests
      ▼
verified → build_queue.py → commit → next task

a failure at ANY stage returns the worker to the top,
with the failure report as new context
```

Failure means starting over, not patching in place — a fix applied mid-pipeline never
re-earned the earlier gates. And every verified task deposits promoted tests, golden
traces, and fuzz seeds into the cheap gates at the front, so the pipeline gets stricter
every time it runs. That's the compounding the whole system is built for.

## Platform quick-reference

- **This Mac**: guest-layer evidence only (traces, digests, Spike diffs run in Docker per
  E0-T13). rr does not run on macOS, nor in Docker Desktop/VMs on Apple Silicon (no PMU).
- **Linux box / CI runner**: full evidence. Run `tools/rr/preflight.sh` once; details,
  install steps, and the gdb cheatsheet in `tools/rr/README.md`.
