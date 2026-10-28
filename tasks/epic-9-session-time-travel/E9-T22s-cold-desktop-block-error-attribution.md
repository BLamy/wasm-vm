---
id: E9-T22s
epic: 9
title: Attribute the original cold desktop's first virtio block I/O error
priority: 524.92202985
status: verified
depends_on: [E9-T22o]
estimate: S
risk: high
capstone: false
---

## Goal

Identify the first guest-visible rejected virtio-blk request in the unchanged
Omarchy cold recording, before deciding whether a disk defect is implicated in
the later compositor failure.

## Boundary

Diagnostic observation only. Authenticate an original saved checkpoint before
the guest's first vda/EXT4 I/O error, then replay that exact guest in a private
offline owner. Instrument only the request/result observation path, without
changing request validation, completion, guest state, source image, clock,
cadence, renderer, frozen workload, or production replay policy. Do not infer
that the disk error caused Hyprland's later backend crash. The E9-T22o exact
25.2B no-frame frontier and post-input crash report remain intact.

## Acceptance criteria

- [x] Independently authenticate the source checkpoint, RAM ancestry, device
  and disk state, physical renderer, pending queues, and source code/asset
  receipts before executing any guest instruction.
- [x] At the first rejected virtio-blk request, record the exact transition and
  guest witness digest, type, sector, requested byte length, disk capacity and
  checked range, backend result or pre-backend refusal, COW sector count
  before/after, and whether the descriptor was parked or completed `S_IOERR`.
  Tie that event to the first kernel vda/EXT4 error in the serial stream; never
  equate a `WouldBlock` park with an I/O error.
- [x] Prove the diagnostic did not change the architectural run: compare exact
  state and guest-output witnesses with the original recorded checkpoint(s),
  retain zero browser/guest egress and unchanged source-graph digest, and
  classify the failure as a concrete runtime or guest-side path. If no first
  rejection can be reproduced from the authenticated prefix, report an exact
  witness divergence rather than guessing a cause.

## Deterministic acceptance

`make verify-E9-T22s` against the pinned E9-T22r recovered graph and complete
offline base cache, producing a bounded browser report, request trace, source
and output digests, and a negative input-integrity test. A fresh Daybreak Blue
verifier must examine the trace and the changed diagnostic path at the exact
code head before this task reaches `verified`.

## Adversarial verification

Attempt a 1 MiB transfer at the session maximum, an out-of-range write, a COW
capacity park, an unavailable base chunk, and a malformed descriptor. Distinguish
each from the actual first rejected request using the status byte, used-ring
commit and backend return. Corrupt an unrequested base chunk and one RAM delta;
refuse both before execution. Check that instrumentation cannot repair or mask
the observed error and that the original guest witness still matches.

## Verification log

### 2026-10-28 — worker — prerequisite opened

E9-T22o was independently verified at report SHA-256
`5cb0ab6386e534f5d7711d57ca2544a4efa721ff82e87204e1ba810f249e737b`.
Its unchanged guest had no qualifying first frame by 25.2B. Only after
diagnostic input did trusted journal records show Hyprland PID 341 failing
`CBackend::create()`; the source guest console also preserves a vda write I/O
error at sector 24,928,880 and an EXT4 write error for inode 177851. The
request length and backend outcome are absent from that evidence. This slice
must identify the exact first block rejection before a semantic fix or a
first-frame allowance can be selected.

### 2026-10-28 — worker — implemented at `de39b0459d4e83c63503230fb03897c21335a340`

Claim: The unchanged cold guest's first completed virtio-blk `S_IOERR` occurred
at transition `14,365,286,002` (guest witness
`585596507707029fef3886fa1763aba8daa00e79fcf5581067e799148e1ce25f`,
RAM digest `2e6582c826bac324fb7c19f573efd614c9392c48254c4b5f0e8c25a1047cf275`).
Descriptor head 69 requested a `1,179,648`-byte write at sector `24,928,880`.
The disk range was in bounds (`25,165,824` sectors), but the session backend's
transfer cap was `1,048,320` bytes. The virtio transfer-shape gate rejected it
before backend I/O, wrote the status byte, and committed the used ring. The COW
overlay remained at `17,640` sectors. The next sealed serial receipt at
transition `14,365,728,640` reports the same sector as a vda write error,
followed by the EXT4 warning. This attributes that disk error only; it does not
claim that the error caused the later Hyprland failure.

