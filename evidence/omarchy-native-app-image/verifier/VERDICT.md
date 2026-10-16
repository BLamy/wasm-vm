VERDICT: verified

The frozen `df4cbf17..2f27c1d8` packaging boundary survived the independent review.
All 12 pre-data predictions are HELD. The worker capsule contains the exact main
and standalone, full-history pristine runs; all 104 members/103 indexed identities
were reopened, all 14 changed source files were compared with frozen Git objects,
and both nine-command runs passed. Package selection, assembly, all 6,167 runtime
ELF identities and the install receipt match across the runs. Ext4 UUIDs and
creation timestamps are deliberately outside the byte-reproducibility contract.

- Identity/signature/path — HELD. Real offline libalpm/GnuPG authenticated the
  473 installed archives. Independently, unchanged npm payload/signature passed
  the actual RISC-V gpgv, while a one-byte changed signature failed with BADSIG
  despite its updated cache identity. This is a cryptographic negative control,
  not a substitute for the recorded full pacman trust policy. Seven real-reader
  admission/ELF tests plus two cache/partial tests pass. Removing only the copied
  relative archive path guard makes precisely its two traversal cases fail.
- Native bodies/dependencies — HELD. Rehashed all 6,167 actual retained assembly
  ELF bodies and independently read the three priority bodies out of the final
  ext4. Actual Chromium/LibreOffice/Node loader checks pass. The real libuv
  removal fails Node with exit 127, then same-file restoration passes. This proves
  three priority loader closures; optional/plugin closures for every ELF are not
  claimed. Real npm and all four priority license files remain present.
- Provenance/metadata — HELD. The original accepted fixture and package cache are
  read-only inputs. Only the two disclosed GStreamer packages change among the
  original 389. The final 860-package assembly excludes private build keyring and
  unowned hook state, generates locked generic accounts and an empty machine-id.
  Independently checked actual signed archive/script origins of all seven exact
  capability paths, final ownership records and the corrected mirror/signature
  configuration. Old agent-unmount, capability and disk-space failures remain
  failures in the capsule.
- Fresh filesystem/custody — HELD. Independently streamed both entire 12 GiB raw
  images, all 49,152 manifest slots and all 34,787 stored unique chunks per image.
  The main image is `c48b9c50382d69b1eb5211290fe479256ab02200dee5713d0f006a3a0577c38b`;
  its manifest is `0265349cdbc17cdd94eef59aa83c0ec282c705ac020d2e3884d0c1325a767eb7`.
  Cleanup of exact duplicate outputs was explicitly released only after these
  checks. Main raw/manifest/accepted assembly/cache remain inputs for T05c.
- COVERAGE — the capsule's `coverage.json` maps the changed paths to actual
  transaction/build commands, direct ext4 observations and promoted tests.
  Imports/CLI declarations, generated task metadata, prose and exception-only
  diagnostics are scoped waivers; no recovery behavior is claimed from them.
  Existing accepted assembler/sanitizer and emulator/GPU proofs carry unchanged.
- SUITE — promote `tools/image/test_native_app_packaging_critic.py` (nine tests)
  into existing image-tool discovery. The isolated guard variation and native
  signature control remain reproducible verifier evidence, not product changes.

This verifies the packaged candidate only. Applying the proven VirGL profile,
actual normal Chromium/LibreOffice interaction, unresolved source ports, new
GPU/software warm release and deployment remain T05c/T05d. It does not verify a
complete upstream installation or alter the pending recovery boundary.
