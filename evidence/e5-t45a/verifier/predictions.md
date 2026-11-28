# E5-T45a verifier predictions (written before running anything or opening worker results beyond the claim text)

P1 package identity: `local/node-26/node` sha256 = 8c19cbb6…; the tarball's bin/node, stripped, equals it
   (or is the unstripped/stripped sibling the claim names); package sha256 = 6d504bc5….
P2 privacy: `tools/privacy/check-no-replay-backend.py` passes on the binary, the package, AND on
   `target/e5-t45a/node_snapshot.cc`; the `internal/recordreplay*` module sources embedded in the
   snapshot are byte-identical to the public fork's `lib/internal/recordreplay*` in /opt/replay-node-26.
P3 config: in the guest, `process.config.variables.node_use_node_snapshot` and
   `node_use_node_code_cache` are true for the new binary, false for the E5-T33 one.
P4 code cache is ACCEPTED on wasm-vm's CPU: `NODE_DEBUG_NATIVE=CODE_CACHE` on the new binary, requiring
   https, prints per-module "was accepted" (or equivalent: no "rejected") lines; the old binary prints
   compile-without-cache lines. Snapshot accepted: `node -e 0` succeeds (V8 aborts on a checksum /
   flag-hash mismatch), and `--no-node-snapshot` is measurably slower than default on the new binary.
P5 driver slot: without RECORD_REPLAY_DONT_RECORD, the new binary still attempts the driver (the
   E5-T33 baseline prints "file too short"); prediction: the missing warning means the attempt is now
   gone or moved, and I expect to find the cause in where the driver load runs (snapshot-time JS vs
   C++ startup). A RECORD_REPLAY_DRIVER=/nonexistent run should still print the
   "Loading Record Replay driver failed" warning and exit 0. If the load path is no longer reached at
   all, that is a behaviour change the claim does not account for (finding).
P6 reproducibility: `build-node26-snapshot.sh` covers configure/patch, target node_mksnapshot,
   guest run, and the final make; it does NOT itself produce the tar.xz package (prediction: a
   packaging step is missing or delegated to build-node26.sh without being stated).
P7 novel: on the new binary `--snapshot-blob X --build-snapshot entry.js` builds and the blob runs
   (`--snapshot-blob X main`), `process.execArgv`/argv unchanged vs old, ESM import of a .mjs, `node:sqlite`
   in-memory query, Intl date format with a non-en locale, all succeed identically on old and new.
