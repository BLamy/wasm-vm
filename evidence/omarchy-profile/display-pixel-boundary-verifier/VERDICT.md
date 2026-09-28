VERDICT: verified

This verifies E5.5-T03au's local diagnostic only. **Desktop responsiveness still
fails visually.** Frozen implementation `560096cbc640e0523778217c01c7c7ad37780473`,
worker submission `73bdbf77`. I read the task and diff, recorded predictions in
`PREDICTIONS.md` before reading AU pixels, and independently inspected the final PNG.

## Predictions and observations

- **P1 provenance — HELD.** `recording-check.json:38` binds all 46 recorded helper
  hashes to frozen git objects. All 96 served rows match bytes on disk; 67 distinct
  deployed resources also match their git objects. AR kernel/RAM/delta/manifest
  match their fixed identities and AT WASM remains
  `7d7b300003cf68076c28958694062dacf3c879efe921bc631bade568ee143bdf`.
  `worker-integrity.json` independently checks every file in the 18-file worker
  seal `ff5d594636dd2763736ca334c9021b371638c1d1a2ad71ea3e0249aa7c0ccf88`.
- **P2 ownership/forwarding — HELD.** `alias-attack.json` records a novel literal
  3x3 BGRX fixture with nonzero X padding, nonzero damage origin, and off-viewport
  sentinels. Mutating and transferring/detaching the original pixels, and mutating
  original metadata, leave the private copy unchanged. The original outgoing
  message/transfer-list identities, native transfer detachment, native return and
  native failure are preserved. Both possible composition orders with the existing
  wire observer forward once and retain the wire listener after probe disposal.
- **P3 bounds/cleanup — HELD.** The attack receives 80 frames but retains only 8,
  records 72 evictions and at most 64 event rows. Oversize/malformed frames cannot
  interrupt transport, the error list caps at 16, and a clear event records no
  extra pixels. Listener-attachment failure also preserves original transport.
  Actual export has 5 frames, no eviction/errors, and a disposed observer. Export
  followed the product screenshot; browser cleanup took 764 ms of the unchanged
  30000 ms limit (`recording-check.json:294`). Export clears retained frame bytes.
- **P4 physical response — HELD.** Independently decoding the raw serial stream
  finds exact nonce `31f4b69996bdd329` in successful fence `mu4r3yby29`, completed
  at `2026-09-16T23:48:01.875Z`, 90.187 seconds after Enter. The corresponding
  serial request only reads `/tmp/desktop-keys-522a5794746c1bb9`; no serial input
  contains the nonce and no agent-input method occurs. 128 trusted physical events
  map to 256 successful keyboard/sync acknowledgments. Original 300/60/120/20/30
  second limits hold; the screenshot follows nonce by 15.960 seconds. Citation:
  `recording-check.json:275`, source `report.json` SHA256
  `bddc8ccaec6338b7eefe05bbfe54b15228beac3766785edae9aa46e61071481c`.
- **P5 worker/canvas relation — HELD.** Independent byte-index conversion (no
  worker or product converter import) maps B,G,R,X to R,G,B,255 and crops the top
  1280x800 from the 1280x832 resource. The last actual frame, sequence 5 at
  `23:48:17.791Z`, is after nonce completion and normalizes to the actual canvas
  exactly: zero changed bytes/pixels, SHA256
  `8938e2a32c3293dfef777fa2389fd331784dd77b9dd489ecf1d786f276ca92c4`.
  Canvas state reports five received/five successful presents and zero pending.
  The preceding frame 4 and frame 5 are themselves byte-identical, raw SHA256
  `c40efc5e5c8d199a4ab1e8c8f7015bc4b64a6a93c35340f13db5ea1ec725495b`.
  Citation: `recording-check.json:608`, actual `display-pixels/frame-5.bgra` and
  `canvas.rgba`. Thus the old pixels were already delivered by the worker; this
  recording contradicts a claim that the canvas dropped new terminal pixels.
- **P6 scanout — HELD.** All five actual frame records say scanout 0 and format 2.
  There is no null-scanout frame in this recording. This is a measured exclusion,
  not a general endorsement of the existing null-scanout presentation behavior.
