# Selected native color checkpoint budget — worker evidence

Frozen runtime and gate source: `43f227ae83acb3fc1c5f9c3bcd9766d2710d0875`.
Run `make verify-E5.5-T05c1` to build and exercise the real hardware path.
The gate passes on the original checkout and the isolated full-history clone;
the latter has its own Git objects, npm installation and Cargo target, with
`RUSTFLAGS`, `CARGO_*` and `RUST_LOG` removed from its inherited environment.

`frozen.json` indexes the original closed hardware, layout, demo, sources and
acceptance recordings. Concatenate its two listed parts in order to obtain the
SHA-bound tar.xz archive. Every physical native read and all literal/restored
bytes are retained. `pristine.json` indexes `pristine.tar.gz`, whose
`records.json` accounts for all 140 original files. A record may reference a
byte-identical frozen payload only after both actual originals were hashed;
new payloads are retained inside the pristine archive. No result is replaced.
Each part is at most 24 MiB. Read archives as data; do not execute their contents.

The initial sparse-checkout omission, unsupported sparse-add option and shallow
history metadata difference remain in the pristine record. Gate10 itself
passed; its extra cleanliness assertion caught only generated roadmap activity.
After fetching full ancestry and restoring those three generated files, gate13
passed and left the tracked clone clean. Runtime and test source stayed exact.

This proves the existing selected color scratch budget, its next-resource
refusal, historical boundary and checkpoint/restore. It does not publish a
factory image, qualify all Omarchy source ports, or claim deployment/recovery.
