# E6-T12g6h worker recording

Source head: `81dfb7c010eb117d93335bc3a7c91878546449f8`.
Runtime head: `31641b3fb5fa4e09256531df67dfaaadf651b0ea`.
Verified predecessor: `bad92bfdaba16295b064a78c0767652da09be158`.

Authenticate `records.json` against `manifest.json`, then every archive member
against the index before replaying. The archive contains both actual sanitizer
binaries and profiles, native/Wasm/pinned parser fixtures, consumer attacks,
predecessor responses, physical captures and raw readbacks, deliberate shader
faults, V8 coverage, source digests and the pristine-clone records.

The claim is instruction-local MOV_SAT/DIV_SAT with existing numerical authority,
bounded static division, source negation before the operation, clamp afterward,
mask/alias preservation and unchanged ordinary instructions. Each hot/cold set
has three seeds, 121,032 physical words and 79,872 pixels on Apple M4 Max hardware
through both private and pinned Mesa shaders. Four exact captured SAT statements
are isolated probes; complete original compositor bodies remain gated.

The first warm run exposed an overly strict numerical signed-zero oracle. ESSL
3.00 permits numerical signed zeros to interchange; raw MOV/copy predictions
remain exact. Commit `01150301` repaired that evidence boundary, and `81dfb7c0`
made allowed byte lists compare as sets. No runtime changed. All affected warm
GPU/fault captures and the receipt were rerun; completed native/Wasm results
carry their original runtime head. `hot/zero-oracle-failure/` and
`hot/incremental-submission.json` retain the failed attempt and repair history.

The single pristine clone ran `make verify-E6-T12g6h` with a scrubbed environment.
Its second browser seed lost the Playwright execution context before recording
results. Completed native/Wasm/first-seed evidence was retained. The remaining
two seeds, all three faults and the receipt passed in that same unchanged clone.
`cold/initial-attempt/`, `cold/acceptance/browser-context-interruption/`, and
`cold/report.json` preserve the failure, exact recovery commands and clean
before/after status. This is incremental completion, not an uninterrupted green
make run or a second clone.

The native division predicate ran 3,172 times. Its defensive unsafe-known-
numerator branch had zero hits after the prior numerical-authority check; the
critic must assess that premise. No claim of 100% branch coverage is made.

This is a worker submission pending an independent critic. Production GPU
negotiation, guest caps, live imports, FPS and MIPS claims remain disabled.
