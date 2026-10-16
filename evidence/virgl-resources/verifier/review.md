VERDICT: verified

Independent verifier for E6-T12b. I did not implement this task. I read the task,
AGENTS.md and new runtime/README/harness before opening worker evidence and wrote
`predictions.md` first. Frozen implementation is
`fadf4ba813fa31694fb0a560f89c61c740ea3643`; the final independent run was made at
evidence-only worker submission `b52c2cbdf2dbf01e02d78e2bb6724502fececc16`.
The independent audit checks that every frozen source is unchanged between them.

## Predictions and evidence points

- P1 provenance — HELD. `audit.json` contains 251 independent checks: every worker
  and cold source/input/record digest, compressed and decoded blob hashes, source
  identity against the frozen Git tree, recorded served-source provenance and
  cold-clone Git status. The worker receipt is
  `f60289206aad7af60256d204360e6ab727d0f07cbb23c9850a607db6413f4f86`; cold receipt
  `02bffa033604a70e703db734dbd1d4b004ec525fea036fb247448c0a16d478d1`.
  I separately queried the retained clone: HEAD matches and its status is empty.
  `cold-clone/report.json:14` records the same clean start/end and passing command.
- P2 original GPU inputs — HELD. Raw initial snapshots 156/157/160 independently
  decompress to the recorded hashes, and their selected 64/12/16 bytes equal the
  actual GL readbacks (`worker/hardware/report.json:1215`; selections in
  `audit.json`, worker input selections). The literal vertex/index/texture byte oracles are separate
  from the runtime's own readback API. The browser reports hardware WebGL enabled;
  actual allocated index storage can bind as ELEMENT_ARRAY_BUFFER. Its original
  budgets are 4188 GPU bytes and 1064960 backing bytes, with no GPU allocation for
  staging. Node/browser pure results match; console/page/request errors are empty.
- P3 checked arithmetic — HELD. Worker rejection points include row/layer overlap,
  invalid levels/formats, overflow and logical buffer extent independent of its
  page (`worker/hardware/report.json:305`). I ran 8192 mutations with five new
  seeds: 2474 accepted, 5718 rejected, with deterministic recovery after each
  (`attacks.json:417`). This produces 64439 native assertions (`attacks.json:66`).
- P4 scatter/gather and both copy directions — HELD. Independent browser code uses
  literal row loops, never `computeTransferLayout`, to construct expected texture
  pixels and backing guard bytes. All 72 varied rectangles with offsets, default
  or explicit strides, one-byte/zero-length SG segments and both transfer variants
  survive direct framebuffer readPixels plus reverse scatter comparison
  (`attacks.json:585`). The worker also exercises original READ_FROM_HOST packets
  at staging offsets 64/4160/8256 and failed/short readback with unchanged backing.
  Pinned local reference functions separately check the primary GPU logical box
  and secondary staging IOV; staging metadata width is not a second offset bound
  (`reference-copy-semantics.json`, renderer source lines 10116/10121 and
  10173/10178). That behavior agrees with this bounded executor.
- P5 identities — HELD. Worker pending-copy backing and attachment replacements
  reject (`worker/hardware/report.json:461`), including numeric resource/context
  reuse and an absent primary backing becoming attached. Independent foreign
  ticket/lease use, consumed-ticket cancellation and membership revoke/reattach
  fail with exact error codes. Backend call counts remain unchanged on each stale
  ticket (`attack-cases.mjs`, recorded across the 72 cases in `attacks.json:585`).
- P6 ownership — HELD. Independent source-backing mutation after prepare cannot
  change the GPU upload. Public unref retains the actual GL texture while leased;
  direct GL reads still match expected bytes; final release makes `gl.isTexture`
  false. The worker separately verifies old storage survives numeric ID reuse
  and context destruction (`worker/hardware/report.json:1215`, worker acceptance
  source lines 221-241 and 802-817).
- P7 budgets — HELD. Worker limits cover retained unpublished resource/GPU bytes,
  CPU backing plus reserved scratch, segment/ticket/lease/context counts,
  allocation/readback/upload/disposal failures and subsequent recovery
  (`worker/hardware/report.json:481`, `:662`, `:13703`). Independent tests return
  every per-case non-context counter and every final counter to zero
  (`attacks.json:1675`). A trusted injected gather allocation exception proves
  reservation rollback, no ticket publication and no retained reference.
- P8 output contamination — HELD. The worker poisons all 12288 selected output
  bytes and repeats the genuine original uploads unchanged
  (`worker/hardware/report.json:13677`). Genuine browser input corruption fails
  exactly at the independent GPU byte oracle: texture byte 0 expected 255,
  observed 254 (`worker/sabotage-texture-texel/report.json:813`); index byte 0
  expected 0, observed 1 (`worker/sabotage-index-byte/report.json:813`).
- P9 hostile GL state — HELD. Every worker transfer restores required pixel-store,
  PBO, texture, VAO/index and read-FBO state after renewed poison
  (`worker/hardware/report.json:13679`). Independent GL reads use separately
  configured FBOs. Actual retained storage deletion and direct backend disposal
  of still-live buffer/texture objects both execute.
