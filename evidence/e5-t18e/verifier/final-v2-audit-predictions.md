# Final schema-v2 evidence audit — predictions before inspection

Prepared for the corrected frozen browser head
5506f2a514a6a7b90d83eafe8cf39e6d3ff4fd1b and separately proven guard head
0d966c1fb8ef31e05c2bca52e1a191d9de235af3. Do not execute the final artifact
auditor until the parent confirms all 27 cases and the final report are complete.
Preparing and self-testing its pure JSON checks does not inspect case evidence.

- V1: The v2 final report, publication record, 27 individual JSON files and final
  acceptance marker agree on the frozen 5506 binding. That binding includes
  buildProvenance referring to the committed initial 9ed publication, not a new
  rebuild claim. Image/package/custom/chunk hashes remain the held v5 values.
  All 31 frozen sources and 15 runtime files bind to their recorded bytes; the
  added inline-JIT file binds to the committed dist blob. Main's guard-only
  difference is checked against the separately reviewed 0d966 version.
- V2: Independently counting raw worker ResourceTiming entries reproduces the
  recorded cache summaries. Each boot's completed chunk count covers its guest
  completed-body fetch count. Every cold case has zero cached chunks; warm reload
  has positive reuse. The four calibration phases independently satisfy their
  recorded cold/warm policy. Legacy page cacheHits is not worker-cache evidence.
- V3: Every desktop/Terminal PNG hashes to its recorded screenshot digest. The
  decoded 1280x800 canvas inside each 1440x1100 screenshot hashes to its framebuffer
  digest. All 27 desktop captures contain the exact 94-pixel arrow at the recorded
  hotspot. Terminal captures differ materially; guest digests/retirement and UART
  are consistent. Each distinct screenshot group must also receive visual
  inspection before the visual portion can be HELD.
- V4: Exactly cold-01..25 and warm-prime/reload are present once, with no failed
  case or aggregate command failure. Cold min/max/mean and warm timings reproduce
  from raw per-case durations; no isolated-performance or speedup claim is added.
- V5: The guard-unit-tests.log records 30 passed, zero failed/skipped. The untracked
  demo smoke helper is only a task-identifier substitution of the T18d helper;
  its actual run and verified badge are deferred until metadata is ready.

Carry unchanged T18a-d, image/rebuild, drill, publication and cache/reuse-guard
results HELD. No new browser boot, build, status/queue update or commit is part
of preparing or running this independent artifact audit.
