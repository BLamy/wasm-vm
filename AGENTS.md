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
                │             ↘ evidence-needed   (proof gap; code not refuted)
                └──────────────↘ refuted → in-progress (semantic rework)

verification-debt = historical landed work parked outside the active lane
blocked = acceptance is impossible until the named external/roadmap dependency changes
```

Statuses live in each task file's frontmatter. After any status change:
`python3 tools/build_queue.py` regenerates `tasks/QUEUE.md`, then commit. One task
in-flight at a time across `in-progress`, `implemented`, `evidence-needed`, and `refuted`;
a task's `depends_on` must all be `verified` before starting it. Run
`python3 tools/check_task_policy.py` before rebuilding the queue. Historical code that landed
without current exact-head evidence is `verification-debt`, not active work and not `verified`.
A `blocked` task must name `blocked_on` and include an exact repro in its Verification log. It
leaves the active lane so independent eligible work can proceed, but its dependents remain gated.

## Risk and task-size policy

Before a pending task enters the active lane, add `risk: low | medium | high` to its frontmatter.
Security/identity boundaries, guest architectural semantics, persistence, concurrency, JIT code,
and cross-host deployment default to `high`. Ordinary isolated runtime features default to
`medium`. Documentation, declarative metadata, and visual-only work may be `low` when they cannot
change runtime behavior.

An `M`, `L`, or `XL` pending task is a planning container, not executable work. Split it into
ordered `S` task files with one boundary and one deterministic acceptance command each; mark the
parent `cancelled` and point it at the replacements. `build_queue.py` labels unsplit large work
`DECOMPOSE BEFORE START`, and `check_task_policy.py` rejects it if activated. A genuinely atomic
exception needs `decomposition: approved` plus a written `## Execution slices` section.

Verification cost follows risk:

| Risk | Worker submission | Fresh verifier |
|---|---|---|
| low | relevant format/lint/build plus direct deterministic acceptance | inspect the direct result; no automatic cold clone, sabotage, or novel attack |
| medium | affected crates/tests, affected target build, and relevant browser path | acceptance criteria plus one bounded novel attack; cold clone only for portability/deployment claims |
| high | full prescribed gauntlet, threat-model attacks, exact-head evidence, and final cold clone | full charter below, scoped to the claim and changed security boundary |

Broad workspace, cross-target, stress, and compliance suites remain CI/nightly regression walls.
During implementation use the narrowest gate that can falsify the changed behavior, then run the
risk-tier submission once at the frozen head.

### Re-verification is incremental

A verifier records each prediction as `HELD`, `FAILED`, or `NEEDS EVIDENCE`. A later verifier must
carry `HELD` results forward when their code, dependency boundary, and evidence digest are unchanged.
Do not re-litigate them merely because another criterion failed.

`evidence-needed` means the product claim was not contradicted. If the response changes only tests,
fixtures, recording scripts, or evidence, rerun the missing proof and checks for the touched harness;
do not restart unrelated workspace gates. If runtime semantics change, return to `in-progress` and
rerun the gates selected by the task's risk. Run the pristine-clone proof once, on the final exact
head, unless the failure itself was a portability or environment-isolation finding.

## Pull requests: stack by default, merge only on explicit request

