---
id: E9-T20
epic: 9
title: Continue from the past on an isolated recording branch
priority: 524.920
status: in-progress
depends_on: [E9-T19, E9-T04, E9-T14]
estimate: S
risk: high
capstone: false
---

## Goal

Let a user resume from a past position while preserving the original session and its future.

## Boundary

Branch creation with a new session/log identity and private writable disk root. Network access stays offline until a deliberate go-live transition establishes fresh connections; never retransmit recorded actions as a side effect of branching.

## Acceptance criteria

- [ ] Create two continuations from one past position and preserve original future events, files and shared ancestors unchanged.
- [ ] Branch writes and new inputs appear only in the selected child; reopen and replay parent and siblings independently.
- [ ] An explicit go-live action resets or refuses historical external connections under the documented policy; no automatic reconnection or side-effect replay occurs during seek.

## Deterministic acceptance

`make verify-E9-T20` records the assertions above and the high-risk submission at
a clean frozen head. `tools/verify/e9-branch.py --output OUTPUT --cold-clone CLONE`
records the same acceptance from a pristine checkout and fresh build directory.
A command existing is not a passing result; the Verification log binds each run
to its exact revision and artifact digests.

## Adversarial verification

Write the same file differently in parent and two children, then delete/reopen in varying order. Use an external counter to detect unintended reconnects or duplicate state-changing sends.

## Verification log

### 2026-10-21 — worker — begin isolated continuations

Selected the first eligible task after independently verified GPU result replay
(`c7106fca3`) and its main-site publication (`72de0392`). The separately reviewed
AI Sandboxing article is committed in `d906133f9`, PR600, and published on the main
site as `690be437`; it changes no admitted runtime bytes.

Risk remains high. Each continuation will use a fresh recording owner, new
session/log identity and private writable COW state. The selected parent stays a
sealed replay; historical connections remain offline, with an explicit go-live
refusal policy rather than automatic retransmission. Required runtime assets
must come from authenticated local history when branching. Implementation and
proof must preserve parent futures, two independent children, real guest files,
inputs, reload/deletion order and callback ownership. Admitted software and exact
GPU histories need the corresponding ownership path; older paced GPU histories
retain their checkpoint-only policy. No implementation or verification result is
claimed at activation.

### 2026-10-21 — worker — implementation and development attacks

Continuations now have fresh recording identities, private native/COW state,
owned input/output queues, retained local assets, and independent software/GPU
execution owners. Parent future events are excluded from the child. The explicit
go-live policy refuses historical connections; the constructor-owned offline
flag also rejects new live provider leases and completion callbacks. Saved child
histories carry provenance and their own complete referenced objects, so deletion
of a relative does not remove their required data. The UI exposes create, input,
run, pause, save, discard and the explicit go-live refusal. A pinned second Linux
profile supplies an actual ext2 file example; the separate original MMIO GPU
fixture performs new physical GPU work, COW writes and guest network intents.

Development proof is preserved under `target/evidence/e9-t20-development/`.
`linux-browser-7` and its independent byte reader demonstrated real `/state`
contents `past`, `P`, `A`, and `B`, byte-identical source/replayed parent native
states, reload, varying reopen/deletion order, and both sides of the final
publication cancellation boundary. `gpu-two-wave-5` and its independent byte
reader demonstrated green/red/blue/green guest readback, private sector writes,
two child state digests, only the source's `S,P` external sends, retained-Wasm
startup with the Wasm URL denied, retry after a journal failure, paint failure
before final publication, final-publication cancellation, and cancellation before
creation starts. The critic identified that the last test never reached a new
worker. The frozen harness now waits for a fresh worker's real initial manifest
before cancelling and checks that the prepared child is removed.

Two independent critics reviewed development work. The existing critic's reports
are under `target/evidence/e9-t20-verifier/`. The requested Daybreak subagent used
`gpt-daybreak-blue-latest` through an ephemeral read-only local app-server child
with `cyberAccessProgram: daybreakBlue`; its completed routing receipt and report
are under `target/evidence/e9-t20-daybreak/` (report SHA-256
`a01c4293a93f0821c7064532a153fb79d70e72588fda27d4573c4f4069332e3b`).
Neither review is a final task verdict.

Findings repaired before freezing include the final transaction's synchronous
authorizer, physical-frame handling after journal faults, retained-Wasm GPU
worker startup, and Daybreak's final paint/publication ordering finding. Real
Linux replay exposed a host GPU ring-cache representation difference at section
12 byte 282, despite otherwise identical machine bytes. Exact software snapshots
now canonicalize only validated ready empty rings; a native regression covers
both ready and unready rings and the actual Linux parent now matches byte for
byte. An actual Wasm ABI attack also exposed that constructing a Uint8Array copy
before inspecting its buffer hid shared-memory input. Queue admission now checks
the caller's original view before copying. Failed development runs are retained;
the frozen high-risk and cold-clone proofs and final independent verdict remain
required.
