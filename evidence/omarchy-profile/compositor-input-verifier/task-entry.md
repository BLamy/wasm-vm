### 2026-09-16 — fresh verifier — VERDICT: verified

Verified E5.5-T03ap's diagnostic only; desktop responsiveness is still unproven
and T03q remains gated. Predictions, original counterexample, corrected
attacks, independent audit and coverage are in
`evidence/omarchy-profile/compositor-input-verifier/`.

- **P1–P6 HELD:** the exact RV64 observer binds all 13 Hyprland TIDs, executable
  and start times. Independent parsing pairs all 58 reads and their 8,464
  bytes, with zero orphan exits, capture gaps or observer errors. At raw
  `compositor-input-r2/physical-r2/desktop/compositor-input.jsonl:136`, main
  TID 417 fd 21 reads 192 bytes from stable `/dev/input/event0` (13:64):
  SYN_DROPPED/sync, A-up/sync, Enter-down/sync, Enter-up/sync. Lines 138/140
  return EAGAIN. These are the final three of 128 trusted physical key events;
  all 256 host key/sync acknowledgments are independently matched. Native
  literal, readv, short/error, per-thread, fd-reuse and post-READY clone
  fixtures pass with independent identities and detach proof.
- **P7–P9 HELD:** frozen head `9c5e197a65889f5301830b3a2ec4dd836e3980de`,
  all 38 recorded helpers, AO runtime and AJ pair are bound. Enter is
  10:46:13.241Z; failure occurs at 10:48:13.242Z after the unchanged 120 s
  bound. Independent raw-wire parsing finds 36 empty exit-75 replies and no
  nonce. Both actual images were personally inspected: empty initial prompt,
  no command or returned prompt. The observed read interval extends through
  post-deadline SIGTERM at 10:48:19.159Z; individual read host times are not
  claimed. Ptrace perturbs scheduling, and SYN_DROPPED alone is not unique
  evidence of queue overflow.
- **P10 HELD after correction:** the original observer resumed an external
  SIGSTOP and was refuted with 13 counterexample progress iterations. Fixed
  one- and three-thread checks preserve stop and clean detach, then show
  progress only after SIGCONT. The actual observer reports SIGTERM, no budget
  exhaustion/error, and detaches all 13 TIDs at trace lines 145–157; independent
  after-status samples show TracerPid 0 and live states. Collection completes
  in 64,522 ms within 180 s, and owned browser cleanup closes without watchdog.
- **SUITE/COVERAGE:** retain the independent fixtures, group-stop regression
  and `make verify-E5_5-T03ap`. The actual trace and bounded fixtures cover the
  accepted diagnostic paths; untriggered defensive reporting guards carry no
  broader correctness claim. AO correctness/artifact proofs carry unchanged.
  Next: test input retention at the guest-side buffering boundary, then prove
  any remedy with an uninstrumented physical nonce and visible returned prompt.

Guest report SHA256
`c272930f9dcf5545aa83fdb97b614cdccdef79c1ecd3aabfa96f1bef1c5c3327`;
trace SHA256
`b5a7263afeead83140f4e5f0cc5f59986aca72d2252fb287b34cf4071f68d9bf`.
Independent replay of `audit-guest.py` passes. The critic's repository-relative
`sha256.txt` seals its records and the exact worker files reviewed.