Use [`kitlangton/stack`](https://github.com/kitlangton/stack) for stacked-PR maintenance
and merging. Normal progress means continuing the stack: create each new task branch/PR on
top of its parent, then use `stack sync` to preview and `stack sync --apply` to repair
descendants, retarget PRs, and refresh stack metadata as needed.

**Never merge a PR unless the user explicitly asks for a merge in the current request.** A
task being verified, CI being green, an approval, a request to publish/push/open/update a PR,
or instructions to keep working are not merge authorization. Without an explicit merge
request, keep stacking and leave every PR open. Do not enable auto-merge, enqueue a merge,
click a GitHub merge control, call a GitHub merge API, run `gh pr merge`, or merge locally.

When the user explicitly asks to merge, use `stack merge` to preview the exact operation and
`stack merge --apply` to perform it and repair the remaining descendants. Do not substitute
another merge mechanism. If the requested PR is not the root, respect the user's requested
boundary and make the full set of PRs that `stack` will land clear before applying it. Use
`stack merge --auto` only when the user explicitly asks to enable or wait for auto-merge.

## Worker protocol

1. **Pick work.** Top entry of "Next up" in `tasks/QUEUE.md`. Read the whole task file —
   the Adversarial verification section tells you how you'll be attacked; build for it.
2. Set `status: in-progress`, rebuild queue, commit.
3. **Implement.** Select gates from the risk table, in ascending cost. A semantic failure returns
   to the top of that selected set:
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
5. **Record the final happy run.** When satisfied, run the risk-tier submission once
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
| **Host** (the Rust process itself) | the entire emulator process: all threads, syscalls, memory — replayable in gdb with reverse execution | rr / **rr-soft** — see `tools/rr/README.md` | **Linux** — a PMU box or CI runner for mainline rr; the PMU-less `ssh dev` box via **rr-soft** (software counters); *not* macOS |

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

### Proving environments: this Mac, `ssh dev`, and the emulator

Three places work gets proven, in increasing authority. Use the cheapest one that can
actually falsify the claim, then escalate — but the **authoritative** proof for a task's
acceptance is always the one its acceptance criteria name (a recorded emulator boot, a
Playwright run on the built page, a guest trace/digest), never a fast-path pre-check.

- **This Mac (local).** Native Rust tests, guest-layer evidence (instruction traces,
  digests, Spike/QEMU diffs), `make web-build` + Playwright. No rr here — Apple Silicon has
  no virtualizable PMU. Fastest loop for anything that doesn't need a real Linux kernel.

- **`ssh dev` — the fast Linux fast-path.** A small x86_64 Linux box (AWS EC2, sudo root,
  cgroup v2, overlayfs, static busybox) reachable at `ssh dev`. Use it to **iterate
  arch-agnostic guest-side logic that needs real Linux kernel features** — namespaces,
  cgroups, overlayfs, `pivot_root`, seccomp, POSIX-sh tooling like `wvrun` — in **seconds**,
  instead of 15–40-minute interpreted-riscv emulator boots. The pattern: get the logic green
  on `dev` with a throwaway native bundle (see `tools/guest/wvrun-lifecycle-test.sh`), *then*
  confirm the arch-specific behaviour with **one** emulator boot. It is also the box for
  **host-layer rr/rr-soft** (below), since the Mac can't run rr at all.

  What `dev` does **not** prove — do not let a green run there stand in for the real proof:
  - It is **x86_64, not riscv** — it cannot catch riscv codegen/arch bugs, and it cannot
    reproduce the interpreted guest's *timing*. (Real example: a pid-capture loop that spun
    500 subprocesses was instant on `dev` but hung the interpreted guest for minutes — only
    the emulator boot surfaced it.)
  - Its cgroup v2 is **systemd-delegated**, so root-level cgroup joins/placement behave
    differently than the emulator's clean cgroup hierarchy — treat cgroup-placement quirks
    there as environment noise, not guest truth.
  - It's a **pre-check, not evidence.** The Verification log cites the emulator/browser/rr
    proof; `dev` runs are how you got there fast, mentioned but not counted.

- **The emulator (native riscv boot / wasm in the browser).** The authoritative guest
  environment. Slow (interpreted), so reserve it for the confirming run(s) a task's
  acceptance requires — and expect it to catch exactly the arch/timing issues `dev` can't.

### rr-soft on `ssh dev` (host-layer time travel without a PMU)

Mainline rr needs a hardware PMU; `ssh dev` is a cloud VM with **no vPMU** (its
`/sys/bus/event_source/devices` has no `cpu` source), so plain `rr record` can't count
retired instructions there. **rr-soft** — rr with *software* instruction counters — records
and replays on exactly such PMU-less boxes, so the full host-layer killer move is available
on `dev`: `watch -l` the corrupted Rust state + `reverse-continue` lands on the writing line,
and `rr record --chaos` still captures races as replayable recordings. Record the emulator
process on `dev`, `rr pack` the trace (self-contained), and hand it to the verifier to
interrogate the *same execution*. `tools/rr/preflight.sh` detects the missing PMU and points
at rr-soft; see `tools/rr/README.md` for the `dev`/rr-soft setup. This makes `dev` a genuine
**verifier** box, not just a fast worker loop — the two-command "who corrupted this?" answer
works there even though the Mac and a vanilla cloud VM can't.

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

**RUN THE RISK-TIER ATTACKS.** High-risk tasks execute every angle in the task's Adversarial
verification section with independent seeds, invent one bounded attack, and sabotage-check the
new tests once. Medium-risk tasks cover the acceptance criteria and one bounded novel attack.
Low-risk tasks verify the direct result. Never expand a task with an unrelated requirement: file
it as follow-up work instead.

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
