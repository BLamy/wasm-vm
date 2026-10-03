---
id: E6-T12e6
epic: 6
title: Preserve captured dot-product and reciprocal float operations
priority: 525.0269906
status: implemented
depends_on: [E6-T12e5]
estimate: S
risk: high
capstone: false
---

## Boundary

Admit plain DP3, RCP and RSQ with their pinned TGSI source-lane use and result
replication semantics. Record explicit accepted numeric domains and the measured
ESSL300 guarantees, rather than assuming host floating-point arithmetic is an
exact oracle. PRECISE operations and PRECISE-bearing originals remain rejected.

## Deterministic acceptance

`make verify-E6-T12e6` requires native sanitizer/Wasm parity and hardware draws
with independent lane-distinguishing DP3 values and reciprocal/reciprocal-square-
root inputs. Include exact representable controls and a documented independent
bit/ULP oracle for the admitted nonexact cases. Preserve earlier tests and the
12/19 original outcome; record final exact-head and clean-clone evidence.

## Adversarial verification

Attack xyz versus xyzw reduction, per-destination replication and swizzling,
partial output lanes and numeric-domain edges. Sabotage the reduction lane or
reciprocal operation. Do not present approximate-operation tests as PRECISE proof.

## Preparation notes

The scalar contract follows Mesa 26.2.2 TGSI documentation, opcode metadata,
source-use analysis and interpreter: DP3 consumes the first three post-swizzle
source lanes and broadcasts their dot product; RCP and RSQ consume the first
post-swizzle source lane and broadcast one result. The older pinned VirGL RCP
emission and source-use helper disagree with that scalar rule. Document this
limitation explicitly instead of copying the componentwise shortcut. Both
captured RCP instructions already write x from an xxxx source. The full captured
inventory is four DP3, two RCP and four RSQ across four unchanged PRECISE-bearing
originals; keep all nineteen full outcomes unchanged.

Retain the ordinary source authority and arithmetic contract from E5. Quantitative
oracle domains are not new shader-admission guards. No abs, clamp, divisor
replacement, finite/positive-value admission restriction or PRECISE shortcut is
introduced. Unknown raw numeric CONST remains a separate integration boundary.
Evaluate one scalar operation, broadcast it, capture the result once, and publish
only validated destination lanes. Share the consumed-lane rule between parser
initialization checks and numeric-authority checks. A reciprocal writing w reads
source x; a DP3 writing x still reads source xyz. Negation applies after swizzling
to only those consumed lanes, and all aliases observe pre-write operands.

Reserve opcode-mask bit 21, currently the validated E5 numeric-negation marker;
new scalar opcodes must not collide with it. Keep 112-byte instructions, the
26,232-byte IR, 179-instruction/text/output limits and fixed 16 MiB Wasm memory.
Earlier profiles and complete results remain exact except two explicit historical
DP3 admissions. Preserve those exact bodies as new positives and replace their
old negative slots with source-bound adjacent rejections. The four malformed
RCP/RSQ historical two-source bodies must retain their exact errors.

Use exact rational DP3 controls with distinguishable xyz and a poison w, plus
an independently justified enclosure for any nonexact reduction witness. RCP
uses the specified positive-denominator 2.5-ULP division enclosure. RSQ uses
integer-square-root rational bounds widened by the specified 2-ULP allowance;
JavaScript Math.sqrt or host float division is not the expected-value oracle.
An exact mathematical reciprocal or square root alone does not require exact
result bits. Record exceptional observations without unsupported payload,
computed-zero-sign, subnormal-retention or cross-stage-equality claims.

The two historical DP3 changes cannot pass E5's unmodified six-migration native
receipt. Use an explicitly named successor-owned compatibility adapter, pinning
the verified E5 baseline and reconstructing exactly those two substitutions.
Run the unchanged E5 native C harness with the complete predecessor stream and
its unchanged 12/10 recovery anchors and mutation schedule. Reuse every E5 GPU
oracle and sabotage check unchanged, and run the full C2 gate unchanged. New v6
programs belong only to the new workload. Do not weaken old checks, monkeypatch
source reads, fabricate an E5 full-gate receipt, or substitute old results for
current execution. Independently attack the adapter's names, transforms, full
results, stream bytes, anchors, seeds and digests.

## Verification log

### 2026-10-03 — worker — implemented

Final frozen implementation: `cb6726dc68eebecdaf9b848ea846e525003e86c9`.
Initial full warm gate: `72a8695ba92d734a6bead0c42ead3089d8611806` (parent
`3adaa72f95fd88b8fefd5caa32d6407df22af1dd`; activation/planning commit
`2ac2a275`). This is an isolated compiler capability; production negotiation,
web deployment, guest Mesa execution and MIPS claims are unchanged.

Commands:
- `python3 tools/check_task_policy.py`; Python/Node/Bash syntax checks; `git diff --check`.
- `VIRGL_DOT_RECIPROCALS_EVIDENCE_DIR=evidence/virgl-dot-reciprocals/worker make verify-E6-T12e6`.
- `node tools/verify-virgl-dot-reciprocals.mjs --output evidence/virgl-dot-reciprocals/worker-incremental/hardware`, followed by the same command with `--sabotage` for `dp3-lane`, `rcp-source`, `rsq-operation`, and `numeric-negate`; recheck with `python3 evidence/virgl-dot-reciprocals/worker-incremental/check.py`.
- `python3 tools/virgl-dot-reciprocals/cold.py --output evidence/virgl-dot-reciprocals/cold-clone`.

