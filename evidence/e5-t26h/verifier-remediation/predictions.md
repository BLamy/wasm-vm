# E5-T26h remediation predictions — 2026-09-07

Frozen remediation: `611e0f34952106bbafef828c304d697d20c34da3`, reviewed against
`daac0b99`. Prior HELD results remain carried where their code and evidence are unchanged.
These predictions precede verifier execution.

- R1 prior refutations — both promoted regressions now pass: a pre-save console control-transmit
  kick advances used index 1 to 2 once, and malformed CPU refusal leaves source GPU resource 77
  absent from the target.
- R2 three transmit rings — pending port-0, control, and agent transmit descriptors continue once
  without a new QueueNotify; already-consumed heads and buffered old host-session bytes do not
  replay.
- R3 HELLO fence — a source-accepted HELLO remains invalid after resume. Additionally, bytes from a
  pre-snapshot pending agent descriptor that encode an old-session HELLO cannot by themselves
  attest the new application session before a post-resume HELLO is generated.
- R4 legacy atomicity — malformed CPU, RAM, CLINT, PLIC, UART, RTC, clock, block, and net payloads
  return the existing typed errors before CPU/RAM/desktop state or host GPU callbacks change.
- R5 sparse parser equivalence — validation rejects truncated data runs, oversized zero runs, bad
  kinds, and wrong decoded lengths with the same error family as decode, while valid RAM still
  round-trips.
- R6 evidence/coverage — the remediation log hashes stably, reports 116 passing checks including
  the unchanged eight promoted critic tests, and every new runtime branch is exercised by the
  recorded or bounded verifier runs.
