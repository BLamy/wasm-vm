# E5-T22f fresh verifier predictions

Preregistered on 2026-09-06 before inspecting worker evidence or the untracked
candidate verifier material. Scoped implementation boundary:
`03fdfb24..844948819f3fd8839cb4edd38e1ec4a0218d70d9`.

- **P1 — unchanged S/U work:** after an S-to-U or U-to-S change with the same
  effective PMP revision, `pmp_mode_seen` equals the new mode,
  `pmp_audited_ops` remains zero, live block count is unchanged, and cache
  generation is unchanged for every populated-cache size under test.
- **P2 — M and revision boundary:** all M-to/from-S/U transitions visit every
  cached op. Any effective PMP revision change prevents the shortcut and
  invalidates cached code before a newly denied instruction executes.
- **P3 — retained mid-block revocation:** changing both S/U mode and PMP X
  permission while the decoded cursor points at `0x80000004` traps there,
  retires zero instructions, and leaves `x6 = 0`. A disposable mutant that
  removes only the new shortcut's `revision == self.pmp_revision_seen`
  predicate, retaining all other revision checks, causes this fixture to fail.
- **P4 — native/actual-Wasm architectural parity:** cache-off and cache-on runs
  have identical retire records, full hart snapshots, and RAM/state digests
  through guest SRET, delegated U-ECALL trap entry, snapshot restore, and
  host-directed S/U boundary changes; actual Wasm reaches the same fixed trace
  hashes and compiled BrowserExecutor execution preserves full state.
- **P5 — map and translation isolation:** ignored locked TOR cfg/own/lower-bound
  writes leave the effective revision unchanged and permit zero-work S/U sync;
  effective locked/unlocked TOR/NAPOT changes alter the revision and cannot
  shortcut. Page-table U/X denial and all M-boundary PMP behavior remain
  enforced.
- **P6 — bounded independent attack:** a deterministic mode/map sequence
  derived from seed `0x91e522f06a7bc3d9` and XOR
  `0xd1b54a32d192ed03` preserves cache-off/on trace and final-state parity
  across locked/unlocked TOR and M/S/U transitions, and every effective
  revocation faults before the denied instruction retires.
- **P7 — frozen environment/browser proof:** authoritative artifact digests
  match their declarations and bind the retained pristine clone, source tree,
  unchanged v7 image/kernel/chunks, production Wasm, seven browser modes, and
  126/126 demo run to frozen head `84494881`, with no profiler, browser error,
  dirty-source dependency, deployment, or E5-T22c two-second claim.
- **P8 — changed-hunk coverage:** every runtime/test/harness hunk in the scoped
  diff is executed by deterministic evidence, or is explicitly classified as
  declarative/generated with a reason; no acceptance-relevant hunk remains
  unexercised.