- **P7 mutation/drop attacks — HELD.** One visible byte mutation in the independent
  fixture becomes exactly one changed pixel. Replaying the actual audit with the
  latest frame removed (while adjusting the apparent count) fails `latest frame
  missing`; final clear, pending presentation, and substituted digest also fail.
  `audit-attacks.json:8` records each rejection. An ordinary response audit rejects
  this diagnostic, while explicit opt-in admits it and the AT ordinary default
  still admits its unchanged recording.
- **P8 real image/honesty — HELD.** I personally viewed
  `response/desktop/desktop-keyboard.png`. It shows the old empty shell prompt;
  the typed command and a later prompt are absent. SHA256
  `431be977157bf77dcd21ca8bf3b640bce9e02dc8c54f09a30d58af78a8195b24` matches AT's
  failed image. The worker preserves `desktopAcceptance:false` and the task says
  diagnostic only. There is no responsive-desktop pass or publication claim.

## Coverage held against the frozen diff

| Changed area | Executed proof / narrow waiver |
| --- | --- |
| Probe installation, copies, metadata, timestamps, ring caps and forwarding (`omarchy-display-pixel-probe.mjs:7`) | Actual five frames, independent alias/detach/composition/clear/attachment attacks, and recorded probe tests. Default-off, duplicate install, byte bounds, worker bound, error cap and native failure are deterministic fixtures. |
| Disposal/export and raw-file writes (`:57`, `:66`, `:88`) | Actual disposed export and six hashed byte files; independent tests verify listener isolation, private-frame clearing and original transport preservation. Missing-probe guard also exercised. |
| Normalization/comparison/audit (`:101`, `:121`) | Actual five format-2 frames independently recomputed; literal format-1 alpha/padding fixture in the recorded probe tests; latest/drop/digest/pending rejection attacks. Exact canvas claim is limited to actual opaque format 2. |
| `omarchy-desktop-live.mjs` imports, opt-in guard, report/helper identity, init script and cleanup | All enabled paths execute in the actual local AR trial. Default recorder path remains unchanged; new false/default values are covered by disabled and ordinary-audit checks. No guest/device/input change in the diff. |
| `omarchy-input-kernel-response.mjs` new flag/runtime selection/diagnostic receipt/env/audit | Actual wrapper command executes all enabled paths. Existing AO/AT defaults retain their old runtime guards; the new diagnostic flag is explicitly required by the audit. Usage text/imports/receipt labels are declarative. |
| `omarchy-input-kernel-response-audit.mjs` flag fence | Actual diagnostic pass, ordinary-mode rejection, unchanged AT default replay in `audit-attacks.mjs`. |
| Make target, recording script and five tests | Frozen `proof.json`/`acceptance.log` show `make verify-E5_5-T03au` code 0 and 39 affected tests passed. Verifier separately ran all five probe tests and bounded attacks. Script environment scrubbing and source checks execute in recorded run. |

No changed runtime hunk needs new evidence. Existing AT runtime gates/cold clone
are carried unchanged; AU is a medium-risk local harness measurement and explicitly
requires no cold clone. No independent full Rust/build/deploy repetition is warranted.
The verifier's first resource check treated the separately intercepted chunk
manifest's null `repoPath` like the generated manifest; that verifier-only mapping
was corrected to its pinned actual chunk-manifest bytes before the final audit.
No worker artifact or implementation was changed by the verifier.

## Scope and permanent result

The next implicated region is upstream of worker display delivery. These bytes do
not distinguish a later guest render from an earlier stale source resource; no
particular guest or GPU remedy is proven. A bounded, no-input continuation may
measure that remaining timing question while preserving the original failed
product verdict and deadline. Q must still wait for an uninstrumented physical
**and visible** pass.

**SUITE:** retain the five deterministic observer/audit tests and
`make verify-E5_5-T03au`; retain the independent verifier scripts and byte hashes
as replayable diagnostic evidence. No new runtime regression test is justified
because this task changes no runtime behavior.

Verifier commands: `node --test tools/verify/omarchy-display-pixel-probe.test.mjs`;
`node evidence/omarchy-profile/display-pixel-boundary-verifier/alias-attack.mjs`;
`node evidence/omarchy-profile/display-pixel-boundary-verifier/check-recording.mjs evidence/omarchy-profile/display-pixel-boundary-r1/response`;
`node evidence/omarchy-profile/display-pixel-boundary-verifier/audit-attacks.mjs evidence/omarchy-profile/display-pixel-boundary-r1/response/desktop`.
