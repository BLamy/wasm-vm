# E5-T45b verifier predictions (written before running anything / opening worker result files)

Verifier: fresh session, 2026-11-28. Head under test: 23ee96b57 (claim), code head e0d7f84e0.

P1 Built-in snapshot used at runtime on the published (gen-4) desktop: through the page's serial shell,
   `NODE_DEBUG_NATIVE=CODE_CACHE node -e 0` (or equivalent) reports the code cache / built-in snapshot as
   used (no "rejected"/"mismatch"/"fallback" lines), and `process.config.variables.node_use_node_snapshot`
   and `node_use_node_code_cache` are true. Also `node --v8-options`-independent check: a
   `node --no-node-snapshot -e 0` is measurably slower (more guest time) than plain `node -e 0`
   in the same session; if the snapshot were rejected they would be equal.
P2 Nothing still depends on the removed per-boot snapshot: grep of the tree outside evidence/tasks/historical
   for `/run/replay-node`, `REPLAY_NODE_SNAPSHOT`, `startup.blob` finds no live consumer in web/, tools/
   (capture script, harnesses), roadmap claims stating gen-4 still builds a per-boot snapshot. Expect at most
   stale prose (e.g. manifest "generated" string) — a stale prose hit is a nit, a code consumer is a FAIL.
   In the gen-4 guest, /run/replay-node does not exist and NODE_OPTIONS is unset.
P3 Worker threads and child processes from the desktop shell: `node -e` creating a `new Worker(..., {eval:true})`
   that posts a message back prints it and exits 0; `child_process.execFileSync(process.execPath, ['-e', ...])`
   prints the child's output; process.execPath is /opt/replay-node-26/bin/node.
P4 Gen-4 vs gen-3 typed `node -e 'console.log(42)'` to prompt: gen-4 median is lower than gen-3 on the same
   bundle (worker: ~1.3 s vs ~1.5 s); I predict my own 3-trial run shows gen-4 < gen-3 with no overlap.
P5 Manifest integrity: the gen-4 manifest's chunkManifest/wholeImage/bootSnapshot sha256 and sizes match the
   files under releases/ and what 8125 serves; bootSnapshot.identity.imageSha256 equals the wholeImage
   uncompressedSha256; the image's /opt/replay-node-26/bin/node sha256 = 8c19cbb6... (E5-T45a's).
P6 Online acceptance (E5-T43f online off relay-down sw) passes against 8125.
P7 Novel attack: `node --snapshot-blob` user-land snapshot build + run still works on top of the built-in
   one (users of E5-T41a's capability) — `node --snapshot-blob /tmp/s.blob --build-snapshot e.js` then
   `node --snapshot-blob /tmp/s.blob` prints the snapshotted value. Plus the REPL/`node` with no args
   reaching a prompt is not my target. Also: the live site (wasm-vm.pages.dev) serves the gen-4 manifest.
