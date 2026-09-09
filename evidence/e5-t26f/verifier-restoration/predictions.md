# E5-T26f restoration verifier predictions

Predictions recorded before opening the candidate or retained diagnostic evidence.

Reviewed candidate: `371786fc2a988381bef1a7f83fd7dca2bba07cf9`, descended from the verified
E5-T26h runtime `2325c05f756f9a9746099051db9ab46866b874e8`. Comparison points:
original F implementation `8ce1db0e`, browser-resume remediation `719c6212`, cursor diagnostic
instrumentation `e37ddc63`, and deferred-audit candidate `371786fc`.

- **P1 — exact candidate and artifact integrity.** The final evidence will name exact head
  `371786fc`, contain a successful final JSON record rather than only failure milestones, and its
  image, split-manifest, desktop snapshot, screenshot, and server transcript hashes will match the
  actual files. Source/dist parity must hold for every browser runtime file used by the proof.
- **P2 — true whole-machine resume, no reboot/re-probe.** Both normal and moving-drag reloads will
  report `restoredFromBootSnapshot() === true`, actual snapshot decision `resume`, and the actual
  overlay generation equal to the generation paired at save. Neither post-reload boot-state list
  will contain `booting`; serial/terminal history will continue from the saved two-window desktop
  rather than show a new kernel/login/device-probe sequence. The deferred coherence audit must pass
  before another persisted save or evidence publication.
- **P3 — same first-present pixels.** For both persisted snapshots, the first repair present after
  reload will have exactly the CRC captured at the paused save boundary. Both snapshots will carry
  valid SHA-256 identities, and the normal and drag first-present checks will be explicit assertions,
  not inferred from a later frame or screenshot.
- **P4 — real post-restore interaction inside the original two-second boundary.** Measured from
  `restoreResult().completedAt`, after a deliberate 350 ms gesture delay: a new tablet move will
  reach the guest and the custom cursor will render at the requested coordinate; focus will be used
  by newly typed physical-key input in the terminal; `sh /tmp/a` will complete guest-visibly; the
  audio producer index will advance with non-silent PCM, the guest output will remain attached, and
  rendered frames will increase. The final timestamp for all those facts will be no more than
  2,000 ms after restore completion. A render-clock increment without PCM or a pre-existing marker
  will not satisfy this prediction.
- **P5 — drag-phase adversarial coverage.** The harness will save before press, while held, while
  moving, and after release; all four records will have valid, nonempty snapshot identities. The
  moving/held-path snapshot selected for persistence will be the one restored on the second reload,
  its first-present CRC will match, and restored pointer state will contain no held button. The
  sequence must not silently substitute the normal snapshot or a release-phase snapshot.
- **P6 — stale HELLO cannot attest the restored session.** The browser restore will perform a fresh
  Channel rehandshake and report the new handshake generation/version. Verified H behavior is
  carried forward only if its core blobs are unchanged: saved agent-TX application payloads,
  including HELLO, are completed without forwarding before guest execution. F's bridge must own
  queued worker bytes, reject partial host writes, and discard pending bytes on close so caller or
  transferable-buffer mutation cannot manufacture the fresh HELLO.
- **P7 — bridge ownership sabotage is effective.** In a scratch copy only, changing the bridge's
  `Uint8Array` receive ownership from `.slice()` to pass-through will make the queued-HELLO test
  fail at the capability assertion after the caller mutates the original buffer. The unsabotaged
  scoped bridge/Channel tests will pass, including one-byte-short backpressure refusal.
- **P8 — deferred-audit harness is falsifiable.** Narrow Node tests will prove a deliberately slow
  coherence read cannot precede or consume the timed interaction, but is mandatory before the next
  save. Stale decision, mismatched generation, and missing generation must remain failures with
  retained milestones. A bounded sabotage of this ordering/await boundary must be detected.
- **P9 — carried results.** Prior HELD image provenance, Chromium-only scope waiver, bounded
  diagnostics, normal/drag CRC assertion structure, short-write adversarial bridge behavior, and
  source/dist parity are carried only where their code and artifact boundaries are unchanged.
  WebKit, independent machines, host rr, and a new browser requirement for H remain out of scope.

No final verdict or task status change is permitted until the final candidate evidence is complete
and its worker claim is available.
