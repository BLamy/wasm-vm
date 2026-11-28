# E5-T43b round 3 — verifier predictions (written before any run)

Head under test: `d7dc15904` (claim) over `733531688` (change). Round-2 verdict `ce8e83220`.

- P1 `idle()` unchanged: `git diff ce8e83220..HEAD -- crates` touches only comment lines inside the
  `idle()` doc block and the `#[cfg(test)]` module of `local_backend.rs`; the four-term body of
  `idle()` is byte-identical to round 2 (and to the `IDLE` string in round-2 `mutate.py`).
- P2 I5 (`(0..FILE_TRANSFER_SLOTS)` -> `(0..1)`) now fails the slirp lib suite, with
  `slot1_isolated_half_open_is_not_idle` among the failures (on the `!idle` assertion).
- P3 I1, I2, I3, I4, I6 each still fail the suite (288 tests at HEAD).
- P4 Novel: mutant I34 (drop both Listen terms) makes `idle_condition_local_http` fail on its
  final `!idle` assertion — i.e. the test really depends on the Listen reason it now states, and
  its `external_io_pending()==false` assertion passes at HEAD.
- P5 The corrected comment is true: in HTTP mode the DNS-over-TCP and file sockets are never
  relistened (no `listen` on `dns_tcp`/`file_tcp` reachable once `http_tcp.is_some()`), so after
  `register_e9_local_http` and 120 s of polls `idle()` stays false and no frame is emitted (round-2
  `r2_local_http_why_not_idle` rerun at HEAD reproduces).
- P6 `cargo test -p wasm-vm-slirp --lib`: 288 passed, 1 ignored; clippy (lib, tests, -D warnings)
  and `cargo fmt --check` clean at HEAD.
