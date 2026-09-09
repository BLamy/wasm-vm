# E5-T26h session-fence verifier predictions

Frozen runtime: `2325c05f756f9a9746099051db9ab46866b874e8`

Predictions recorded before reading the worker gate log or executing tests:

- **P1 — prior old-HELLO refutation:** the unchanged promoted regression
  `pending_old_session_agent_hello_cannot_attest_the_resumed_host` will pass. At
  `load_resume` return, every pre-snapshot agent-TX descriptor will be published once with
  used length zero, no old bytes will be returned by `take_agent_output`, and an application
  HELLO confirmation will be refused.
- **P2 — exact frontier and fresh boundary:** empty, nonzero, wrapped, full, RAM-last, and
  closed-port saved frontiers will drain only descriptors available at restore. A new HELLO
  posted after `load_resume` but before the first guest instruction will be serviced normally
  and may attest the fresh host session. Saved control-TX and port-0 TX work will remain live.
- **P3 — malformed old descriptor path:** a malformed saved agent-TX descriptor after one
  valid old descriptor will complete the valid head with length zero, set transport
  `NEEDS_RESET`, expose no payload, refuse HELLO confirmation, remain blocked after repair and
  notify, and recover only after transport reset plus a fresh handshake.
- **P4 — bounded novel used-publication attack:** with a valid pending old HELLO but a saved
  used-ring address outside RAM, descriptor parsing will succeed and used publication will
  fail. The device will set `NEEDS_RESET`, forward no old bytes, refuse HELLO confirmation,
  and remain unable to service the repaired old frontier until transport reset. This exercises
  the fence's changed `push_used` error branch rather than duplicating P3's `pop` failure.
- **P5 — evidence integrity and carried results:** the worker log SHA-256 will equal
  `1978f7ac0284ab4b3d9127a84083920e1d7a0ca401bd7fc19fe2e5dbb5570349`, identify the frozen
  commit, and contain 119 passing checks. Prior HELD code/evidence remains carried only where
  its implementation boundary is byte-identical; the nine promoted verifier tests will pass.
- **P6 — clean portability:** after P1-P5 hold, the direct native acceptance target will pass
  from one scrubbed local clone checked out exactly at the frozen commit, without web/wasm or
  browser gates.
