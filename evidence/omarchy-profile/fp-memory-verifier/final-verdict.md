VERDICT: verified

## Scope and provenance

Verified task **E5.5-T03u**, the compiled FP memory-transfer boundary, against
activation `9a963954`, runtime `7048847fb542d66618b836b965b94c8c9db771d5`,
final acceptance/cold head `a593f942a004ee43c1bf5b4c84eeb22522eeeb16`, and
worker submission `f95c9dac59cd489a6e3e0663bcbe15280bd30f8e`.

The fresh verifier read the task and diff before execution evidence, used the
original critic's prewritten P1–P22 predictions, and recorded additional V1–V6
before its new tests. It made no runtime changes. Its only later test repair
kept FS identical across MPRV revocation; final and pristine-clone acceptance
both exercise that corrected fixture.

All 54 worker evidence files rehash against index SHA-256
`1edaa4b1b6d39474962e082ff4255f68b407e5cf55fa52194c28886027e4b822`.
`recordings-audit.json` records the independent source, artifact, capture,
cold-clone, public-byte and unchanged-failure checks.

## Predictions and observed state

All citations below use `../fp-memory-r1/` unless another path is named.

- **P1–P4 — HELD.** Exact raw transfers, FLW boxing, malformed-box stores,
  f0 writes, FS dirty/preserve rules, and unchanged fflags/frm survive 1,472
  worker vectors plus the independent raw-bit corpus. The independent growth
  record writes `f31=ffffffffffa12345`, retains `f0=0123456789abcdef` on either
  fault, and loads `f0=7ff0000000001234` on success. See `acceptance.log:17–38`
  and `acceptance.log:117–124`; source assertions cover all X/F registers.
- **P5–P7 — HELD.** FS Off precedes memory/device access; the run-loop trap
  retains compressed mtval `2002`. Critic maximum-offset parcels
  `3c60/bc60/307e/bf82` preserve their 16-bit identity and correct 248/504-byte
  offsets. Three independent seeds exercise same-index X/F aliases, raw
  interpreter FLD replacement, FSW/FLW/FSD/FLD and an integer move readback.
  See `acceptance.log:17–38`, the recorded private/shared target passes at
  `acceptance.log:131–136`, and the promoted verifier fixture assertions.
- **P8–P11 — HELD.** Each private warm access performs one software
  translation; shared warm FLW/FSW/FLD/FSD perform zero after a genuine cold
  miss (`acceptance.log:74–81`). Eighty noncontiguous virtual crossings cover
  read-only, absent and PMP-denied second fragments, with exact interpreter
  traps and no partial data store. The 32 MMIO/fault cases include FS-Off
  precedence, misalignment and range overflow (`acceptance.log:19–24`).
- **P12 — HELD.** Narrow four-byte PMP grants cannot authorize the adjacent
  word; FP and integer controls fault at virtual PC `40002004`, with tval
  `80004004`, preserving the second destination/data (`acceptance.log:96–109`).
  The independent fixture adds an interior denied range, effective S under
  MPRV, locked M, a partial RAM page, and armed/retargeted data triggers.
  Corrected MPRV tests preserve FS across the transition and pass in all
  three engines (`acceptance.log:28–38,129–136`).
- **P13–P16 — HELD.** Machine run-loop prefixes are 1 and 2 for the directed
  compressed/off and later-load faults. Direct-chain code/atomic barriers
  retire exactly 2 before the successor, while the normal data-store path
  retires 4 (`acceptance.log:17,69–71`). A saturated 128-record log followed
  by its imported fallback commits 129 stores, retires 132, and preserves raw
  `012345677fa12345` (`acceptance.log:88`). Source assertions check reservation
  invalidation, surviving nonoverlapping reservations, code-write pages and
  no replayed MMIO effect.
- **P17–P19 — HELD.** Same- and cross-module successors retire 7 on success,
  3 before the later access fault, and zero when FS is Off
  (`acceptance.log:59–66`). Unchanged T03t handoff identity/version evidence
  carries forward; this task directly exercises new memory sources/writes.
  Actual memory.grow inside one MMIO import retains exact payloads, FS/fcsr
  and virtual fault PCs `40006008`/`40006010`, with shared prefixes 2/4 and
  exactly one device write (`acceptance.log:117–124`).
- **P20 — HELD.** The native record reports raw-bit digest `4a246f55b17039ad`
  for seeds `d42ac871159e630b`, `096af321ca778de5`, and `6b049fa73518dc21`.
  There are 112 native and 224 private/shared critic cases. In an isolated
  scratch crate, one flipped expected payload bit fails the named assertion:
  `sabotage.log:30–32` observes `18446744072205303053` versus
  `18446744072205303052`, exit 101. Runtime hashes remain unchanged; the
  tested seed function is unchanged by the later MPRV-only test repair.
- **P21 — HELD.** Changed emitters use integer raw-bit loads/stores and the
  existing `env.load`/`env.store` authority. No FP-specific permissive import
  or arithmetic implementation was added. The unsupported-arithmetic guard
  passes (`translator.log:21`); the complete selected translator suite passes
  23 tests, including 6,000 inline-TLB coherence iterations. `coverage.md`
  maps every changed hunk to execution or a declarative/packaging waiver.
- **P22 — HELD with explicit limits.** The pristine clone starts clean,
  scrubs the specified environment, rebuilds byte-identical WASM and passes
  all task acceptance commands (`cold/report.json`). Original, final and
  cold browser reports match RAM digest
  `164f86c9b0c09c224f19ee8fda70f0877dbb9a5835bdd43aab99d0f40a08cf4b`,
  exposed register/spill values, 3,617/4,000 JIT retirements, zero errors,
  127/127 ISA tests and live 2/2 capability. Actual captures were inspected
  and rehashed. Eight TLS-verified immutable/production asset reads match
  the tested WASM/glue/roadmap/app (`cloudflare-public.json`).

**V1–V6: all HELD.** The final corrected verifier source matches the source in
the pristine clone; no independent runtime contradiction or uncovered runtime
hunk remains.

## Explicit limits retained

The full `make -k ci` remains red for unchanged macOS seccomp, feature/dead-code,
resume/zicsr-stub fixture, and lexical test-clock failures. These were checked
against unchanged source and remain recorded failures. Focused production
Clippy, memory/runtime/translator/FP ISA checks, no-host-float and acceptance
pass; the local performance floor passes at 25.6 MIPS against 15. Existing
ignored stress campaigns are not counted as executed.

The actual desktop remains **unproven**. Its 128 trusted physical events do
not produce the nonce before the unchanged 120,000 ms deadline. The callback
fails at +1 ms; frames remain 2→2. The verifier inspected the actual failure
capture: Foot still shows the unchanged prompt. T03q remains gated. This
verdict verifies the instruction slice and its honest failed input trial; it
does not establish desktop responsiveness.

## Permanent verification artifacts

Promote the independent native/private/shared fixtures and the memory-growth
fixture already included in `make verify-E5_5-T03u`. Retain the original narrow
PMP regressions. Keep the isolated assertion check and recorded source/artifact
audit as review evidence. No additional runtime change is requested.