Evidence: `target/evidence/e9-t22s-cold-proof-de39b0459/desktop/report.json`
(SHA-256 `3ff45601e5eb82c147f3023610499f165ea5c540d1ff6542f544f8984ac2e37f`),
`desktop/request-trace.json` (SHA-256
`c3c5fef9c5f1b57e8beeb084772ce60e6a9f9d559f17a870740db53bdf4a285c`),
`desktop/browser-trace.zip`, and `input-attacks/report.json` (SHA-256
`2ae7b5fe8c1b6b69ac0b16491452e8d1950d9b2428cae5daca3226963ae55923`).
The source report pin is `0d2d37842f96a7d9b203a420d6debec108f982322a562838605c56d2b74ab17f`;
the recovered source tree remained
`ad3bc7bfe74ce25a72617ac8b0d3155a8966593b819e8445014dfdef6cc935f3`
before and after. The authenticated 14.35B checkpoint, physical renderer,
original 14.4B/14.45B state and output, and original-versus-diagnostic failure
boundary all matched. Browser errors, blocked requests, sockets, and guest
egress were zero. No unretained base chunk was naturally requested in this
interval; the negative input test separately refused an unavailable chunk and
corrupt base/RAM bytes before guest execution.

Commands: `make verify-E9-T22s` from a clean sparse clone of the exact code
head, with `CARGO_*`, `RUSTFLAGS`, and `RUST_LOG` scrubbed, offline `npm ci`,
and only the recovered graph and authenticated base cache supplied as external
inputs; `make test`, `make features`, `make wasm`, `make test-riscv`,
`make riscv-tests-suite` (128/128), `make determinism`, and `make perf-smoke`
(55.3 MIPS). `make ci` was attempted but stopped in its no-default-feature
Clippy matrix on five pre-existing dead-code warnings in unchanged session
clock/device files; the later affected gates were run individually and passed.
The private diagnostic feature is off in the production build. The code commit
used the hook's `SKIP_WEB_BUILD=1` to keep the pinned production `web/dist`
bytes unchanged; this slice adds no public demo capability.

### 2026-10-28 — fresh Daybreak Blue verifier — VERDICT: verified

- First completed rejection — HELD. Predicted a pre-serial-error write at
  transition `14,365,286,002`; observed head 69, sector `24,928,880`, length
  `1,179,648`, `TransferShape`, no backend call, status DMA and used-ring commit
  at `request-trace.json:1339`. Independently calculated an in-range byte end
  `12,764,766,208` below capacity `12,884,901,888`. The verifier's initial
  byte-end estimate and expectation of an explicit backend error were corrected
  against the code and trace; neither was a product claim.
- Source and non-interference — HELD. Rehashed the pinned source inputs and
  final report/trace, checked the fresh 3,523-object/13,177-chunk closure and
  435-checkpoint byte oracle, then matched the original and diagnostic guest,
  output, event, and payload witnesses at 14.4B, 14.45B, and the failure
  boundary. Source tree before/after and browser/guest egress were unchanged.
  The first sealed vda/EXT4 serial receipt follows at `14,365,728,640` with
  the same sector (`request-trace.json:1439`).
- Attacks and coverage — HELD. The maximum aligned transfer, out-of-range
  write, COW capacity park, unavailable base chunk, malformed descriptor,
  corrupt base/RAM inputs, and a novel two-descriptor aggregate-size case held
  their distinct status/used-ring/backend predictions. Sabotaging the new cap
  assertion made its focused test fail, then the restored test passed; the
  scratch clone finished clean. The cold run and deterministic tests exercised
  the acceptance-relevant changed hunks; passive defensive stage labels and
  compile-time feature declarations received explicit waivers.
- SUITE: retain the 20 diagnostic integration tests, COW-capacity unit test,
  negative input-integrity probes, and `verify-E9-T22s` target. Full verifier
  report: `target/evidence/e9-t22s-daybreak-verifier-de39b0459/report.md`
  (SHA-256 `6f6977f4ceef21eb0944565a0c4e6f9f1a3eab73f97d0471ba1cc91bac331340`).