- P10 malformed inputs/failures — HELD. Node/browser checks cover non-byte,
  detached/shared/reflected-shrink views, accessors and structured invalid
  records (`worker/hardware/report.json:617`). The independent defensive probes
  additionally cover null records, nonarray backing, generic GL initialization
  failure, direct backend disposal, trusted programmer-error propagation and
  reserved-scratch cleanup after injected gather allocation failure
  (`attacks.json:1686`). Fault probes are not substituted for GPU success proof.
- P11 coverage — HELD. Exact-source Node V8 plus hardware CDP counters and
  independent CDP counters cover all 81 runtime functions and every detailed
  runtime range, with no unexecuted function or uncovered span
  (`audit.json`, coverage result). This means executed coverage of the diff, not exhaustive
  path proof. See per-file accounting below.
- P12 novel attack — HELD. The independent 72-case GPU oracle produced 3424
  assertions, 72 uploads and 72 readbacks, three new seeds, zero browser errors
  and zero final budgets (`attacks.json:584`, `:1672`). It includes simultaneous
  row/SG/offset variation, preparation snapshot changes, foreign capabilities,
  revocation and actual deletion checks. I visually inspected worker and
  independent screenshots; both show their recorded successful results.
- P13 sabotage — HELD. Besides the worker's two input corruptions, temporary
  runtime copies with a wrong default row stride and disabled membership
  revocation both fail at their intended assertions (`attacks.json:447`). No
  implementation files were modified. Both changed-source digests and exact
  replacement strings are retained.

## Per-file diff coverage

- `resources.mjs` — all 81 functions and all V8 detailed ranges execute across
  source-bound worker and independent evidence. The initially unexecuted gather
  cleanup at line 402 was exercised by a bounded trusted allocation-fault probe;
  no runtime coverage waiver remains.
- `tests/resources-acceptance.mjs` — native and hardware exports execute in the
  worker and fresh clone; independent native seeds reuse assertions while the
  separate GPU oracle exercises its own expectations. Failure assertions are
  made sensitive by two source and two input sabotages. Helpers are directly
  audited; their diagnostic-only throw alternatives are waived, not success
  semantics. Memory/fault backends are explicitly separated from actual GL proof.
- `resource-fixtures.mjs` — worker, clone and verifier load the same explicit
  initial snapshot selections. Decompression, size and digest checks execute;
  reference outputs remain a distinct member unused by the source installer.
  The alternate uncompressed-file branch is a representation-only waiver: this
  frozen corpus stores the blobs compressed, with raw digests independently checked.
- `verify-virgl-resource-transfers.mjs` — Node, real hardware, both corruption
  modes, success/failure reporting, screenshots, served hashes and CDP coverage
  execute. Timeout/unexpected-error diagnostics and absent-browser alternatives
  are waived because no corresponding success/environment claim is made.
- `verify-virgl-resource-transfers.sh` / Makefile recipe — syntax checks, inherited
  decoder regression, coverage extraction, hardware acceptance, sabotages and
  receipt execute in worker and cold clone. Fresh npm install executes in clone.
- `resources-receipt.py` — both receipts execute; independent `audit-evidence.py`
  recomputes rather than trusting the receipt's status. Rejection-message-only
  branches are audited/waived; they do not alter product execution.
- `resources-cold.py` — exact-head shared Git clone, detached checkout, scrubbed
  environment, npm install, acceptance, clean before/after and digest binding
  execute. A shared immutable Git object database is not inherited build output;
  the checkout and node_modules are fresh. Failure diagnostics are waived.
- `resources-coverage.py` — one exact source-filtered Node coverage result is
  emitted; verifier independently interprets innermost V8 ranges. Diagnostics
  for missing/multiple source results are waived.
- `resources-README.md` — declarative API/scope/limits/lifetime/state documentation
  directly compared against implementation, task and evidence; no execution claim.

## Environment and retained suite

This is isolated Chrome hardware WebGL2 resource evidence on Apple M4 Max. No
guest graphics activation, draw/state replay, FPS, compositor or broad portability
claim is verified. Production web/Rust/Wasm/shader sources are unchanged. Prior
verified dependency results carry forward. rr/SSH and unrelated workspace suites
are outside this task's prescribed boundary. No demo deployment is implied by an
unintegrated renderer module.

Retain the existing `make verify-E6-T12b` gate and promote this directory's
`attack-cases.mjs` / `run-attacks.mjs` as a reproducible verifier regression artifact:
`node evidence/virgl-resources/verifier/run-attacks.mjs`. Retain both runtime
sabotage controls and the immutable original-input byte oracles. Independent
audit command: `python3 evidence/virgl-resources/verifier/audit-evidence.py`.

Final independent evidence SHA-256:

- `attacks.json`: `8637975189bfc27a510d08c8ac6f02d6a13ba2820862a866ded61fa496dcaf31`
- `audit.json`: `cb2e5708314805444727eca420bd7bab4907999aac853c117b702ff27876ac02`
- `attack-coverage.json`: `20aae27ce8081dd1f65cff20560fc92b447a298ce121ee5549ed595e2c42fe95`
- `attack.png`: `39904621c5f2db475dfd4570a31d541df6c395fd2324877837cc0df31a2b17a8`
- `reference-copy-semantics.json`: `3f1fbb4f5a44e2402f19a5aee97666f2c6a8f1f4d1dead421055254a718342e8`
