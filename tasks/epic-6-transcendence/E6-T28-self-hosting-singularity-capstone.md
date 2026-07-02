---
id: E6-T28
epic: 6
title: CAPSTONE — the self-hosting singularity, wasm-vm boots wasm-vm inside wasm-vm
priority: 628
status: pending
depends_on: [E6-T19, E6-T24, E6-T25]
estimate: L
capstone: true
---

## Goal
The Level 6 threshold, end-to-end in one sitting: inside the browser-hosted guest, clone
this repository, build the core crate, produce the wasm artifact, serve it from a guest
HTTP server, and boot a *child* VM in an iframe from that artifact — with a
recursion-depth guard and a scripted, timestamped demo a stranger can reproduce.

## Context
Every dependency is staged — the vendored-toolchain dev image (E6-T22), in-guest native
build and budgets (E6-T23), in-guest wasm32 + wasm-bindgen artifact (E6-T24), SW
port-forward with sandboxed delivery (E6-T25), SDK iframe mode (E6-T19) — this task
composes them. The guest httpd root gets `pkg/` (the guest-built artifact), the SDK
runner + loader, and a prebuilt child kernel + minimal disk image shipped in the dev
image (we self-host the *VM*, not Alpine). Child config: 128 MiB RAM, 1 hart,
interpreter-only — the sandboxed iframe has no crossOriginIsolation; expected, noted in
the script. Decide and document `.wasm` MIME on the guest server vs the SDK arraybuffer
fallback. Recursion guard: the runner takes `wvm.depth`, children get depth+1, the SDK
refuses depth > 2 with a named error; grandchild optional but glorious, behind an
explicit flag. The demo runs cold per task-system rules: fresh profile, real network.

## Deliverables
- `docs/singularity.md`: the full demo script — every command with expected output, a
  checkpoint timestamp table (boot, clone, builds, serve, child login), total wall-clock.
- Guest-side `singularity.sh` in the dev image automating the in-guest steps with
  checkpoint logging (each step also runnable manually per the doc).
- Host UI affordance: "boot forwarded artifact as child VM" — one action opening the
  sandboxed iframe via `vm.openForwarded()` + SDK, wired with the depth parameter.
- Recursion-depth guard in the SDK runner with tests (depth 0, 1, 2, 3-refusal).
- The recorded demo (asciinema/video) + the checkpoint log from a verified cold run,
  linked from the README — the roadmap's closing artifact.

## Acceptance criteria
- [ ] Cold start to child login in one session: fresh browser profile → boot dev image
      → `git clone --depth 1` of the public remote over the guest network → in-guest
      core build → wasm32 + wasm-bindgen `pkg/` → guest `httpd` → child VM iframe boots
      that artifact to an Alpine login prompt → a command typed into the *child* echoes
      correctly. Total ≤ 6 h wall clock on the documented host.
- [ ] The child demonstrably runs the guest-built artifact: the served `pkg/*.wasm` hash
      logged guest-side matches what the child iframe fetched (SW/network log) — no
      accidental fallback to a host-served build.
- [ ] The parent survives the child: terminal responsive during and after child boot;
      closing the child iframe releases its workers and memory (measured before/after).
- [ ] Depth guard: a grandchild launch without the explicit flag fails at depth 2→3
      with the documented error; with the flag it is permitted (outcome recorded).
- [ ] `singularity.sh` checkpoint log from the verified run committed with the demo
      recording; every checkpoint within 25% of the documented budget.

## Adversarial verification
This is the epic's cold-start gate: the verifier — never the implementer — performs the
entire run on different hardware and a fresh browser profile, following only
`docs/singularity.md`; any missing step, undocumented dependency, or budget overrun
> 25% refutes. Attack provenance hardest: before the run, patch a visible in-guest
string (the child runner's banner) and rebuild — a child booting without it is running a
smuggled prebuilt artifact, refuting the whole claim. Verify the child's wasm hash
differs from the CI artifact (no wasm-opt in-guest guarantees it; identical hashes mean
the wrong file was served) while `validate-artifact.sh` passes on the served bytes.
Attack the seams: reload the parent tab between build and serve (the overlay must
preserve the built tree); kill the Service Worker while the child fetches; launch a
second child from the same serve — exhaustion killing the parent refutes. Finally
attempt depth-3 without the flag; the refusal must name the guard.

## Verification log
(empty)
