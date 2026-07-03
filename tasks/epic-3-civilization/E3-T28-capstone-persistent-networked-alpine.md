---
id: E3-T28
epic: 3
title: "Capstone: a real userland — busybox + QuickJS + interpreted Node.js on a persistent, networked Alpine (webvm parity)"
priority: 328
status: pending
depends_on: [E3-T11, E3-T18, E3-T25, E3-T26, E3-T27]
estimate: L
capstone: true
---

## Goal
The Level 3 threshold — a **real userland** — demonstrated end-to-end from a cold start:
load the page in a fresh browser profile, drop into an interactive **busybox** shell,
`apk add nodejs quickjs` against a real Alpine mirror through our network stack, run a
**QuickJS** program (`qjs`) and a **Node.js** script (interpreted — slow is fine; this
proves the userland ABI, not speed), write a file in the guest, reload the tab, and the
runtimes and the file are still there and still run — the whole flow comparable to
webvm.io/alpine.html. Node is the ABI stress test: futex, large `mmap`, W^X page flips, TLS,
signals all get exercised, so a running interpreted Node is the proof the userland is
correct. This is the epic's exit gate and the project's first release with standalone
product value; Level 4 only has to make this *fast*.

## Context
Everything in Epic 3 converges here; the capstone adds no new subsystems — it is the
integration proof plus whatever glue fixes the full flow exposes. Per `tasks/README.md`, a
capstone demo runs from a cold start: fresh clone, `./build.sh` artifacts (T11), `docker
compose up` for relay + serving (T19), fresh browser profile — no development state. The
demo procedure (written + automated headless variant) is itself a deliverable so the
adversarial verifier can execute it without the implementer present. "Comparable to webvm"
is bounded by T27's recorded go/no-go tolerances — cite them, don't re-litigate them.

## Deliverables
- `docs/capstone-e3.md`: the exact cold-start procedure — clean checkout, build, deploy,
  browser steps, expected outputs at each step, and the T27 tolerance citations.
- Automated headless E2E (`tests/e2e/capstone_e3.*`) executing: cold boot → busybox shell →
  `apk update` → `apk add nodejs quickjs` → `cat > /root/hello.js` (heredoc writing a script
  that prints a computed value, e.g. `console.log([...Array(100).keys()].reduce((a,b)=>a+b))`)
  → `qjs /root/hello.js` asserted → `node /root/hello.js` asserted → `sync` → tab close →
  new tab, same profile → `node /root/hello.js` asserted again → `ls /root/hello.js`
  timestamp intact.
- Glue fixes discovered during integration, each with a regression test in its home task's
  area.
- Screen recording of the human-paced demo linked from the README.

## Acceptance criteria
- [ ] The automated E2E passes from a clean checkout on CI-equivalent settings: both `qjs`
      and `node` print `4950`, and the `node` output `4950` appears both before and after
      the reload, with zero manual intervention between page load and assertions.
- [ ] Interpreted Node.js actually executes a non-trivial script (e.g. a small `http`
      one-liner or a JSON round-trip) without crashing — proving the userland ABI (futex,
      mmap, W^X, signals) is correct; slow wall-clock is explicitly acceptable at this level.
- [ ] Cold-load to usable prompt and reload-to-usable-prompt times are within the T27
      go/no-go tolerances (numbers recorded in the log alongside the T27 baselines).
- [ ] The reload boots via the fast path (T24 resume or warm cold-boot per design) and
      node runs without `apk fix` or any repair step — the install was durable per T08
      semantics (`sync` honored).
- [ ] The full flow runs with CSP enforced, cross-origin isolation on (T26), and the
      relay requiring auth (T19) — no dev-mode relaxations (asserted by the E2E checking
      `crossOriginIsolated` and header presence).
- [ ] The demo also passes on a second browser engine (Firefox or Safari), or the log
      records the specific gap and it is dispositioned in `docs/parity/gaps.md`.

## Adversarial verification
Execute `docs/capstone-e3.md` yourself on a machine the implementer never touched — fresh
clone, fresh browser profile; any undocumented step you must improvise refutes. Then attack
the claim's edges: run the flow but kill the tab 2 seconds after `apk add python3` returns
(before typing `sync`) — on reload, the system must be consistent (python3 fully present or
cleanly absent; a half-installed apk database refutes durability). Run it in two tabs —
the second must be read-only (T09), and the demo must still pass in the first. Fill storage
to near-quota before starting — either the flow completes or T10's dialog appears; silent
failure refutes. Disconnect the network after the install, reload — the script must still
run offline (T24). Repeat the automated E2E 5 times on one profile — any flake refutes.
Finally, sit a human in front of both this and webvm.io/alpine.html for ten minutes each;
blunt notes contradicting "comparable experience" beyond T27's tolerances refute — file the
gaps.

## Verification log
(empty)
