# E6-T12e3b independent pre-evidence predictions

Recorded 2026-10-03 by `/root/constant_transport_verifier`, before reading the
implementation diff or worker run outputs. The task was activated at
`1c989ac9ada7f4050a0a61c5d23318f6a7d72f94`; the prior runtime read for orientation
was `5af5600c33c69e926c96a3dc82369c31da391565`. Inputs read were AGENTS.md, the
activated task, the read-only design, and prior decoder/state source. These are
predictions, not findings. Their eventual results must cite concrete evidence.

## Wire boundary and snapshots

- **P01 — Maximum literal upload.** A little-endian opcode-12 packet beginning
  with `0x00ba000c`, followed by stage 0 or 1, slot 0, and exactly 184 finite
  float32-bit words is 748 bytes and decodes to precisely those 184 u32 words.
  Distinct sentinel words at vec4 indices 0, 7, 8, 44, and 45 remain distinct.
  Mutating the packet after decode cannot change either decoded words or later
  stored state. The old 32-word upload still succeeds.
- **P02 — Neighbor rejection.** The 764-byte, 188-word packet beginning with
  `0x00be000c` fails with `limit-exceeded`. A 183-word packet fails with
  `payload-length`; active stage 2 and active slot 1 fail, as do out-of-range
  stages/slots. Empty resets retain their documented wider stage/slot domain.
  NaN and infinities fail; finite signed zero and subnormal words remain accepted
  with their original raw bits. No parser boundary admits constant 46.
- **P03 — Whole-submission validation.** A valid state-changing prefix followed
  by an invalid constant packet or truncated tail reports zero applied commands,
  leaves inspected state/budgets unchanged, and emits no GL mutation or draw.
  Conversely, a transport-valid 180-word upload followed by a draw that requires
  184 words preserves the valid prefix and reports its actual applied count;
  there is no false claim that semantic failure rolls back earlier commands.
- **P04 — Bounded storage.** A stored stage contains at most 184 guest words.
  Sixteen total subcontexts and two stages imply at most 23,552 logical payload
  bytes, excluding JavaScript representation overhead. A restore call supplies
  at most 736 bytes per active stage and 1,472 for both. Existing submission,
  object, shader, and system-UBO quotas do not increase.

## Reflection: declaration, driver storage, and legal upload

- **P05 — Preserved declaration identity.** Native and Wasm translation of every
  exact hardware shader agree in full, not only `ok`. The compiler metadata
  `count` continues to mean declaration extent. Ascending CONST0..45 gives 46;
  the chosen disjoint declaration-order fixture retains its observed declared
  47. The frontend/profile/vendor and original 12 accepted / 7 rejected corpus
  remain unchanged. No source liveness claim is inferred from this metadata.
- **P06 — Actual reflection.** For a successfully linked active uvec4 array,
  inspection records the true driver size as `activeCount`, and records
  `uploadCount = min(activeCount, 46)`. The active size is a positive integer no
  greater than the declared count, with actual `UNSIGNED_INT_VEC4` type and a
  coherent location/index pair. Retained size 47 is legal only with a sufficient
  declaration; it produces 46 uploaded/required vec4s, not 47.
- **P07 — Shorter and inactive arrays.** Actual shorter reflection, if produced
  by the host, requires/uploads only its legal reflected prefix. A declared-46
  shader reading only CONST7 may instead retain size 46; then 46 guest vec4s are
  conservatively required. Wholly inactive arrays in VS alone, FS alone, and both
  have both absent location and invalid index, retain declared count in
  diagnostics, record zero active/upload counts, make no `uniform4uiv` call for
  that stage, and allow draws without guest constants for that stage. Injected
  shorter/absent reflection, if necessary, is labelled validation evidence and
  does not masquerade as hardware optimization or a GPU semantic oracle.
- **P08 — Host limits by stage.** Actual `MAX_VERTEX_UNIFORM_COMPONENTS` and
  `MAX_FRAGMENT_UNIFORM_COMPONENTS` are independently queried and validated as
  finite integers. Bad host limit values reject construction without leaking
  native resources. A reflected-47 VS needs at least 188 VS components even
  though only 184 words are uploaded; an ample FS limit cannot excuse a smaller
  VS limit, and vice versa. Successful real linking is still required, so these
  checks cannot substitute for combined/default-block packing.
- **P09 — Invalid reflection rejection and cleanup.** Wrong uniform type,
  noninteger/zero active size, active size 48, active size above declaration,
  inconsistent absent index/location, and insufficient matching stage limit all
  fail before program publication. A late FS failure after the VS system UBO was
  allocated deletes both the new native program and the UBO, returns accounting
  to its pre-link values, and leaves no cache entry or native orphan. Recovery
  with the same numeric handles and valid reflection succeeds.
