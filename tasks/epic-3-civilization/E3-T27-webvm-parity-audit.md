---
id: E3-T27
epic: 3
title: Side-by-side parity audit against webvm.io/alpine.html
priority: 327
status: pending
depends_on: [E3-T09, E3-T20, E3-T21, E3-T22, E3-T23]
estimate: M
capstone: false
---

## Goal
An evidence-based, feature-by-feature and feel-by-feel comparison of wasm-vm against
webvm.io/alpine.html, producing (1) a scored parity checklist with measurements, (2) a
ranked gap list with each gap dispositioned (fix-now in this epic, Epic 4 speed, Epic 5
GUI, wontfix-with-reason), and (3) the go/no-go input for attempting the T28 capstone.

## Context
"Parity" claims die without measurement. Build the checklist first, then measure both
systems the same way, same machine, same network, same day. Dimensions: cold-load
time-to-prompt and reload time-to-prompt (stopwatch from navigation to usable shell, 3
runs each); interactive feel (keystroke echo latency measured via a scripted
input-to-render probe, scroll performance in `less`); persistence (file survives reload —
both systems); networking (`apk add`/package install wall-clock, `curl https://` success,
DNS latency); terminal fidelity (resize, colors, `htop`, `vim`); clipboard both directions;
file transfer both directions; multi-tab behavior; offline behavior; failure comportment
(kill network mid-download on both). Also audit the intangibles that make webvm feel
finished: favicon, page title, load animation, error pages — list them. Where webvm wins,
quantify by how much; where we win (likely: open source, RISC-V cleanliness, offline mode),
record that too. Note interpreter-speed gaps explicitly as Epic 4 fodder rather than
letting them contaminate Epic 3 dispositions.

## Deliverables
- `docs/parity/checklist.md`: the dimension list with per-item measurement procedure
  (written before measuring).
- `docs/parity/results.md`: filled matrix — ours vs. webvm, numbers + screenshots/
  recordings for contested items, environment details (machine, browser, network).
- `docs/parity/gaps.md`: ranked gap list, each with severity, disposition, and (for
  fix-now items) a filed task file or an explicit addition to an existing task's scope.
- Any fix-now gaps that are trivial (<1 h each, e.g. favicon/title/polish nits) fixed
  directly in this task; larger ones become `E3-T{nn}a`-style follow-ups per the split
  convention in `tasks/README.md`.

## Acceptance criteria
- [ ] Checklist covers every dimension named in Context, each with a written measurement
      procedure that a third party could re-run.
- [ ] Results matrix has real measured values (no "similar", no blanks) for both systems
      on ≥ 90% of items; exceptions carry a reason (e.g., webvm feature unobservable).
- [ ] Every gap has exactly one disposition, and no fix-now gap is left both unfixed and
      untasked.
- [ ] Boot-time and keystroke-latency comparisons are within the documented tolerance for
      the capstone's "comparable experience" bar, or the gap doc explains precisely why
      T28 should still proceed (this line is the go/no-go record).
- [ ] The trivial-polish fixes landed and are visible (favicon/title/etc. — enumerated in
      the results doc).

## Adversarial verification
Re-run the audit's own procedures blind: pick 5 random checklist items and reproduce the
measurements — a result off by more than the doc's stated variance refutes that row, and
two refuted rows refute the audit. Hunt for flattering methodology: different network
conditions between the two systems' runs, warm caches for ours vs. cold for webvm's,
measuring webvm on a throttled connection — any asymmetry refutes. Check the gap list for
scope-laundering: a user-visible Level-3 feature webvm has (per its own public page) that
appears nowhere in checklist or gaps refutes completeness — spend 30 minutes free-exploring
webvm.io/alpine.html specifically hunting features the checklist missed. Verify the go/no-go
line is supported by the numbers cited, not adjacent to them.

## Verification log
(empty)
