This private compiler leaf implements TGSI EX2/LG2 with post-swizzle x
replication and post-modifier static domain proofs. EX2 accepts normal-or-zero
encodings in [-125,126]; LG2 accepts positive normals. Conservative partial
facts may prove every possible argument; an origin or numerical shadow alone
cannot. Results carry no new exact bits, range, conversion or bank authority.

Run `make verify-E6-T12g6i` once at the frozen source head. The instrumented C
fixture executes public admission/recovery and the actual pinned parser and
converter; all public singles/pairs repeat in Wasm. Complete predecessor
responses, promoted guards, whole immutable metadata, mutable owned banks,
A/B/A replacement, restoration and sync/async consumers retain their existing
policies. Record varied physical runs and all three emitted-source faults.

`reference.py` uses independently correctly rounded Decimal ln/exp, expanded
one Decimal ULP, and directed interval arithmetic at 160 digits. A 220-digit
reference must nest. Exact power-of-two cases use integer rational arithmetic.
`source_oracle.py` derives operands, modifiers, source versions, conditions,
replication and untouched lanes directly from TGSI. Physical transform feedback
exposes all 32 bits in two finite carriers. RGBA8 readbacks expose four bytes of
one evaluation, avoiding a shared-result assumption across separately compiled
bit planes. The bound shrinks to require compliance for every possible true
value in the reference enclosure. Error budgets come from the primary ESSL
specification cited in `precision-source.json`.

The pinned virglrenderer converter has a documented differential exception:
its EX2/LG2 lowering is componentwise, although the pinned TGSI specification
and token output mode require x replication. Its original GLSL is retained,
executed and compared with independently predicted componentwise equations.
Canonical `.xxxx` inputs prove agreement across the complete boundary/random
input set. Nonbroadcast inputs record concrete deviations, rather than quietly
changing TGSI semantics or modifying the reference shader. All 18 isolated
captured statements use broadcasts and are proven on both backends. These
initializers do not establish admission of either complete original body.

Use `cold.py --output ...` for the single final pristine clone, then `seal.py
--hot ... --cold ... --output evidence/virgl-exponent-logarithm/worker` to retain
actual binaries, profiles, raw captures, source bindings and screenshots. A
fresh critic audits this seal. Production negotiation/caps, live demo imports
and performance claims remain gated by the later integration tasks.