The first full warm receipt remains bound to its actual `72a8695` head. The
fresh verifier found one never-entered browser helper (`fraction`); `cb6726dc`
deletes that single unused line and changes no runtime/native/oracle code or
fixture. The affected hardware run and all four controls were recorded again in
`worker-incremental/` at `cb6726dc`; all 151 remaining browser functions entered.
Earlier HELD runtime/native checks are carried forward without retagging their
records. The final pristine clone runs the entire acceptance at `cb6726dc` and
is the complete final-head authority. A pre-cleanup cold attempt was stopped and
is not claimed as acceptance evidence.

The recordings bind both changed C sources and fixtures to the frozen commits.
Native ASan/UBSan exercises 2,699 cases, 203 pairs and 435,179 calls, including
8,990 truncations, 225,526 standalone recoveries, 193,308 pair recoveries,
324 hostile cases and 4,096 seeded mutations. Every added executable runtime
line and both outcomes of all 40 changed branch records executed. Maximum
single/pair JSON sizes are 63,369 / 109,235 bytes; maximum emitted GLSL is
58,201 bytes, all within unchanged capacities.
The independently checked predecessor compatibility stream retains the unchanged
E5 C harness and all 2,083 predecessor cases / 162 pairs, with exactly two
source-bound DP3 substitutions. The complete C2 gate and every earlier oracle,
plus the unchanged E5 hardware and four fault controls, run on the current
compiler. No historical E5 full-gate receipt is fabricated.

Actual Apple M4 Max WebGL2 captures exercise 310 exact and 178 bounded words,
72 limited exceptional observations, 72 joint ordinary/raw consumer draws,
6,144 texture pixels, 33,728 interface pixels and two orientation captures.
DP3 controls distinguish xyz from poison w, remain exact under every addition
association, and cover swizzles, partial writes, aliases and sampled inputs.
RCP and RSQ use scalar post-swizzle x and independent rational/ULP enclosures;
the inverse-root oracle uses integer square-root brackets, not host sqrt.
The four GLSL source controls fail at independently reconstructed actual GPU
output mismatches. All objects are released and browser consoles remain clean.
The hardware screenshot was inspected. Quantitative domains qualify witnesses,
not admission, and no PRECISE guarantee is asserted.

All 19 full originals remain byte-exact at 12 accepted / 7 unsupported. Scalar
opcodes avoid the existing bit-21 negation marker; 112-byte instructions,
26,232-byte IR, fixed 16 MiB memory and existing source/output capacities hold.
The older pinned RCP shortcut disagrees with Mesa 26.2.2 TGSI documentation,
interpreter, opcode metadata and source-use analysis; this compiler follows
scalar TGSI semantics, and both captured RCP sites already use xxxx into x.

Initial warm receipt: `35493421001e40f03d65d21b0f2e6078570294e461b2bae803e4568967540062`
(268 source bindings / 195 records). Initial native report:
`781960b68e1cb49d03b02ec4e6264183dc52fec408825d37ecb93daa7f189dcb`.
Final-head incremental hardware report:
`e079ad1b8537d5a53077288b017c32701868c57f96a4c7f2ef4b9f8fa96393aa`;
inspected screenshot: `140e7396a1be34e6394c4947654dca0a86f57c201cec4bdcbb987a6f6058f3c5`.
The independent recheck caption is `worker-incremental/check.json`, SHA
`0b9ea54fc05303eb9da6db0ab3d027eb97015d797a132a9bd72773764894de57`;
its reproducible checker is `check.py`, SHA
`872cb00f4a78aff33cb6717741badb326d89be24c9dd665345b5f171a14e9796`.
These do not replace or retag the earlier receipt.
Final pristine clone passed from a scrubbed environment, with clean tracked
and untracked status before and after, and 205 copied evidence files. Retained
checkout: `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-dot-reciprocals-cold-iyto94nf/wasm-vm`.
`cold-clone/report.json`: `dcf7972d3ffabd2c448017d3c1304da081a9af980665ae9c13411daf960e099b`;
`cold-clone/cold.log`: `425cd1636c5a0f9375fd480f93ae2ebb85187f2ba76623de987da0962352272e`;
`cold-clone/acceptance/receipt.json`: `42532735ad1bb140a4b0a5df551d4b9b6c0f4f0f67484d25446f7273c2d108f5`
(268 source bindings / 195 records);
`cold-clone/acceptance/native/native-report.json`: `52c950cf999bd0335e2c647a71e6390537743a9d013c0c3a8fcf4bfcbef0e211`;
`cold-clone/acceptance/hardware/report.json`: `c87ace0046d526ddbd7a7e16194e392e9c4694df6c6dc5308378aa907f06b30d`.
Final native sanitizer binary: `a6ea1a633f59025154c31e1e1c834c5749cb7eb1afbfcffa5a2dd04dc80e521c`;
Wasm: `4287e738fe2653fe43f03aec2bade254855ea6e47f94451e5f3ad16f9adc01e7`.
Raw compiler coverage output is retained byte-for-byte, including its trailing
whitespace, rather than formatting recorded tool output.

