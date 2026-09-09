# E5-T26f fixed-sound iteration — scoped critic notes

No scoped harness refutation found. No browser evidence was inspected and no task verdict or status change is made.

- The five-line ordering change is narrow and preserves the acceptance clock: `postRestoreStart` remains `firstRestore.completedAt` at runner lines 938–941; pointer motion now precedes the full 350 ms wait and the click at lines 948–959; the final assertion remains `postRestoreEnd - postRestoreStart <= 2_000` at lines 1047–1068.
- The post-delay `locked` assertion prevents pointer motion itself or an ambient transition from being mistaken for the deliberate unlocking click. The new regressions exercise exact pre-delay ordering, premature unlock rejection before click/command, and the 2,000 ms/2,000.01 ms boundary at test lines 346–396.
- Actual restored sound remains a strict two-sided observation: the newly typed `sh /tmp/a` must produce immediate fresh non-silent producer-ring PCM at runner lines 988–1019 and subsequently advance rendered frames with `guestAttached === true` at lines 1020–1045. Terminal output, `audioOutputReady`, or render-clock motion alone cannot satisfy these assertions.
- Bounded Node gate: 28 passed, 0 failed. SHA-256 `4b56d05ccc44122554921c2ed373d6a96c1120e233b3c3fcd48fef2bf00d993d` (`node-28.log`).
- Scratch-copy sabotage: moving pointer motion back after the delay caused the targeted ordering test to fail at test line 351 (`actual ["delay-start", ...]`, expected `["move", "delay-start"]`). SHA-256 `eaac2dac1b4b77e04866861b1cafb017f4957d439d91066849f9d010be20eb54` (`ordering-sabotage.log`). Shared sources were untouched.
- Pre-evidence predictions SHA-256: `7d81026315b15330a4525bce175a4a8a7c6c5adc6a45269a2b7562a0d23e27c3`.
- Prior no-reboot, matching CRC, fresh HELLO, and genuine input observations remain carried only across unchanged boundaries. The running `acceptance:false` create/reuse diagnostic can inform the PCM investigation but cannot close F; final judgment waits for the accepted browser record, including the remaining drag/coherence/second-reload requirements.
