# E5.5-T03z independent verifier evidence

`predictions.md` was written before worker evidence was inspected.
`derive-goldens.py` derives binary32 division using exact fractions and integer
rounding, without project code or host floating point. Its 59 operand pairs
are retained in `goldens.json` and promoted as literal Rust fixture data.

The three promoted fixtures are listed and hashed in `frozen-fixtures.json`.
They cover native and private/shared WASM generated modules, precise guards,
helper purity, exact state publication, optional imports, real memory growth,
direct chains and later faults. `coverage.md` maps them to changed code.

`final-verdict.md` records the final verified FDIV.S boundary, with a failed
desktop response and five inherited broad-suite failures kept explicit.
`final-audit.json` binds the sealed worker commit, all 69 rehashed files, the
exact clean-clone source and artifact, and the independently inspected results.
`audit-cold.py`, `audit-production.py`, `audit-physical.py`, `audit-ci.py` and
`audit-seal.py` interrogate the retained records without starting an emulator.
`audit-public.py` performs read-only downloads pinned to frozen Git bytes.

`provisional-review.md` describes the earlier preseal checkpoint; its pending
items are resolved by the final verdict. Historical failed fixture checks are retained:
`native-preseal.log` records integer type inference errors; the initial Clippy
logs request `is_multiple_of(5)`. Their corrected logs pass. Neither diagnostic
is a product finding.

The first public-fetch attempt encountered sandbox DNS restrictions; the
authorized read-only retry fetched all ten exact public artifacts successfully.
Both logs remain. Eight screenshots were viewed and rehashed: three production,
three clean-clone and two physical desktop images.

`sabotage.py` copies the fixture into a scratch crate, changes one expected
literal, requires a failure, restores the original and requires a pass. Its
source/restoration and log hashes are retained in `sabotage.json`.

Commands use `DEVELOPER_DIR=/Library/Developer/CommandLineTools`. WASM tests use
Node `/Users/blamy/.nvm/versions/node/v24.20.0/bin/node`. All proof is local;
no retired Linux host or rr trace is used.
