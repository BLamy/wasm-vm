# Incremental verifier predictions — E6-T12f4b

Recorded before reopening the scope-probe reports for the worker correction at
10cac3c8d813f959659c57bcd26cfbed1e4788be. The prior runtime predictions and
recordings remain HELD; this check concerns the corrected claim alone.

- C1 — The intervening diff from verifier verdict 2e9e90b8ea185ea754309f761a205b76c29bce67
  contains only the task status and scoped claim correction. All compiler,
  consumer, harness, dependency, evidence archives and promoted-test blobs are
  unchanged, so no execution or portability gate needs repetition.
- C2 — The corrected text explicitly permits bank-independent LINK_SHADER,
  program creation and cache growth with an invalid replacement. Both existing
  physical scope probes show appliedCommands = 1 and programs 1 -> 2 for the
  explicit link with C0.w = 0x00000001, with an actual successful GL link.
- C3 — In both physical probes restoration performs zero copied-bank uniform
  uploads, and subsequent draw rejects with constant-raster-domain-error and
  appliedCommands = 0 before uniform uploads or draw effects, leaving pixels
  and held generations unchanged and making no unsafe GPU call. This agrees
  with the corrected claim's bank-consuming boundary.
- C4 — The original verifier archive, member digests, scope reports, exact frozen
  sources and worker/cold receipt pins remain unchanged. The first scope
  overclaim finding stays preserved; all ten prediction outcomes and 54-hunk
  coverage remain applicable under the corrected scope.
