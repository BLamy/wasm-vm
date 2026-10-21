---
id: E9-T20
epic: 9
title: Continue from the past on an isolated recording branch
priority: 524.920
status: verified
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

- [x] Create two continuations from one past position and preserve original future events, files and shared ancestors unchanged.
- [x] Branch writes and new inputs appear only in the selected child; reopen and replay parent and siblings independently.
- [x] An explicit go-live action resets or refuses historical external connections under the documented policy; no automatic reconnection or side-effect replay occurs during seek.

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


### 2026-10-21 — worker — frozen high-risk and pristine-clone submission

Implementation and tested runtime head: `5ee35fb4da5d39b22891004c816568757b771194`. The source checkout
remained clean throughout the direct submission. Both terminal reports record
the same final head and empty final checkout status. This entry and the ensuing
queue change are metadata only; no runtime or fixture bytes changed after the
recorded run.

Commands:

- `E9_BRANCH_EVIDENCE_DIR=target/evidence/e9-t20-frozen-3 make verify-E9-T20`
- `python3 -B tools/verify/e9-branch.py --output target/evidence/e9-t20-cold-final --cold-clone /Users/blamy/Documents/Codex/.e9-t20-final-cold-5ee35fb4`

The direct submission executed 20 commands and passed; report
`target/evidence/e9-t20-frozen-3/report.json`, SHA-256
`b91e297abd06e96ce1d06bc12ed3f87a42b4a1e771af6b2f21b537fd8920e303`. It includes strict production
Clippy, native branches and GPU results (5 + 44 tests), independent native byte
readers, storage publication, no-std/Wasm builds and strict Wasm Clippy, pinned
fixture rebuilds, built demo 127/0, real Linux-file and physical-GPU browser
recordings, independent raw ext2/GPU/disk/network readers, and the full local wall.
The wall report is `target/evidence/e9-t20-frozen-3/gauntlet/report.json`, SHA-256
`11174103818438b13f3ae95d341d62868465a575e42fd5fd2671bcc56225089c`. The initial `make ci`
returned 2 on exactly the five historical quarantined `zicsr-stub` dead-code
diagnostics already recorded at T14/T17; the wrapper preserves that failed log,
records the narrow alternative-feature waiver, reruns its Clippy, and directly
passes every remaining wall target. Production Clippy remains strict. There is
no new warning waiver or reuse of another run's command result.

The pristine no-hardlink clone used fresh target and npm directories and
re-executed all 21 commands. Its terminal report is
`target/evidence/e9-t20-cold-final/report.json`, SHA-256
`2fed52fdb772e732f82cd57f9c04bd1eececaa1ee2a77968b065fd06a2376fc5`. Built runtime bytes match the
committed deployable bundle, including Wasm SHA-256
`d2bb362758e060f40351e57c7e52fa42b917a64017cdc2615d7f20d60a06bc2d`
and GPU runtime graph
`fcf596828ffe68ed1930e34413573627cad563f084c5ebd35eb5e870f727005d`.
Each report catalogs its executed source and retained evidence digests. The cold
proof was run once on the final executing runtime.

Claim: actual Linux ext2 resumes contain literal `/state` bytes `past`, `P`, `A`
and `B`; the independently decoded source and replayed parent match byte for
byte. Two children preserve the parent's original future and private file/input
state through reload, varying reopen/deletion order, save and discard. The
separate original-MMIO GPU guest performs real physical green/red/blue/green
work, private COW writes and witnessed Ethernet intents. Only the source opens
one connection and sends `S,P`; children retain their `A/B` output offline.
There is no new connection, send or hidden Wasm fetch during continuation.
This is physical-GPU boundary proof, not a Linux/Mesa desktop or T22 performance
claim. Browser traces, screenshots, raw resumes, original saved CAS objects,
external-counter frames and independent byte-reader results are retained under
the `software/`, `gpu/` and `native/` directories in both submissions.

The GPU browser's eleven bounded attacks exercise Promise/thenable publication
guards, missing retained Wasm, duplicate identity, foreign build, actual context
loss, journal retry, paint failures during advance and finish, final-transaction
cancellation, and cancellation after a real new owner's initial manifest.
The software browser also attacks the real Wasm ABI's malformed/shared queues
and atomic profile admission, pre-final cancellation and post-durable completion.

Fresh actual Daybreak adversarial work is separately retained under
`target/evidence/e9-t20-daybreak-fresh-adversarial/` (report SHA-256
`890d1603268ea60a78b15bc675ccf750808b74224a737ed1094e52b8e5db2932`;
routing in `target/evidence/e9-t20-daybreak-adversarial-stage/routing.json`).
Its independently predicted P1-P6/P8-P9 held, including literal network buffers,
complete source CAS authentication, a novel physical-GPU caller-buffer mutation
attack and a killed offline-policy test mutant. P7 awaited only the wall's
terminal result, now present. This is supporting critique, not the final verdict.
The independent final Daybreak session must inspect the actual diff, commands,
reports and hashes before deciding status.

Failed development and frozen attempts remain preserved. Frozen-1 failed the
redundant Wasm identity conversion lint; its repair leaves built Wasm unchanged.
Frozen-2 was intentionally stopped before the wall and is not a passing high-risk
submission. Daybreak rejected a prototype evidence-carry mechanism; it was removed
in this frozen head, and every current command executed directly. No carry flag,
result substitution, SSH/rr dependency, GitHub Actions, merge or deployment is
part of this submission. Host rr is waived by repository policy. Publication
status alignment and deployment to the actual main URL follow independent
verification; they are not claimed here.

