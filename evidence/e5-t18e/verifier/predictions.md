# E5-T18e fresh-verifier predictions and retained results

Frozen candidate: `9ed9e0d1c57daf64f6362193bc30b79482dd3258`.
Diff base: `e97cffa9` (T18d verified).
Fresh clone: `/Users/blamy/Documents/Codex/e5-t18e-final.20gEr1/repo`.
Persisted on 2026-09-06 after the initial local checks, before inspecting any final
27-case browser evidence. No task status or queue change is implied by this file.

## Predictions made before the initial runs

The following predictions were originally stated in this verifier session's
commentary before executing the Docker drills or inspecting final browser evidence:

> The four drills will report `video-device-missing`, `runtime-directory-missing`,
> `unsupported-renderer`, and fallback after the third crash, each within five minutes.

> Disposable image, manifest, and chunk mutations will fail integrity checks.

> The final report will bind the rebuilt image to the frozen inputs and contain
> 25 fresh cold boots plus the warm prime/reload pair, with desktop, 94-pixel cursor,
> successful Terminal launch, and no browser errors in every case.

These quotations preserve the earlier predictions; their appearance in this file
is not a claim that this file existed before the initial local checks.

## Held local results

- P-D1 video / P-D2 runtime / P-D3 renderer / P-D4 three crashes: HELD. All four
  diagnoses matched. The entire ten-case process-fixture command completed in
  105.06 host seconds, so every diagnosis completed within five minutes. See
  `initial-local-drills.json` for original case logs and command provenance.
- P-I1 integrity: HELD. Existing nine publication/surface tests passed. The added
  `tools/verify/e5-t18e-verifier.test.mjs` exercises the full publication API on a
  sparse synthetic image, with two positive controls and eleven rejection cases.
  All thirteen checks passed (Node reports fourteen including the parent test).
  In a disposable copy, skipping the raw ext4 hash check caused the raw-image
  mutant check to fail with `Missing expected rejection` while the other twelve
  checks passed. The recorded v5 image was never mutated.
- The playbook's separate state-boundary command passed nine tests in 32.40 host
  seconds. See `initial-state-boundaries.json`. This is local process evidence;
  unchanged T18d guest recovery evidence remains HELD, without a replacement boot.

## Final browser predictions still awaiting evidence

P-F1 — NEEDS EVIDENCE: the completed report and final publication audit bind the
rebuild to the frozen candidate and these locks: image
`e75b04caadd9616915b323497c92df1d5a9d11d55c877afcc95d208dde302416`, chunk manifest
`4ee9976955d30915ba2ed154c14475303070db9b6902491cae9d16ae25241b55`, package manifest
`ba86429d08e11360309b346e8fb757f44f318eccefed3e243dcaf425b91ad908`, custom manifest
`ab73efab8eac885690def228e3d2080d4ed9f57801e642037f12fd0186e7e2d5`. The final
recheck must not accept later image, source, runtime, or publication drift.

P-F2 — NEEDS EVIDENCE: there are exactly 27 unique successful cases: cold-01
through cold-25 in fresh cache-disabled contexts and warm-prime/warm-reload in
the cache-enabled context, with service workers blocked and guest persistence
and snapshot restore disabled. Each case binds the same source publication.

P-F3 — NEEDS EVIDENCE: every case shows the wallpaper, panel, menu and actual
94-pixel guest cursor at (480,160), then an accepted visible Terminal launch.
Recorded screenshots, framebuffer and guest-state digests must support the
claimed states. Browser errors, presentation errors and launch diagnostics are
empty; no missing menu, black screen, missing cursor, or unfinished boot is a pass.

P-F4 — NEEDS EVIDENCE: the report records positive finite boot-to-desktop timings
for every cold and warm case; the cold summary agrees with its 25 values, and
the report declares the actual concurrency and cache settings. No isolated
performance budget or expected warm speedup is added to the task.

## Documentation follow-up predictions

Before executing the revised recovery command: it should resolve
`publication.chunkDir` from the clone's existing publication.json, start the
recovery server, and serve HTTP 200 for the recovery page, the exact recorded
chunk manifest, and a content-addressed chunk whose bytes match its name.
This HTTP check must not load a browser or boot a guest.

The cold/post-readiness config distinction should match the already recorded
zero-start and one-start cases. The concurrency clarification should match the
unchanged harness: one cold worker when concurrency=1, with a separately started
warm prime/reload sequence still concurrent. These are incremental documentation
checks; unchanged T18a-d proofs, runtime, image and harness results carry HELD.
