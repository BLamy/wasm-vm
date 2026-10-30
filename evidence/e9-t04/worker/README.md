# E9-T04 worker submission

The clean, frozen source commit is `b5baad0a4b1cddcbd08299b438292258352b2c08`. `E9_DISK_EVIDENCE_DIR=target/evidence/e9-t04-worker-final make verify-E9-T04` passed all 16 prescribed gates. The original receipt SHA-256 is `1e2577042ba20e4ed3bd63fe0eb77efbd41371be85255689112ce40c39366efd`.

This compact packet preserves raw COW captures/restores, canonical roots, actual guest UART/events and native state digests, independent ext4 file witnesses and tool receipts, all command logs, screenshots and compressed precise JS coverage. `packet.json` authenticates these copies; `report.json` authenticates all 515 original files. Full Playwright trace, isolated Chrome profile and reconstructed filesystem images remain under the original ignored evidence directory. No filesystem image is needed in Git: the pinned base and these deltas reproduce it.

The browser used genuine Linux workers and IndexedDB. Its intentionally held publication Promise did not replace any storage operation. Newer and older roots booted in reverse order; the older branch wrote the same physical file block while the durable live store stayed byte-identical. Independent Python SHA/format checks and Docker e2fsprogs read all four expected file contents. Pin/deletion fixtures exercise session-row retention only; their placeholder machine blobs are explicitly unqualified for the coherent-checkpoint boundary in E9-T05.

The current protocol-v3 host also booted the published GPU factory using its retained v2 client, retired 2,999,712 instructions and obtained a physical drawn receipt in fresh epoch 4. That is compatibility evidence for this change. E9-T17/T18 own accelerated session replay qualification.