### 2026-10-21 — final Daybreak verifier

VERDICT: verified

- P1-P6/P8-P9 — **HELD (carried)**. The frozen runtime/dependency boundary is
  unchanged from the completed fresh Daybreak stage. Its report
  `target/evidence/e9-t20-daybreak-fresh-adversarial/report.md` hashes to
  `890d1603268ea60a78b15bc675ccf750808b74224a737ed1094e52b8e5db2932`;
  every entry in its artifact catalogue rehashed successfully. Routing receipt
  `target/evidence/e9-t20-daybreak-adversarial-stage/routing.json` hashes to
  `4dffc31d830152adf69558e5a14878c83fd6804d68b4ac5d15e28c1374b56030`
  and records terminal `gpt-daybreak-blue-latest` / `daybreakBlue` execution.
- P7 direct high submission — **HELD**. Predicted terminal pass at frozen head
  `5ee35fb4da5d39b22891004c816568757b771194`; observed `status: passed`,
  identical `head`/`finalHead`, empty final checkout status, and 20/20 direct
  command exits zero. Report `target/evidence/e9-t20-frozen-3/report.json`
  SHA-256 `b91e297abd06e96ce1d06bc12ed3f87a42b4a1e771af6b2f21b537fd8920e303`.
- P7 wall — **HELD**. Report
  `target/evidence/e9-t20-frozen-3/gauntlet/report.json` SHA-256
  `11174103818438b13f3ae95d341d62868465a575e42fd5fd2671bcc56225089c`
  is terminal passed at the frozen head. The initial strict `make ci` log contains
  exactly the five quarantined `zicsr-stub` dead-code errors and no sixth strict
  error. Only that alternative library rerun receives `-A dead_code`; it and the
  remaining complete wall exit zero. Direct production core/Wasm Clippy remains
  `-D warnings`; there is no broader warning waiver.
- P7 pristine submission — **HELD**. Predicted fresh no-hardlink rebuild;
  observed `status: passed`, identical frozen `head`/`finalHead`, empty final
  checkout status, and 21/21 direct command exits zero. Report
  `target/evidence/e9-t20-cold-final/report.json` SHA-256
  `2fed52fdb772e732f82cd57f9c04bd1eececaa1ee2a77968b065fd06a2376fc5`.
  All 736 direct and 733 cold retained-file entries, the three wall files, and
  both 92-file frozen source catalogues rehashed with zero mismatch. Executed
  Wasm is `d2bb362758e060f40351e57c7e52fa42b917a64017cdc2615d7f20d60a06bc2d`;
  GPU graph is `fcf596828ffe68ed1930e34413573627cad563f084c5ebd35eb5e870f727005d`.
- Acceptance — **HELD**. Independent ext2 reconstruction reads literal `past\n`,
  `P\n`, `A\n`, `B\n`, with byte-identical source/replayed parent state and
  independently reopenable siblings after deletion. Core source points are
  `crates/core/src/lib.rs:3319` (capture readiness) and `:3368` (fresh-owner
  restore). Raw A/B network intents remain private at resume offsets 28161/28162
  with literal `E9_BRANCH_COUNTER_A/B`; only S/P reach the external counter.
  Offline authority rotation/refusal is at `crates/core/src/session_network.rs:276`,
  `:318`, `:375`, and `:407`. Physical GPU evidence holds green/red/blue/green,
  private sector-8 COW, all eleven fault attacks, no reconnect/send/fetch leak,
  and parent/sibling/reload/deletion independence.
- COVERAGE — **SUFFICIENT**. Executed: core/clock/network/GPU projection and
  ownership, Wasm ABI, software ext2/COW/queues, GPU worker/controller and paint
  ordering, retained assets, synchronous publication, cancellation, fixtures and
  direct runner. Generated browser/Wasm mirrors are digest-bound; demo/roadmap
  declarations are executed/declarative-waived; the unchanged quiet-point
  `prepared` GPU serialization branch retains its prior call-graph waiver;
  documentation/metadata/logging/whitespace are waived. No task-semantic hunk is
  unexecuted or dead.
- SUITE — **PROMOTED**. `tools/verify/e9-branch-input-ownership.mjs` (SHA-256
  `85740112d6d2d9e9f4efe6f0c0e44176a6855e1cab93accc95d504cfc20ecbb3`)
  is integrated after physical GPU proof in `tools/verify/e9-branch.py`. With
  separate fresh Chrome profiles it passed against retained direct and cold GPU
  stores: reports SHA-256 `69d85da24fd606357a98437786dee573f275fe6c0a81fec14047dea42da5fe4f`
  and `2c76fb09b1b240df6ad8560492c0d0d0875132e103bf132555658df2ce1fe2db`.
  Each authenticates 50 chunks/48 objects, mutates caller A→B after queued input,
  observes guest A plus blue physical pixels, leaves parent/counters unchanged,
  refuses go-live, and deletes the candidate. Harness syntax checks pass; the
  unchanged runtime/cold results are preserved under incremental policy.

Final evidence: `target/evidence/e9-t20-daybreak-final/report.md`, SHA-256
`d759774bc098df054d4359ebb8af8b1dc8caa360969a689891f4dada8b8e6074`.
Commands: read-only diff/source/report/catalogue inspection; catalogue rehash;
`node --check tools/verify/e9-branch-input-ownership.mjs`;
`python3 -B tools/verify/e9-branch.py --help`; the promoted test against
`target/evidence/e9-t20-frozen-3/gpu` and `target/evidence/e9-t20-cold-final/gpu`.
No broad wall or cold clone was repeated.