- **P10 — Host-only padding isolation.** No runtime upload or clear touches
  element 46 of a retained-47 array. Two distinct deliberately poisoned padding
  values survive context restoration unchanged. Actual high-bank VS geometry
  and FS pixels remain equal to independently calculated results with either
  poison. This is distinct from testing an optimized-out tail.

## Completeness, ownership, and real output

- **P11 — Independent high-bank output.** Raw actual renderer commands create,
  link, bind, upload, and draw shaders whose VS position depends on CONST45 and
  whose FS color depends on CONST45. Independently specified vertex/rectangle
  and pixel values are met on the actual hardware backend. The proof retains
  raw packet words, exact shader texts/full translations, reflection, uploads,
  output pixels and ownership events. An all-zero or compile-only path cannot
  satisfy this prediction.
- **P12 — Prefix replacement and draw preflight.** After a successful 184-word
  upload, a 180-word or empty replacement stores exactly the new prefix, without
  retaining the old last vec4. With the program already linked, a draw requiring
  184 words returns `incomplete-draw` before synchronous index read, asynchronous
  index staging/fence, or GL draw. Draw-alone rejection leaves guest state,
  renderer budgets, native-object ownership, and draw counters unchanged. Safe
  restoration may zero legal missing words but cannot make the guest snapshot
  complete or satisfy the draw.
- **P13 — Context and subcontext A/B/A.** Identical numeric object handles in
  separate contexts and subcontexts with distinct low/high constant words
  produce A, B, then A again. Poisoning low and high GL uniforms cannot survive
  the corresponding restoration. Each recorded upload comes from the selected
  generation's immutable guest snapshot; a program from another owner cannot
  supply the constants accidentally.
- **P14 — Numeric-ID reuse.** Destroying/recreating a context or subcontext
  produces a new generation with empty constant snapshots. Old data cannot
  satisfy a high-bank draw in the replacement, even with the same numeric
  handles. Old objects/programs/leases are released according to their existing
  lifetime rules; subsequent valid uploads recover correct output.
- **P15 — Async snapshot and shared engine.** After successful `beginSubmission`,
  changing or detaching caller-owned packet bytes cannot alter the job's decoded
  constants or output. Interleavings across bounded command steps preserve the
  owned high-bank data. Async short/empty uploads share the synchronous
  completeness rule and fail before index staging; accepted work drains its
  actual fences and releases staging/native resources.

## Sabotage, coverage, and evidence binding

- **P16 — Independent novel attack.** A verifier-owned bounded sequence will
  combine asymmetric VS/FS high words, shorter replacement of only one stage,
  restore into another owner, and recovery to the original owner. Before each
  observation its expected selected generation, stored words, allowed upload
  extent, and draw result will be fixed independently. Distinct high and low
  sentinels must make truncation/aliasing and accidental stage sharing visible.
- **P17 — Sabotage sensitivity.** A served-source mutation that truncates the
  high upload, aliases high words to low ones, or omits restoration must compile
  and link successfully, then fail an independently computed real vertex/pixel
  assertion. A deliberate setup failure, asserted self-reported result, or an
  oracle derived from generated lowering does not qualify. Original source is
  restored after the bounded sabotage run.
- **P18 — Diff execution coverage.** Every changed executable runtime hunk is
  exercised by recorded direct coverage or a precisely cited deterministic
  attack; validation branches cannot be waived merely because hardware returns
  ordinary values. Non-executable declarations/docs/receipts receive explicit
  justified waivers. Dead code is removed; uncovered claimed behavior requires
  evidence. Existing state/draw/async regressions remain green.
- **P19 — Frozen-head and cold binding.** Recorded evidence identifies the exact
  runtime/harness commit and hashes every served source, shader input, compiler
  output, binary, raw packet, and recorded report it relies on. Those digests
  match the final diff and a pristine clone's accepted run with relevant compiler
  environment overrides scrubbed. A different worker claim commit may contain
  only evidence/task bookkeeping after the frozen head. Screenshot/output
  artifacts are authentic matches to the cited run; no stale result is accepted.
- **P20 — Scope containment.** Device/capset negotiation and production graphics
  activation remain off, with no unrelated system-UBO expansion, shader language
  acceptance widening, integer-constant semantics, or claimed desktop MIPS/FPS
  improvement. The submission's performance claim is limited to this proven
  transport/reflection boundary.

## Evidence discipline

No worker evidence has been inspected for these predictions. On submission,
inspect the scoped diff first, then verify digests, perform bounded independent
attacks, and audit every changed hunk. Mark each prediction HELD, FAILED, or
NEEDS EVIDENCE with file/line or structured record paths and SHA-256 bindings.
Do not implement fixes. Preserve already HELD results when their code boundary
and evidence digests remain unchanged. Do not commit or change task status until
the final independent verdict is ready and root requests the bookkeeping commit.
