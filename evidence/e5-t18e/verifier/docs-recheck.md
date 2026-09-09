# E5-T18e documentation correction recheck — 2026-09-06

Scope: independently recheck the three main-checkout documentation corrections
against frozen candidate `9ed9e0d1c57daf64f6362193bc30b79482dd3258`. No final
browser-case evidence was inspected, no boot was started, and no clone source,
task status, queue, or commit was changed.

Reviewed playbook SHA-256:
`cd95503a8b916ae1d6c2a9a439832acd25430363b302e1c7eca71d9ebfcbe5a9`.

1. Recovery command — HELD; initial finding closed. Executed the exact revised
   command in `/Users/blamy/Documents/Codex/e5-t18e-final.20gEr1/repo`. Its existing
   `evidence/e5-t18e/publication.json` selected
   `target/e5-t18e/run-CaaCRb/chunks`. The server returned HTTP 200 for the recovery
   page, `/e5t18d-desktop/manifest.json`, and one named chunk. The served manifest
   matched `4ee9976955d30915ba2ed154c14475303070db9b6902491cae9d16ae25241b55`;
   the chunk matched its content-addressed name. See `recovery-command-check.json`
   for URLs, byte lengths, digests, exact command, and server shutdown transcript.
   The temporary verifier server was stopped with Ctrl-C after these HTTP checks.
2. Cold versus post-readiness config — HELD; initial finding closed. The revised
   text at `docs/desktop-bringup.md:103` matches the retained independent logs:
   the `config` case has zero started/ready events and fallback attempts=0;
   `config-removed-after-readiness` has one started and one ready event, then
   `compositor-config-missing` with attempts=1. No repeated guest proof is required.
3. Concurrency=1 wording — HELD. The revised text at
   `docs/desktop-bringup.md:43` describes serial cold boots with the warm pair
   still concurrent. In the unchanged harness, lines 208-214 create the requested
   number of cold workers; lines 215-220 start and await the independent warm
   sequence alongside those workers. No isolated timing claim is made.

The main-checkout runtime/image/harness files remain unchanged from the frozen
candidate. All thirty source digests in the clone's publication record were
rechecked and matched; the clone HEAD and publication.json digest also remained
unchanged. The active browser matrix was not restarted or inspected.

The original four-failure Docker run and additional state-boundary command remain
HELD and are preserved in `initial-local-drills.json` and
`initial-state-boundaries.json`. Original pre-run predictions, integrity results,
and the still-pending final browser predictions are in `predictions.md`.
Unchanged T18a-d proofs remain HELD. This is an incremental documentation result,
not a final E5-T18e task verdict.
