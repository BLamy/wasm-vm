# E5-T26h verifier verdict

VERDICT: refuted

Frozen implementation: `4ed9eaa5299338e513783722808576960919604b`.
Observed upper-layer HEAD: `719c6212a5e028523ef70376c864c6411fdf5b48` (browser-only remediation;
the reviewed core source/test paths have no diff from the frozen implementation).

- FAILED: a pre-snapshot console control-transmit kick is cleared during restore. The used index
  remains 1 instead of advancing once to 2 (`attacks.log:8-13`).
- FAILED: malformed CPU payload refusal occurs after live GPU state has already been committed;
  source resource 77 remains installed in the target (`attacks.log:15-17`).
- HELD: every new desktop section's component and ring corruption, omission, duplication, topology
  mismatch, alternate assembly, held-input reconciliation, wrapped RNG cursor, pending sound,
  headless compatibility, clean-copy acceptance, and cursor-sabotage sensitivity.

Digests:

- worker: `d406f8521396d4e5ad9fe787b2458122bfef149ebc99a03b7fd6d429833ba79f`
- attacks: `103c12a5c80af59dc69401ce4a94fdddf8c32fd2a4cd2b485f4b0d4c94ebd8ae`
- clean copy: `3c34620f610e5f9080ff7facea0e3b120de1eea1f4216b1f90111928bc6a1f08`
- sabotage: `f242c074df7fcb6e3bd986f27d4514b3d9f6f6708c1760978dce04d19325098d`
- predictions: `495efec40cac6dba7d09e8eac68d1d9b7290a7ad761b80cb1bc40659612b0f5b`
- promoted critic test: `c981b5eba07aa2aa5697f968d4b18df4ee954a285b49381af139f8b0ae4fcec1`
