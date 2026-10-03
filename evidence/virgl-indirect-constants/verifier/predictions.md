# E6-T12e8 verifier predictions (written before inspecting run evidence)

Date: 2026-10-03. Baseline: d3a57934cab34e62a274996c0a5559ed8db52645.
Initial oriented HEAD: f135f781d0b5f67c822abb8fcaea766a6ea451a0 plus uncommitted task diff.
No exact-head claim or run evidence has yet been inspected. These predictions
apply to the eventual frozen diff; changed source invalidates affected checks.

1. **Unsigned bounds / initialization.** A public bridge translation whose address
   has an unknown bit at or above bit 6, may equal 46 or UINT32_MAX, was never
   written, or was written on only one structured predecessor rejects before GLSL
   publication. A masked raw unsigned input with possible values {0,1,4,5} and
   declarations for all four values admits and records exactly that candidate set.
   Deleting any possible declaration/component makes the same program reject.
2. **UARL data semantics.** UARL consumes post-swizzle x as an unsigned raw word,
   without float conversion. Different source lanes containing 0, 23, and 45
   select those exact entries. Reassignment changes the subsequent source use;
   per-use candidate sets accumulate as a sorted unique union. UARL from an
   indirect source reads the prior address and clears static address authority;
   a following indirect read therefore rejects unless new bounded authority is
   independently established.
3. **Structured joins.** Both-predecessor address writes join known facts by
   intersection; same-value writes remain precise, different values preserve all
   bit-compatible candidates (including conservative intermediate values), and a
   branch-local narrow bound cannot escape a missing ELSE or stale predecessor.
   Nested structured frames restore and join address initialization and value
   facts independently of temporary/output state.
4. **Closed metadata.** v10 has exactly one typed static-indirect record and no
   finite domain; v11 has that record plus the matching finite domain. Record
   stage/slot/name/count agree with one uvec4[] float32-bits bank; indices are
   nonempty typed integers, sorted, unique, <46 and <count. Older profiles reject
   access records. Boolean numeric fields, unsupported slots/buffers, absent or
   additional fields, aliases, getters, and malformed arrays cannot authorize draw.
5. **Whole-bank proof.** Prior to linking/index staging/draw allocation, v10/v11
   require every word of min(count,46) vec4s even when reflection or the current
   address observes a shorter prefix. v11 rejects a nonfinite bit pattern in any
   such lane; v10 preserves arbitrary u32 payloads. Extent47 requires184 words
   and never grants index46. Reflection shorter than the maximum proved index
   rejects before dispatch. Partial/invalid banks restore without uploading.
6. **Immutable draw.** Validation owns frozen words from the same bank identity
   used by the draw plan. Mutating caller packet storage or replacing a bank
   during asynchronous index staging cannot alter the validated upload; a later
   invalid bank cannot reuse an earlier approval. Rejected draws perform no GPU
   draw and no index read/allocation, and retain the expected pre-draw state.
7. **Observable oracles.** Native and Wasm emit identical full results for every
   authored input. Real hardware words/pixels distinguish first/interior/last,
   both stages, swizzles, reassignment and branch selection. Loop/PRECISE forms
   remain rejections; all3466 formerly successful results and12/19 originals
   remain identical to baseline. Deliberately wrong address/bound source causes
   rejection/oracle failure, rather than merely emitting a mutated-source label.
8. **Budgets/recovery.** Actual raw IR is26256 bytes, flow arena52612 bytes, profile
   remains<=8192, instruction112, and Wasm memory16MiB/stack256KiB. Allocation
   failures, invalid input, truncation and independent mutation seeds publish no
   partial result and subsequent known translations recover exactly.
9. **Evidence integrity.** Receipts reject stale source digests, omitted changed
   consumer files, forged results, changed case counters, and bool/int or
   float/int substitutions in counters and metadata even after evidence-record
   digests are recomputed. A pristine final-source acceptance proves the same
   admitted boundary with scrubbed build environment.
10. **Coverage.** Every added runtime hunk is hit by native source coverage or
    browser/Node precise coverage; unhit lines receive a per-hunk exercised-path,
    deletion demand, or narrow waiver. New state.mjs and constant-domain.mjs
    cannot inherit the preceding task's unchanged-source result.

## Independent attack plan

Public bridge inputs: independently authored both-stage bitmask candidate sets,
address predecessor joins and stale overwritten bounds, sparse declaration/lane
holes, source swizzles, 45/46/UINT32 limits, wrong bank and unsupported ADDR syntax.
Use a separately compiled coverage-enabled C shared bridge for retained native
calls and fuzz seeds; never edit implementation files in place.
Consumer: closed-schema numeric-type/accessor attacks and full-prefix byte
ownership checks, with actual hardware lifecycle proof inspected from final run.
Sabotage: compile a private copy with address-state join or bound fault and demand
that the independent/new test rejects it. Bind original and mutated source hashes.
Receipt: mutate copies of final evidence, recompute each corresponding record
hash where applicable, and require each receipt validator to reject. Unchanged
negative tests alone cannot substitute for these deliberate corruptions.
